import { buildApplicationInternal } from "@angular/build/private";
import { type BuilderContext } from "@angular-devkit/architect";
import { type Plugin } from "esbuild";

export const createInternalAngularBuilder =
  (
    externals: string[],
    opts?: {
      define?: Record<string, string>;
      // True when the builder's `externals` plugin marks them in the browser bundle.
      externalsPlugin?: boolean;
    },
  ) =>
  (
    options: Parameters<typeof buildApplicationInternal>[0],
    context: BuilderContext,
    pluginsOrExtensions?:
      Plugin[] | Parameters<typeof buildApplicationInternal>[2],
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

    const targetExternals = options.externalDependencies;

    // serveWithVite fetches its own browserOptions independently, so ngBuilderOptions
    // modifications don't reach here. Add NF externals to externalDependencies so
    // Angular routes them to optimizeDeps.exclude, preventing Vite from trying to
    // pre-bundle packages that include native .node binaries. serveWithVite reads
    // them back from these options after each build.
    options.externalDependencies = [...(targetExternals ?? []), ...externals];

    if (opts?.define) {
      options.define = { ...options.define, ...opts.define };
    }

    // Stylesheets get externalDependencies too (#167); server bundles and their polyfills only get
    // them from here. Proxy, not copy: serveWithVite reads normalizeOptions' ssr/prerender writes.
    const buildOptions =
      opts?.externalsPlugin && !options.server
        ? new Proxy(options, {
            get: (target, key, receiver) =>
              key === "externalDependencies"
                ? targetExternals
                : Reflect.get(target, key, receiver),
          })
        : options;

    // Todo: share cache with Angular builder: https://github.com/angular/angular-cli/pull/32527
    // options.codeBundleCache = nfOptions.federationCache.bundlerCache;
    return buildApplicationInternal(buildOptions, context, extensions);
  };
