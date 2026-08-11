// Must stay the first import: it sets NG_BUILD_* before @angular/build snapshots them,
// and its detection must not see this file's own @angular/build imports.
import './setup-builder-env-variables.js';

import * as path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

import { SourceFileCache } from '@angular/build/private';

import { type BuilderContext, type BuilderOutput, createBuilder } from '@angular-devkit/architect';

import {
  buildForFederation,
  rebuildForFederation,
  getExternals,
  normalizeFederationOptions,
  setBuildAdapter,
  createFederationCache,
} from '@softarc/native-federation';
import {
  logger,
  setLogLevel,
  RebuildQueue,
  AbortedError,
  getDefaultCachePath,
  syncNfFileWatcher,
  linkedSharedDirs,
  sharedMappingDirs,
} from '@softarc/native-federation/internal';

import { createAngularBuildAdapter } from '../../tools/esbuild/angular-esbuild-adapter.js';
import { checkForInvalidImports } from '../../utils/check-for-invalid-imports.js';
import { federationSourceFiles } from '../../utils/federation-source-files.js';

import type { NfRemoteBuilderSchema, NfRemoteInternalOptions } from './schema.js';
import { resolveNgBuilderOptions } from './resolve-ng-options.js';
import { inferFederationConfigPath } from './infer-config-path.js';
import { createDebouncedChangeWatcher } from './change-watcher.js';
import {
  copyAllAssets,
  copyChangedAssets,
  getAssetWatchDirs,
  normalizeRemoteAssetEntries,
} from './assets.js';

/**
 * THIS BUILDER IS EXPERIMENTAL AND MIGHT CHANGE OVER TIME
 *
 * @param nfBuilderOptions
 * @param context
 */

export async function* runRemoteBuilder(
  nfBuilderOptions: NfRemoteBuilderSchema & NfRemoteInternalOptions,
  context: BuilderContext
): AsyncIterable<BuilderOutput> {
  const federationTsConfig = nfBuilderOptions.tsConfig;
  const outputBase = nfBuilderOptions.outputPath ?? `dist/${context.target!.project}`;
  const browserOutputPath = path.join(outputBase, 'browser');
  const absoluteBrowserOutput = path.resolve(context.workspaceRoot, browserOutputPath);

  const { ngBuilderOptions, projectRoot, projectSourceRoot } = await resolveNgBuilderOptions(
    nfBuilderOptions,
    context
  );

  // Unlike the regular build builder, remote never bundles a main.ts / polyfills. Entry points
  // come from the `exposes` map in federation.config.{mjs,js}; the schema option is only a
  // fallback for when there are none, so passing `undefined` when it is omitted keeps core
  // from treating an empty list as a deliberate one.
  const entryPoints: string[] | undefined = nfBuilderOptions.entryPoints?.length
    ? nfBuilderOptions.entryPoints
    : undefined;

  const adapter = createAngularBuildAdapter(
    {
      ...ngBuilderOptions,
      // Required by the schema, so the tsconfig is always the builder's to manage.
      managedTsConfig: federationTsConfig,
      fallbackEntryPoints: entryPoints,
    },
    context
  );
  setBuildAdapter(adapter);
  setLogLevel(nfBuilderOptions.verbose ? 'verbose' : 'info');

  const cachePath = getDefaultCachePath(context.workspaceRoot);

  const normalized = await normalizeFederationOptions(
    {
      projectName: nfBuilderOptions.projectName,
      workspaceRoot: context.workspaceRoot,
      outputPath: browserOutputPath,
      federationConfig: inferFederationConfigPath(federationTsConfig, context.workspaceRoot),
      tsConfig: federationTsConfig,
      verbose: nfBuilderOptions.verbose,
      watch: nfBuilderOptions.watch,
      dev: !!nfBuilderOptions.dev,
      entryPoints,
      cacheExternalArtifacts: nfBuilderOptions.cacheExternalArtifacts !== false,
    },
    createFederationCache(cachePath, new SourceFileCache(cachePath))
  );

  // Mapped paths are checked by core's normalizeFederationOptions, which sees the
  // pruned/glob-expanded set and skips paths that were never going to be published.
  checkForInvalidImports(Object.keys(normalized.config.shared), 'externals');

  const start = process.hrtime();
  logger.measure(start, 'To load the federation config.');

  const externals = getExternals(normalized.config);

  // Realpath'd dirs of npm-linked shared packages (`[]` if none, making the
  // syncNfFileWatcher calls below a no-op) so the linked lib's real source is watched.
  const linkedDirs = linkedSharedDirs(normalized.config, normalized.options);

  const assetEntries = normalizeRemoteAssetEntries(
    nfBuilderOptions.assets,
    context.workspaceRoot,
    projectRoot,
    projectSourceRoot
  );

  const changeWatcher = nfBuilderOptions.watch
    ? createDebouncedChangeWatcher(nfBuilderOptions.rebuildDelay)
    : undefined;

  if (changeWatcher) {
    // sharedMappingDirs is derived from config, not from a build's inputs, so it
    // also covers files added to a shared lib since the last build — which a
    // compiled-inputs watch set structurally cannot.
    changeWatcher.watcher.addPaths([
      path.dirname(path.resolve(context.workspaceRoot, federationTsConfig)),
      ...sharedMappingDirs(normalized.config),
    ]);
    for (const assetDir of getAssetWatchDirs(assetEntries, context.workspaceRoot)) {
      changeWatcher.watcher.addPaths(assetDir);
    }
  }

  if (existsSync(normalized.options.outputPath)) {
    rmSync(normalized.options.outputPath, { recursive: true });
  }
  mkdirSync(normalized.options.outputPath, { recursive: true });

  try {
    await buildForFederation(normalized.config, normalized.options, externals);
  } catch (e) {
    logger.error((e as Error)?.message ?? 'Building the artifacts failed');
    process.exit(1);
  }

  await copyAllAssets(assetEntries, absoluteBrowserOutput, context.workspaceRoot);

  // Watch what the federation compilation actually tracked — where the cache
  // records it depends on the TS compilation path; see federationSourceFiles.
  const syncFederationWatcher = (): void => {
    if (!changeWatcher) return;
    const files = federationSourceFiles(normalized.options.federationCache.bundlerCache);
    syncNfFileWatcher(changeWatcher.watcher, files, linkedDirs);
  };

  syncFederationWatcher();

  const rebuildQueue = new RebuildQueue();

  try {
    yield { success: true };

    while (nfBuilderOptions.watch && changeWatcher) {
      await changeWatcher.waitForChange();
      changeWatcher.resetChangePromise();

      // fs.watch fires multiple events per save (write+rename, plus overlapping
      // directory and per-file watchers). Redundant events arriving during a
      // rebuild resolve the next promise, so without this guard the loop runs a
      // second phantom build with an empty snapshot once the first one finishes.
      if (changeWatcher.pendingPaths.size === 0) continue;

      // The freshly-reset change promise doubles as the interrupt signal: if a
      // newer (debounced) change lands while this rebuild is in flight, abort it
      // and loop to fold the new paths in — mirroring how the `build` builder
      // passes Angular's next output as the interrupt to RebuildQueue.track.
      // Without this, RebuildQueue's AbortSignal is never triggered and a stale
      // rebuild must finish before a fresh save is picked up.
      const interruptPromise = changeWatcher.waitForChange();

      const trackResult = await rebuildQueue.track(async (signal: AbortSignal) => {
        try {
          if (signal?.aborted) {
            throw new AbortedError('Build canceled before starting');
          }

          // Snapshot but don't clear — unlike the build builder (which clears its
          // buffer eagerly and relies on Angular's iterator to re-trigger), this
          // builder owns its watcher, so if the build is aborted or fails the paths
          // stay in pendingPaths and are retried on the next cycle.
          const changedFiles = [...changeWatcher.pendingPaths];

          await rebuildForFederation(
            normalized.config,
            normalized.options,
            externals,
            changedFiles,
            signal
          );

          await copyChangedAssets(
            assetEntries,
            absoluteBrowserOutput,
            context.workspaceRoot,
            changedFiles
          );

          // Clear only what we consumed. Any paths pushed during the build
          // remain in pendingPaths and will drive the next iteration.
          for (const p of changedFiles) changeWatcher.pendingPaths.delete(p);

          syncFederationWatcher();

          if (signal?.aborted) {
            throw new AbortedError('[remote-builder] After federation build.');
          }

          logger.info('Done!');

          return { success: true };
        } catch (error) {
          if (error instanceof AbortedError) {
            logger.verbose('Rebuild was canceled. Cancellation point: ' + error?.message);
            return { success: false, cancelled: true };
          }
          logger.error('Federation rebuild failed!');
          if (nfBuilderOptions.verbose) console.error(error);
          return { success: false };
        }
      }, interruptPromise);

      // Mirrors the build builder's trackResult handling, minus the iterator pump:
      // there the 'interrupted' branch feeds Angular's next output back into the
      // loop, whereas here the new change has already resolved the current change
      // promise, so the next loop iteration picks it up immediately. The aborted
      // build left its paths in pendingPaths, so nothing is lost.
      if (trackResult.type === 'completed' && !trackResult.result.cancelled) {
        yield { success: trackResult.result.success };
      }
    }
  } finally {
    changeWatcher?.dispose();
    rebuildQueue.dispose();
    await adapter.dispose();
    await changeWatcher?.watcher.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createBuilder(runRemoteBuilder) as any;
