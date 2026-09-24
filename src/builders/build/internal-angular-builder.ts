import { buildApplicationInternal } from "@angular/build/private";
import { type BuilderContext } from "@angular-devkit/architect";
import { type Plugin } from "esbuild";

export const createInternalAngularBuilder =
  (
    externals: string[],
    opts?: { define?: Record<string, string> },
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

    // serveWithVite fetches its own browserOptions independently, so ngBuilderOptions
    // modifications don't reach here. Add NF externals to externalDependencies so
    // Angular routes them to optimizeDeps.exclude, preventing Vite from trying to
    // pre-bundle packages that include native .node binaries.
    options.externalDependencies = [
      ...(options.externalDependencies ?? []),
      ...externals,
    ];

    if (opts?.define) {
      options.define = { ...options.define, ...opts.define };
    }

    // Todo: share cache with Angular builder: https://github.com/angular/angular-cli/pull/32527
    // options.codeBundleCache = nfOptions.federationCache.bundlerCache;
    return buildApplicationInternal(options, context, extensions);
  };
