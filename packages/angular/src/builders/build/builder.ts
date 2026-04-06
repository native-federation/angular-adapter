import './setup-builder-env-variables.js';

import * as fs from 'fs';
import * as mrmime from 'mrmime';
import * as path from 'path';

import { type ApplicationBuilderOptions, buildApplication } from '@angular/build';
import { buildApplicationInternal, serveWithVite, SourceFileCache } from '@angular/build/private';

import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
  targetFromTargetString,
} from '@angular-devkit/architect';

import { normalizeOptions } from '@angular-devkit/build-angular/src/builders/dev-server/options.js';
import type { Schema as DevServerSchema } from '@angular-devkit/build-angular/src/builders/dev-server/schema.js';

import {
  buildForFederation,
  rebuildForFederation,
  type FederationInfo,
  type NormalizedFederationOptions,
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
} from '@softarc/native-federation/internal';
import { createAngularBuildAdapter } from '../../utils/angular-esbuild-adapter.js';
import { type JsonObject } from '@angular-devkit/core';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { fstart } from '../../tools/fstart-as-data-url.js';
import { type Plugin, type PluginBuild } from 'esbuild';
import { getI18nConfig, translateFederationArtifacts } from '../../utils/i18n.js';
import { updateScriptTags } from '../../utils/updateIndexHtml.js';
import { federationBuildNotifier } from './federation-build-notifier.js';
import { createNfWatcher, syncNfWatcher, type NfWatcher } from './nf-watcher.js';
import type { NfBuilderSchema, NfInternalOptions } from './schema.js';
import { checkForInvalidImports } from './../../utils/check-for-invalid-imports.js';

const originalWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void
): boolean {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();

  if (str.includes('vite:import-analysis') && str.includes('es-module-shims.js')) {
    return true;
  }

  if (typeof encodingOrCallback !== 'string') {
    return originalWrite(chunk, encodingOrCallback);
  }

  return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
};

const createInternalAngularBuilder =
  (externals: string[]) =>
  (
    options: Parameters<typeof buildApplicationInternal>[0],
    context: BuilderContext,
    pluginsOrExtensions?: Plugin[] | Parameters<typeof buildApplicationInternal>[2]
  ) => {
    let extensions: Parameters<typeof buildApplicationInternal>[2];
    if (pluginsOrExtensions && Array.isArray(pluginsOrExtensions)) {
      extensions = {
        codePlugins: pluginsOrExtensions,
      };
    } else {
      extensions = pluginsOrExtensions as Parameters<typeof buildApplicationInternal>[2];
    }

    // serveWithVite fetches its own browserOptions independently, so ngBuilderOptions
    // modifications don't reach here. Add NF externals to externalDependencies so
    // Angular routes them to optimizeDeps.exclude, preventing Vite from trying to
    // pre-bundle packages that include native .node binaries.
    options.externalDependencies = [
      ...(options.externalDependencies ?? []),
      ...externals,
    ];

    // Todo: share cache with Angular builder: https://github.com/angular/angular-cli/pull/32527
    // options.codeBundleCache = nfOptions.federationCache.bundlerCache;
    return buildApplicationInternal(options, context, extensions);
  };

export async function* runBuilder(
  nfBuilderOptions: NfBuilderSchema & NfInternalOptions,
  context: BuilderContext
): AsyncIterable<BuilderOutput> {
  let target = targetFromTargetString(nfBuilderOptions.target);

  let targetOptions = (await context.getTargetOptions(target)) as unknown as JsonObject &
    ApplicationBuilderOptions;

  let builder = await context.getBuilderNameForTarget(target);

  if (builder === '@angular-devkit/build-angular:browser-esbuild') {
    logger.info('.: NATIVE FEDERATION - UPDATE NEEDED :.');
    logger.info('');
    logger.info("Since version 17.1, Native Federation uses Angular's");
    logger.info('Application-Builder and its Dev-Server.');
    logger.info('');
    logger.info('If you are sill on Angular 17.0.x, please update to');
    logger.info('Angular 17.1.x or downgrade to Native Federation 17.0.x.');
    logger.info('');
    logger.info('For working with Native Federation 17.1.x (recommented), ');
    logger.info('please update your project config, e.g. in angular.json');
    logger.info('');
    logger.info('This command performs the needed update for default configs:');
    logger.info('');
    logger.info('\tng g @angular-architects/native-federation:appbuilder');
    logger.info('');
    logger.info('You need to run it once per application to migrate');
    logger.info('Please find more information here: https://shorturl.at/gADJW');
    return;
  }

  /**
   * Explicitly defined as devServer or if the target contains "serve"
   */
  const runServer =
    typeof nfBuilderOptions.devServer !== 'undefined'
      ? !!nfBuilderOptions.devServer
      : target.target.includes('serve');

  let ngBuilderOptions = (await context.validateOptions(
    runServer
      ? ({
          ...targetOptions,
          port: nfBuilderOptions.port || targetOptions['port'],
        } as JsonObject)
      : targetOptions,
    builder
  )) as JsonObject & ApplicationBuilderOptions;

  let serverOptions = null;

  const watch = nfBuilderOptions.watch;

  if (ngBuilderOptions['buildTarget']) {
    serverOptions = await normalizeOptions(
      context,
      context.target!.project,
      ngBuilderOptions as unknown as DevServerSchema
    );

    target = targetFromTargetString(ngBuilderOptions['buildTarget'] as string);
    targetOptions = (await context.getTargetOptions(target)) as unknown as JsonObject &
      ApplicationBuilderOptions;

    builder = await context.getBuilderNameForTarget(target);
    ngBuilderOptions = (await context.validateOptions(targetOptions, builder)) as JsonObject &
      ApplicationBuilderOptions;
  }

  ngBuilderOptions.watch = watch;

  if (nfBuilderOptions.baseHref) {
    ngBuilderOptions.baseHref = nfBuilderOptions.baseHref;
  }

  if (nfBuilderOptions.outputPath) {
    ngBuilderOptions.outputPath = nfBuilderOptions.outputPath;
  }

  const adapter = createAngularBuildAdapter(ngBuilderOptions, context);

  setBuildAdapter(adapter);

  setLogLevel(ngBuilderOptions.verbose ? 'verbose' : 'info');

  if (!ngBuilderOptions.outputPath) {
    ngBuilderOptions.outputPath = `dist/${context.target!.project}`;
  }

  const outputPath = ngBuilderOptions.outputPath;
  const outputOptions: Required<Exclude<ApplicationBuilderOptions['outputPath'], string>> = {
    browser: 'browser',
    server: 'server',
    media: 'media',
    ...(typeof outputPath === 'string' ? undefined : outputPath),
    base: typeof outputPath === 'string' ? outputPath : outputPath.base,
  };

  const i18n = await getI18nConfig(context);

  const localeFilter = getLocaleFilter(ngBuilderOptions, runServer);

  const sourceLocaleSegment =
    typeof i18n?.sourceLocale === 'string'
      ? i18n.sourceLocale
      : i18n?.sourceLocale?.subPath || i18n?.sourceLocale?.code || '';

  const browserOutputPath = path.join(
    outputOptions.base,
    outputOptions.browser,
    ngBuilderOptions.localize ? sourceLocaleSegment : ''
  );

  const differentDevServerOutputPath = Array.isArray(localeFilter) && localeFilter.length === 1;
  const devServerOutputPath = !differentDevServerOutputPath
    ? browserOutputPath
    : path.join(outputOptions.base, outputOptions.browser, localeFilter[0]!);

  const entryPoints: string[] | undefined =
    nfBuilderOptions.entryPoints && nfBuilderOptions.entryPoints.length > 0
      ? nfBuilderOptions.entryPoints
      : [path.join(path.dirname(ngBuilderOptions.tsConfig), 'src/main.ts')];

  const cachePath = getDefaultCachePath(context.workspaceRoot);

  const normalized = await normalizeFederationOptions(
    {
      projectName: nfBuilderOptions.projectName,
      workspaceRoot: context.workspaceRoot,
      outputPath: browserOutputPath,
      federationConfig: inferConfigPath(ngBuilderOptions.tsConfig),
      tsConfig: ngBuilderOptions.tsConfig,
      verbose: ngBuilderOptions.verbose,
      watch: ngBuilderOptions.watch,
      dev: !!nfBuilderOptions.dev,
      entryPoints,
      buildNotifications: nfBuilderOptions.buildNotifications,
      cacheExternalArtifacts: nfBuilderOptions.cacheExternalArtifacts !== false,
    },
    createFederationCache(cachePath, new SourceFileCache(cachePath))
  );

  checkForInvalidImports(Object.values(normalized.config.sharedMappings), 'shared mappings');
  checkForInvalidImports(Object.keys(normalized.config.shared), 'externals');

  const activateSsr = nfBuilderOptions.ssr && !nfBuilderOptions.dev;

  const start = process.hrtime();
  logger.measure(start, 'To load the federation config.');

  const externals = getExternals(normalized.config);
  const plugins = [
    {
      name: 'externals',
      setup(build: PluginBuild) {
        if (!activateSsr && build.initialOptions.platform !== 'node') {
          build.initialOptions.external = externals.filter(e => e !== 'tslib');
        }
      },
    },
    // Inject custom esbuild plugins
    ...(Array.isArray(nfBuilderOptions.plugins) ? nfBuilderOptions.plugins : []),
  ];

  // SSR build fails when externals are provided via the plugin
  if (activateSsr) {
    ngBuilderOptions.externalDependencies = externals;
  }

  const isLocalDevelopment = runServer && nfBuilderOptions.dev;

  // Initialize SSE reloader only for local development
  if (isLocalDevelopment && nfBuilderOptions.buildNotifications?.enable) {
    federationBuildNotifier.initialize(nfBuilderOptions.buildNotifications.endpoint);
  }

  const middleware = [
    ...(isLocalDevelopment
      ? [
          federationBuildNotifier.createEventMiddleware(req =>
            removeBaseHref(req, ngBuilderOptions.baseHref)
          ),
        ]
      : []),

    (
      req: { url?: string },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      },
      next: () => void
    ) => {
      const url = removeBaseHref(req, ngBuilderOptions.baseHref);

      const fileName = path.join(normalized.options.workspaceRoot, devServerOutputPath, url);

      const exists = fs.existsSync(fileName);

      if (url !== '/' && url !== '' && exists) {
        const lookup = mrmime.lookup;
        const mimeType = lookup(path.extname(fileName)) || 'text/javascript';
        const rawBody = fs.readFileSync(fileName, 'utf-8');

        // TODO: Evaluate need for debug infos
        // const body = addDebugInformation(url, rawBody);
        const body = rawBody;

        res.writeHead(200, {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end(body);
      } else {
        next();
      }
    },
  ];

  let first = true;

  const nfWatcher: NfWatcher | undefined =
    nfBuilderOptions.dev || watch ? createNfWatcher() : undefined;

  if (nfWatcher) {
    nfWatcher.add(path.dirname(path.resolve(context.workspaceRoot, ngBuilderOptions.tsConfig)));
  }

  if (existsSync(normalized.options.outputPath)) {
    rmSync(normalized.options.outputPath, { recursive: true });
  }

  if (!existsSync(normalized.options.outputPath)) {
    mkdirSync(normalized.options.outputPath, { recursive: true });
  }

  let federationResult: FederationInfo;
  try {
    federationResult = await buildForFederation(normalized.config, normalized.options, externals);
  } catch (e) {
    logger.error((e as Error)?.message ?? 'Building the artifacts failed');
    process.exit(1);
  }

  if (nfWatcher) {
    syncNfWatcher(nfWatcher, normalized.options.federationCache.bundlerCache);
  }

  if (activateSsr) {
    writeFstartScript(normalized.options);
  }

  const hasLocales = i18n?.locales && Object.keys(i18n.locales).length > 0;
  if (hasLocales && localeFilter) {
    const start = process.hrtime();

    translateFederationArtifacts(i18n, localeFilter, outputOptions.base, federationResult);
    logger.measure(start, 'To translate the artifacts.');
  }

  ngBuilderOptions.deleteOutputPath = false;

  const appBuilderName = '@angular/build:application';

  const builderRun = runServer
    ? serveWithVite(
        serverOptions as unknown as Parameters<typeof serveWithVite>[0],
        appBuilderName,
        createInternalAngularBuilder(externals),
        context,
        nfBuilderOptions.skipHtmlTransform
          ? {}
          : { indexHtml: transformIndexHtml(nfBuilderOptions) },
        {
          buildPlugins: plugins,
          middleware,
        }
      )
    : buildApplication(ngBuilderOptions, context, {
        codePlugins: plugins,
        indexHtmlTransformer: transformIndexHtml(nfBuilderOptions),
      });

  const rebuildQueue = new RebuildQueue();

  const builderIterator = builderRun[Symbol.asyncIterator]();

  let ngBuildStatus: { success: boolean } = { success: false };

  try {
    let buildResult = await builderIterator.next();

    while (!buildResult.done) {
      if (buildResult.value) ngBuildStatus = buildResult.value;

      if (!ngBuildStatus.success) {
        logger.warn('Skipping federation artifacts because Angular build failed.');
        buildResult = await builderIterator.next();
      } else if (!first && (nfBuilderOptions.dev || watch)) {
        const nextOutputPromise = builderIterator.next();

        const trackResult = await rebuildQueue.track(async (signal: AbortSignal) => {
          try {
            if (signal?.aborted) {
              throw new AbortedError('Build canceled before starting');
            }

            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, Math.max(10, nfBuilderOptions.rebuildDelay));

              if (signal) {
                const abortHandler = () => {
                  clearTimeout(timeout);
                  reject(new AbortedError('[builder] During delay.'));
                };
                signal.addEventListener('abort', abortHandler, { once: true });
              }
            });

            if (signal?.aborted) {
              throw new AbortedError('[builder] Before federation build.');
            }

            // Invalidate only files that changed since the last rebuild, falling back to all
            // source files when the buffer is empty (e.g. first watch rebuild).
            const pendingFiles = nfWatcher ? [...nfWatcher.pendingChanges] : [];

            if (nfWatcher) nfWatcher.pendingChanges.clear();

            federationResult = await rebuildForFederation(
              normalized.config,
              normalized.options,
              externals,
              pendingFiles,
              signal
            );

            if (nfWatcher) {
              syncNfWatcher(nfWatcher, normalized.options.federationCache.bundlerCache);
            }

            if (signal?.aborted) {
              throw new AbortedError('[builder] After federation build.');
            }

            if (hasLocales && localeFilter) {
              translateFederationArtifacts(
                i18n,
                localeFilter,
                outputOptions.base,
                federationResult
              );
            }

            if (signal?.aborted) {
              throw new AbortedError('[builder] After federation translations.');
            }

            logger.info('Done!');

            if (isLocalDevelopment) {
              federationBuildNotifier.broadcastBuildCompletion();
            }
            return { success: true };
          } catch (error) {
            if (error instanceof AbortedError) {
              logger.verbose('Rebuild was canceled. Cancellation point: ' + error?.message);
              federationBuildNotifier.broadcastBuildCancellation();
              return { success: false, cancelled: true };
            }
            logger.error('Federation rebuild failed!');
            if (ngBuilderOptions.verbose) console.error(error);
            if (isLocalDevelopment) {
              federationBuildNotifier.broadcastBuildError(error);
            }
            return { success: false };
          }
        }, nextOutputPromise);

        if (trackResult.type === 'completed') {
          if (!trackResult.result.cancelled) {
            yield { success: trackResult.result.success };
          }
          buildResult = await nextOutputPromise;
        } else {
          buildResult = trackResult.value;
        }
      } else {
        buildResult = await builderIterator.next();
      }
      first = false;
    }
  } finally {
    rebuildQueue.dispose();
    await adapter.dispose();
    await nfWatcher?.close();

    if (isLocalDevelopment) {
      federationBuildNotifier.stopEventServer();
    }
  }

  yield ngBuildStatus;
}

function removeBaseHref(req: { url?: string }, baseHref?: string) {
  let url = req.url ?? '';

  if (baseHref && url.startsWith(baseHref)) {
    url = url.substr(baseHref.length);
  }
  return url;
}

function writeFstartScript(nfOptions: NormalizedFederationOptions) {
  const serverOutpath = path.join(nfOptions.outputPath, '../server');
  const fstartPath = path.join(serverOutpath, 'fstart.mjs');
  const buffer = Buffer.from(fstart, 'base64');
  fs.mkdirSync(serverOutpath, { recursive: true });
  fs.writeFileSync(fstartPath, buffer, 'utf-8');
}

function getLocaleFilter(options: ApplicationBuilderOptions, runServer: boolean) {
  let localize = options.localize || false;

  if (runServer && Array.isArray(localize) && localize.length > 1) {
    localize = false;
  }

  if (runServer && localize === true) {
    localize = false;
  }
  return localize;
}

function inferConfigPath(tsConfig: string): string {
  const relProjectPath = path.dirname(tsConfig);
  const relConfigPath = path.join(relProjectPath, 'federation.config.js');

  return relConfigPath;
}

function transformIndexHtml(nfOptions: NfBuilderSchema): (content: string) => Promise<string> {
  return (content: string): Promise<string> =>
    Promise.resolve(updateScriptTags(content, nfOptions));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createBuilder(runBuilder) as any;
