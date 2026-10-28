import * as fs from 'fs';
import * as path from 'path';
import {
  type NFBuildAdapter,
  type NFBuildAdapterResult,
  type NFBuildAdapterOptions,
  type FederationCache,
  type EntryPoint,
} from '@softarc/native-federation';
import { AbortedError } from '@softarc/native-federation/internal';

import * as esbuild from 'esbuild';
import type { SourceFileCache } from '@angular/build/private';
import type { BuilderContext } from '@angular-devkit/architect';
import type { ApplicationBuilderOptions } from '@angular/build';
import { createAngularEsbuildContext } from './angular-bundler.js';
import { createNodeModulesEsbuildContext } from './node-modules-bundler.js';
import { createExternalsCacheKey } from './externals-cache-key.js';
import { entriesByOutputName } from './output-entries.js';
import { resolveSharedBundleSettings } from './shared-bundle-settings.js';
import { normalizeContextOptions } from './normalize-context-options.js';
import type { NfInternalOptions } from '../builders/build/schema.js';

interface EsbuildContextResult {
  ctx: esbuild.BuildContext;
  pluginDisposed: Promise<void>;
  kind: NFBuildAdapterOptions['kind'];
  outdir: string;
  cache: FederationCache<SourceFileCache>;
  entryPoints: EntryPoint[];
}

function writeOutputs(
  result: esbuild.BuildResult<esbuild.BuildOptions>,
  outdir: string,
  entryByOutputName: Map<string, string>
): NFBuildAdapterResult[] {
  // Component stylesheets with the same basename each emit `<name>.css.map` (#195); report the
  // path once, as the file the last write left on disk.
  const writtenFiles = new Map<string, NFBuildAdapterResult>();

  for (const outFile of result.outputFiles ?? []) {
    const fileName = path.basename(outFile.path);
    const filePath = path.join(outdir, fileName);
    fs.writeFileSync(filePath, outFile.contents);
    const entry = entryByOutputName.get(fileName);
    writtenFiles.set(filePath, entry ? { fileName: filePath, entry } : { fileName: filePath });
  }

  return [...writtenFiles.values()];
}

export interface AngularBuildAdapter extends NFBuildAdapter {
  // Disposes every mapping and exposed context, leaving esbuild running for the app build.
  disposeFederationContexts(): Promise<void>;
}

export async function createAngularBuildAdapter(
  ngBuilderOptions: ApplicationBuilderOptions & NfInternalOptions,
  context: BuilderContext
): Promise<AngularBuildAdapter> {
  // Core reads externalsCacheKey before setup(), so the shared settings are resolved up front.
  const sharedBundleSettings = await resolveSharedBundleSettings(ngBuilderOptions, context);
  const externalsCacheKey = createExternalsCacheKey(sharedBundleSettings);
  const bundleContextCache = new Map<string, EsbuildContextResult>();

  const disposeWhere = async (
    matches: (entry: EsbuildContextResult, name: string) => boolean
  ) => {
    const disposals: Promise<void>[] = [];

    for (const [name, entry] of bundleContextCache) {
      if (!matches(entry, name)) continue;
      bundleContextCache.delete(name);
      disposals.push(
        (async () => {
          await entry.ctx.dispose();
          await entry.pluginDisposed;
        })()
      );
    }

    await Promise.all(disposals);
  };

  const dispose = async (name?: string): Promise<void> => {
    if (name) {
      if (!bundleContextCache.has(name))
        throw new Error(`Could not dispose of non-existing build '${name}'`);

      await disposeWhere((_, entryName) => entryName === name);
      return;
    }

    await disposeWhere(() => true);
    await esbuild.stop();
  };

  const disposeFederationContexts = () => disposeWhere(entry => entry.kind !== 'shared');

  const setup = async (
    name: string,
    adapterOptions: NFBuildAdapterOptions<SourceFileCache>
  ): Promise<void> => {
    if (bundleContextCache.has(name)) await dispose(name);

    const normalizedOptions = normalizeContextOptions(ngBuilderOptions, context, adapterOptions);

    const { ctx, pluginDisposed } =
      adapterOptions.kind === 'shared'
        ? await createNodeModulesEsbuildContext(normalizedOptions, sharedBundleSettings)
        : await createAngularEsbuildContext(normalizedOptions, name);

    bundleContextCache.set(name, {
      ctx,
      pluginDisposed,
      kind: adapterOptions.kind,
      outdir: normalizedOptions.outdir,
      cache: normalizedOptions.cache,
      entryPoints: normalizedOptions.entryPoints,
    });
  };

  const build = async (
    name: string,
    opts: {
      modifiedFiles?: string[];
      signal?: AbortSignal;
    } = {}
  ): Promise<NFBuildAdapterResult[]> => {
    const bundleContext = bundleContextCache.get(name);
    if (!bundleContext) {
      throw new Error(`No context found for build "${name}". Call setup() first.`);
    }

    if (opts?.signal?.aborted) {
      throw new AbortedError('[build] Aborted before rebuild');
    }

    try {
      if (opts.modifiedFiles) {
        bundleContext.cache.bundlerCache.invalidate(new Set(opts.modifiedFiles));
      }
      const result = await bundleContext.ctx.rebuild();
      // Without `entry`, core matches hashed entries by file name (core#193).
      const entryByOutputName = entriesByOutputName(
        result.metafile,
        bundleContext.entryPoints,
        context.workspaceRoot
      );

      return writeOutputs(result, bundleContext.outdir, entryByOutputName);
    } catch (error) {
      if (opts?.signal?.aborted && error instanceof Error && error.message.includes('canceled')) {
        throw new AbortedError('[build] ESBuild rebuild was canceled.');
      }
      throw error;
    }
  };

  return { externalsCacheKey, setup, build, dispose, disposeFederationContexts };
}
