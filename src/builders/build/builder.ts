import "./setup-builder-env-variables.js";

import * as fs from "fs";
import * as mrmime from "mrmime";
import * as path from "path";

import {
  type ApplicationBuilderOptions,
  buildApplication,
} from "@angular/build";
import {
  buildApplicationInternal,
  normalizeDevServerOptions,
  serveWithVite,
  SourceFileCache,
} from "@angular/build/private";

import {
  type BuilderContext,
  type BuilderOutput,
  createBuilder,
  targetFromTargetString,
} from "@angular-devkit/architect";

import { type JsonObject } from "@angular-devkit/core";
import {
  buildForFederation,
  createFederationCache,
  type FederationInfo,
  getExternals,
  normalizeFederationOptions,
  rebuildForFederation,
  setBuildAdapter,
} from "@softarc/native-federation";
import {
  AbortedError,
  createNfWatcher,
  getDefaultCachePath,
  linkedSharedDirs,
  logger,
  type NfFileWatcher,
  RebuildQueue,
  setLogLevel,
  syncNfFileWatcher,
} from "@softarc/native-federation/internal";
import { type Plugin, type PluginBuild } from "esbuild";
import { devHostInstancesPlugin } from "../../plugin/dev-host-instances-plugin.js";
import { checkForInvalidImports } from "./../../utils/check-for-invalid-imports.js";
import { federationBuildNotifier } from "./federation-build-notifier.js";
import type { NfBuilderSchema, NfInternalOptions } from "./schema.js";
import { createAngularBuildAdapter } from "../../tools/esbuild/angular-esbuild-adapter.js";
import { getI18nConfig, translateFederationArtifacts } from "./i18n.js";
import { updateScriptTags } from "./update-index-html.js";

const originalWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void,
): boolean {
  const str = typeof chunk === "string" ? chunk : chunk.toString();

  if (
    str.includes("vite:import-analysis") &&
    str.includes("es-module-shims.js")
  ) {
    return true;
  }

  if (typeof encodingOrCallback !== "string") {
    return originalWrite(chunk, encodingOrCallback);
  }

  return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
};

const createInternalAngularBuilder =
  (
    externals: string[],
    opts?: { instrumentForCoverage?: (filename: string) => boolean },
  ) =>
  (
    options: Parameters<typeof buildApplicationInternal>[0],
    context: BuilderContext,
    pluginsOrExtensions?:
      | Plugin[]
      | Parameters<typeof buildApplicationInternal>[2],
  ) => {
    let extensions: Parameters<typeof buildApplicationInternal>[2];
    if (pluginsOrExtensions && Array.isArray(pluginsOrExtensions)) {
      extensions = {
        codePlugins: pluginsOrExtensions,
      };
    } else {
      extensions = pluginsOrExtensions as Parameters<
        typeof buildApplicationInternal
      >[2];
    }

    // serveWithVite fetches its own browserOptions independently, so ngBuilderOptions
    // modifications don't reach here. Add NF externals to externalDependencies so
    // Angular routes them to optimizeDeps.exclude, preventing Vite from trying to
    // pre-bundle packages that include native .node binaries.
    options.externalDependencies = [
      ...(options.externalDependencies ?? []),
      ...externals,
    ];

    if (opts?.instrumentForCoverage) {
      options.instrumentForCoverage = opts.instrumentForCoverage;
    }

    // Todo: share cache with Angular builder: https://github.com/angular/angular-cli/pull/32527
    // options.codeBundleCache = nfOptions.federationCache.bundlerCache;
    return buildApplicationInternal(options, context, extensions);
  };

export async function* runBuilder(
  nfBuilderOptions: NfBuilderSchema & NfInternalOptions,
  context: BuilderContext,
): AsyncIterable<BuilderOutput> {
  let target = targetFromTargetString(nfBuilderOptions.target);

  let targetOptions = (await context.getTargetOptions(
    target,
  )) as unknown as JsonObject & ApplicationBuilderOptions;

  let builder = await context.getBuilderNameForTarget(target);

  if (builder === "@angular-devkit/build-angular:browser-esbuild") {
    logger.info(".: NATIVE FEDERATION - UPDATE NEEDED :.");
    logger.info("");
    logger.info("Since version 17.1, Native Federation uses Angular's");
    logger.info("Application-Builder and its Dev-Server.");
    logger.info("");
    logger.info("If you are sill on Angular 17.0.x, please update to");
    logger.info("Angular 17.1.x or downgrade to Native Federation 17.0.x.");
    logger.info("");
    logger.info("For working with Native Federation 17.1.x (recommented), ");
    logger.info("please update your project config, e.g. in angular.json");
    logger.info("");
    logger.info("This command performs the needed update for default configs:");
    logger.info("");
    logger.info("\tng g @angular-architects/native-federation:appbuilder");
    logger.info("");
    logger.info("You need to run it once per application to migrate");
    logger.info("Please find more information here: https://shorturl.at/gADJW");
    return;
  }

  /**
   * Explicitly defined as devServer or if the target contains "serve"
   */
  const runViteServer =
    typeof nfBuilderOptions.devServer !== "undefined"
      ? !!nfBuilderOptions.devServer
      : target.target.includes("serve");

  let ngBuilderOptions = (await context.validateOptions(
    runViteServer
      ? ({
          ...targetOptions,
          port: nfBuilderOptions.port || targetOptions["port"],
        } as JsonObject)
      : targetOptions,
    builder,
  )) as JsonObject & ApplicationBuilderOptions;

  let serverOptions = null;

  const watch =
    nfBuilderOptions.watch ?? ngBuilderOptions.watch ?? runViteServer;
  ngBuilderOptions.watch = watch;

  if (ngBuilderOptions["buildTarget"]) {
    serverOptions = await normalizeDevServerOptions(
      context,
      context.target!.project,
      ngBuilderOptions as unknown as Parameters<
        typeof normalizeDevServerOptions
      >[2],
    );

    target = targetFromTargetString(ngBuilderOptions["buildTarget"] as string);
    targetOptions = (await context.getTargetOptions(
      target,
    )) as unknown as JsonObject & ApplicationBuilderOptions;

    builder = await context.getBuilderNameForTarget(target);
    ngBuilderOptions = (await context.validateOptions(
      targetOptions,
      builder,
    )) as JsonObject & ApplicationBuilderOptions;
  }

  if (nfBuilderOptions.baseHref) {
    ngBuilderOptions.baseHref = nfBuilderOptions.baseHref;
  }

  if (nfBuilderOptions.outputPath) {
    ngBuilderOptions.outputPath = nfBuilderOptions.outputPath;
  }

  const federationTsConfig =
    !!nfBuilderOptions.tsConfig && nfBuilderOptions.tsConfig.length > 0
      ? nfBuilderOptions.tsConfig
      : ngBuilderOptions.tsConfig;

  const adapter = createAngularBuildAdapter(
    {
      ...ngBuilderOptions,
      plugins: nfBuilderOptions.plugins,
      instrumentForCoverage: nfBuilderOptions.instrumentForCoverage,
    },
    context,
  );

  setBuildAdapter(adapter);

  setLogLevel(ngBuilderOptions.verbose ? "verbose" : "info");

  if (!ngBuilderOptions.outputPath) {
    ngBuilderOptions.outputPath = `dist/${context.target!.project}`;
  }

  const outputPath = ngBuilderOptions.outputPath;
  const outputOptions: Required<
    Exclude<ApplicationBuilderOptions["outputPath"], string>
  > = {
    browser: "browser",
    server: "server",
    media: "media",
    ...(typeof outputPath === "string" ? undefined : outputPath),
    base: typeof outputPath === "string" ? outputPath : outputPath.base,
  };

  const i18n = await getI18nConfig(context);

  const localeFilter = getLocaleFilter(ngBuilderOptions, runViteServer);

  const sourceLocaleSegment =
    typeof i18n?.sourceLocale === "string"
      ? i18n.sourceLocale
      : i18n?.sourceLocale?.subPath || i18n?.sourceLocale?.code || "";

  const browserOutputPath = path.join(
    outputOptions.base,
    outputOptions.browser,
    ngBuilderOptions.localize ? sourceLocaleSegment : "",
  );

  const differentDevServerOutputPath =
    Array.isArray(localeFilter) && localeFilter.length === 1;
  const devServerOutputPath = !differentDevServerOutputPath
    ? browserOutputPath
    : path.join(outputOptions.base, outputOptions.browser, localeFilter[0]!);

  const entryPoints: string[] | undefined =
    nfBuilderOptions.entryPoints && nfBuilderOptions.entryPoints.length > 0
      ? nfBuilderOptions.entryPoints
      : [path.join(path.dirname(federationTsConfig), "src/main.ts")];

  const cachePath = getDefaultCachePath(context.workspaceRoot);

  const normalized = await normalizeFederationOptions(
    {
      projectName: nfBuilderOptions.projectName,
      workspaceRoot: context.workspaceRoot,
      outputPath: browserOutputPath,
      federationConfig: inferConfigPath(
        federationTsConfig,
        context.workspaceRoot,
        nfBuilderOptions.federationConfigPath,
      ),
      tsConfig: federationTsConfig,
      verbose: ngBuilderOptions.verbose,
      watch: ngBuilderOptions.watch,
      dev: !!nfBuilderOptions.dev,
      entryPoints,
      buildNotifications: nfBuilderOptions.buildNotifications,
      cacheExternalArtifacts: nfBuilderOptions.cacheExternalArtifacts !== false,
    },
    createFederationCache(cachePath, new SourceFileCache(cachePath)),
  );

  checkForInvalidImports(
    Object.values(normalized.config.sharedMappings),
    "shared mappings",
  );
  checkForInvalidImports(Object.keys(normalized.config.shared), "externals");

  const activateSsr = nfBuilderOptions.ssr && !nfBuilderOptions.dev;

  const start = process.hrtime();
  logger.measure(start, "To load the federation config.");

  const externals = getExternals(normalized.config);

  // Realpath'd dirs of npm-linked shared packages (`[]` if none, making the
  // syncNfFileWatcher calls below a no-op) so the linked lib's real source is watched.
  const linkedDirs = linkedSharedDirs(normalized.config, normalized.options);

  const plugins = [
    {
      name: "externals",
      setup(build: PluginBuild) {
        if (!activateSsr && build.initialOptions.platform !== "node") {
          build.initialOptions.external = externals.filter(
            (e) => e !== "tslib",
          );
        }
      },
    },
    // Inject custom esbuild plugins
    ...(Array.isArray(nfBuilderOptions.plugins)
      ? nfBuilderOptions.plugins
      : []),
  ];

  // SSR build fails when externals are provided via the plugin
  if (activateSsr) {
    ngBuilderOptions.externalDependencies = externals;
  }

  const isLocalDevelopment = runViteServer && nfBuilderOptions.dev;

  // Dev SSR: inject a bootstrap that inits federation and bridges the host's
  // singletons to remotes. The plugin self-gates on platform === 'node', so
  // it's a no-op for CSR dev servers. (Prod SSR registers the loader at launch
  // via the `node --import .../node-preload` preload — see src/node-preload.ts.)
  if (isLocalDevelopment) {
    // The bridge fetches the manifest over HTTP from the dev server's origin
    // (Vite never writes it to disk under `ng serve`).
    const devServerOrigin = getDevServerOrigin(serverOptions);

    // The injected bridge (a real, compiled module — see the plugin) reads these
    // at eval time. `process.env` is process-global, so it crosses the Vite SSR
    // realm boundary that `globalThis` would not, and mirrors how prod's
    // node-preload is configured.
    process.env["NF_DEV_SSR_BROWSER_PATH"] = browserOutputPath;
    if (devServerOrigin) {
      process.env["NF_DEV_SSR_ORIGIN"] = devServerOrigin;
    } else {
      delete process.env["NF_DEV_SSR_ORIGIN"];
    }

    plugins.push(devHostInstancesPlugin());
  }

  // Initialize SSE reloader only for local development
  if (isLocalDevelopment && nfBuilderOptions.buildNotifications?.enable) {
    federationBuildNotifier.initialize(
      nfBuilderOptions.buildNotifications.endpoint,
    );
  }

  const middleware = [
    ...(isLocalDevelopment
      ? [
          federationBuildNotifier.createEventMiddleware((req) =>
            removeBaseHref(req, ngBuilderOptions.baseHref),
          ),
        ]
      : []),

    (
      req: { url?: string },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      },
      next: () => void,
    ) => {
      const rawUrl = removeBaseHref(req, ngBuilderOptions.baseHref);

      const url = new URL(rawUrl || "/", "http://localhost").pathname;

      const fileName = path.join(
        normalized.options.workspaceRoot,
        devServerOutputPath,
        url,
      );

      const exists = fs.existsSync(fileName);

      if (url !== "/" && url !== "" && exists) {
        const lookup = mrmime.lookup;
        const mimeType = lookup(path.extname(fileName)) || "text/javascript";
        const rawBody = fs.readFileSync(fileName, "utf-8");

        // TODO: Evaluate need for debug infos
        // const body = addDebugInformation(url, rawBody);
        const body = rawBody;

        res.writeHead(200, {
          "Content-Type": mimeType,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end(body);
      } else {
        next();
      }
    },
  ];

  let first = true;

  // A linked shared-package edit never makes Angular's iterator emit (it's an external),
  // so we wake the watch loop directly: notifyChange resolves changeSignal, which the
  // loop races against Angular's next output to drive a federation-only rebuild.
  let notifyChange: () => void = () => {};
  let changeSignal: Promise<void> = new Promise<void>(
    (r) => (notifyChange = r),
  );
  let changeTagged: Promise<{ kind: "watcher" }> = changeSignal.then(() => ({
    kind: "watcher" as const,
  }));
  const resetChangeSignal = (): void => {
    changeSignal = new Promise<void>((r) => (notifyChange = r));
    changeTagged = changeSignal.then(() => ({ kind: "watcher" as const }));
  };
  const isUnderLinkedDir = (p: string): boolean =>
    linkedDirs.some((d) => p === d || p.startsWith(d + path.sep));

  // watcherRef lets onChange reach the watcher without a const self-reference.
  const watcherRef: { current?: NfFileWatcher } = {};
  const nfWatcher: NfFileWatcher | undefined = watch
    ? createNfWatcher({
        // Coalesce ng-packagr's atomic multi-write bursts into one rebuild.
        debounceMs: 100,
        onChange: (p) => {
          // Core stops filling the dirty buffer once onChange is set, so refill it
          // here (Set.add stays idempotent if core is later fixed). Only wake the
          // loop for linked edits; others ride the next Angular-driven rebuild.
          watcherRef.current?.mutate((s) => s.add(p));
          if (isUnderLinkedDir(p)) notifyChange();
        },
      })
    : undefined;
  watcherRef.current = nfWatcher;

  if (nfWatcher) {
    nfWatcher.addPaths(
      path.dirname(path.resolve(context.workspaceRoot, federationTsConfig)),
    );
  }

  if (fs.existsSync(normalized.options.outputPath)) {
    fs.rmSync(normalized.options.outputPath, { recursive: true });
  }

  if (!fs.existsSync(normalized.options.outputPath)) {
    fs.mkdirSync(normalized.options.outputPath, { recursive: true });
  }

  let federationResult: FederationInfo;
  try {
    federationResult = await buildForFederation(
      normalized.config,
      normalized.options,
      externals,
    );
  } catch (e) {
    logger.error((e as Error)?.message ?? "Building the artifacts failed");
    process.exit(1);
  }

  // Dispose the finished federation context so its compiler-plugin onDispose resets
  // Angular's shared TS compilation state before the app build (#47); watch reuses it.
  if (!watch) {
    await adapter.dispose("mapping-or-exposed").catch(() => undefined);
  }

  if (nfWatcher) {
    syncNfFileWatcher(
      nfWatcher,
      normalized.options.federationCache.bundlerCache,
      linkedDirs,
    );
  }

  const hasLocales = i18n?.locales && Object.keys(i18n.locales).length > 0;
  if (hasLocales && localeFilter) {
    const start = process.hrtime();

    translateFederationArtifacts(
      i18n,
      localeFilter,
      outputOptions.base,
      federationResult,
    );
    logger.measure(start, "To translate the artifacts.");
  }

  ngBuilderOptions.deleteOutputPath = false;

  const appBuilderName = "@angular/build:application";

  const builderRun = runViteServer
    ? serveWithVite(
        serverOptions as unknown as Parameters<typeof serveWithVite>[0],
        appBuilderName,
        createInternalAngularBuilder(externals, {
          instrumentForCoverage: nfBuilderOptions.instrumentForCoverage,
        }),
        context,
        nfBuilderOptions.skipHtmlTransform
          ? {}
          : { indexHtml: transformIndexHtml(nfBuilderOptions) },
        {
          buildPlugins: plugins,
          middleware,
        },
      )
    : buildApplication(
        {
          ...ngBuilderOptions,
          ...(nfBuilderOptions.instrumentForCoverage
            ? { instrumentForCoverage: nfBuilderOptions.instrumentForCoverage }
            : {}),
        } as typeof ngBuilderOptions,
        context,
        {
          codePlugins: plugins,
          indexHtmlTransformer: transformIndexHtml(nfBuilderOptions),
        },
      );

  const rebuildQueue = new RebuildQueue();

  const builderIterator = builderRun[Symbol.asyncIterator]();

  let ngBuildStatus: { success: boolean } = { success: false };

  // Shared by both rebuild triggers. RebuildQueue serializes calls (aborts + awaits the
  // previous build before starting the next), so the two drivers never run this at once.
  const runFederationRebuild = async (
    signal: AbortSignal,
  ): Promise<{ success: boolean; cancelled?: boolean }> => {
    try {
      if (signal?.aborted) {
        throw new AbortedError("Build canceled before starting");
      }

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          resolve,
          Math.max(10, nfBuilderOptions.rebuildDelay),
        );

        if (signal) {
          const abortHandler = () => {
            clearTimeout(timeout);
            reject(new AbortedError("[builder] During delay."));
          };
          signal.addEventListener("abort", abortHandler, {
            once: true,
          });
        }
      });

      if (signal?.aborted) {
        throw new AbortedError("[builder] Before federation build.");
      }

      // Invalidate only files that changed since the last rebuild, falling back to all
      // source files when the buffer is empty (e.g. first watch rebuild). Unlike the
      // remote builder, the buffer is cleared eagerly here because Angular's iterator —
      // not this buffer — re-triggers the next Angular-driven rebuild.
      const changedFiles = nfWatcher ? [...nfWatcher.get()] : [];

      if (nfWatcher) nfWatcher.clear();

      federationResult = await rebuildForFederation(
        normalized.config,
        normalized.options,
        externals,
        changedFiles,
        signal,
      );

      if (nfWatcher) {
        syncNfFileWatcher(
          nfWatcher,
          normalized.options.federationCache.bundlerCache,
          linkedDirs,
        );
      }

      if (signal?.aborted) {
        throw new AbortedError("[builder] After federation build.");
      }

      if (hasLocales && localeFilter) {
        translateFederationArtifacts(
          i18n,
          localeFilter,
          outputOptions.base,
          federationResult,
        );
      }

      if (signal?.aborted) {
        throw new AbortedError("[builder] After federation translations.");
      }

      logger.info("Done!");

      if (isLocalDevelopment) {
        federationBuildNotifier.broadcastBuildCompletion();
      }
      return { success: true };
    } catch (error) {
      if (error instanceof AbortedError) {
        logger.verbose(
          "Rebuild was canceled. Cancellation point: " + error?.message,
        );
        federationBuildNotifier.broadcastBuildCancellation();
        return { success: false, cancelled: true };
      }
      logger.error("Federation rebuild failed!");
      if (ngBuilderOptions.verbose) console.error(error);
      if (isLocalDevelopment) {
        federationBuildNotifier.broadcastBuildError(error);
      }
      return { success: false };
    }
  };

  try {
    // In-flight Angular output, tagged for the race below and only reassigned when
    // consumed (so a linked-package rebuild preserves it). The tag captures a rejected
    // iterator instead of rejecting — re-thrown on consume — so a losing race can't leak
    // an unhandled rejection.
    let angularNext = builderIterator.next();
    let angularTagged = angularNext.then(
      (r) => ({ kind: "angular" as const, r, err: undefined as unknown }),
      (err) => ({ kind: "angular" as const, r: undefined, err }),
    );
    const advanceAngular = (): void => {
      angularNext = builderIterator.next();
      angularTagged = angularNext.then(
        (r) => ({ kind: "angular" as const, r, err: undefined as unknown }),
        (err) => ({ kind: "angular" as const, r: undefined, err }),
      );
    };

    while (true) {
      const trigger = await Promise.race([angularTagged, changeTagged]);

      // A linked shared-package edit: Angular produced nothing, so rebuild federation
      // only and leave the pending Angular output in flight for the next race.
      if (trigger.kind === "watcher") {
        resetChangeSignal();
        if (first || !nfWatcher || nfWatcher.get().size === 0) continue;

        // Interrupt on the next linked edit so a fresh save folds into one rebuild.
        const trackResult = await rebuildQueue.track(
          runFederationRebuild,
          changeSignal,
        );
        if (trackResult.type === "completed" && !trackResult.result.cancelled) {
          yield { success: trackResult.result.success };
        }
        continue;
      }

      if (trigger.err) throw trigger.err;
      const buildResult = trigger.r!;
      if (buildResult.done) break;
      if (buildResult.value) ngBuildStatus = buildResult.value;

      // Consume this output and prime the next; the primed promise doubles as the
      // interrupt for the rebuild below (a fresh Angular build aborts the stale one).
      advanceAngular();

      if (!ngBuildStatus.success) {
        logger.warn(
          "Skipping federation artifacts because Angular build failed.",
        );
        first = false;
        continue;
      }

      // The initial output's federation artifacts were already built above; only
      // rebuild on subsequent outputs, and only in watch mode.
      if (first || !watch) {
        first = false;
        continue;
      }

      const trackResult = await rebuildQueue.track(
        runFederationRebuild,
        angularNext,
      );

      // 'completed': the primed output is still pending — the next race consumes it.
      // 'interrupted': the primed output resolved (a newer Angular build) — the next
      // race consumes that resolved promise immediately, matching the old feed-back.
      if (trackResult.type === "completed" && !trackResult.result.cancelled) {
        ngBuildStatus = { success: trackResult.result.success };
        yield ngBuildStatus;
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
  let url = req.url ?? "";

  if (baseHref && url.startsWith(baseHref)) {
    url = url.slice(baseHref.length);
  }
  return url;
}

/**
 * Build the dev server's origin (e.g. `http://localhost:4200`) from the resolved
 * dev-server options, whose `port` Angular's normalizeOptions already defaults.
 * Omits the port when none is set, and returns undefined when there are no serve
 * options at all, so the bridge falls back to the on-disk manifest path.
 */
function getDevServerOrigin(
  serverOptions: { ssl?: boolean; host?: string; port?: number } | null,
): string | undefined {
  if (!serverOptions) {
    return undefined;
  }
  const protocol = serverOptions.ssl ? "https" : "http";
  const host = serverOptions.host || "localhost";
  return serverOptions.port
    ? `${protocol}://${host}:${serverOptions.port}`
    : `${protocol}://${host}`;
}

function getLocaleFilter(
  options: ApplicationBuilderOptions,
  runViteServer: boolean,
) {
  let localize = options.localize || false;

  if (runViteServer && Array.isArray(localize) && localize.length > 1) {
    localize = false;
  }

  if (runViteServer && localize === true) {
    localize = false;
  }
  return localize;
}

function inferConfigPath(
  tsConfig: string,
  workspaceRoot: string,
  federationConfigPath = "federation.config.mjs",
): string {
  const relProjectPath = path.dirname(tsConfig);

  const mjsRelPath = path.join(relProjectPath, federationConfigPath);

  if (fs.existsSync(path.resolve(workspaceRoot, mjsRelPath))) {
    return mjsRelPath;
  }

  return path.join(relProjectPath, "federation.config.js");
}

function transformIndexHtml(
  nfOptions: NfBuilderSchema,
): (content: string) => Promise<string> {
  return (content: string): Promise<string> =>
    Promise.resolve(updateScriptTags(content, nfOptions));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default createBuilder(runBuilder) as any;
