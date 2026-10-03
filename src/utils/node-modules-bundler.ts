import * as esbuild from "esbuild";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "node:crypto";

import { JavaScriptTransformer } from "@angular/build/private";

import type { NormalizedContextOptions } from "./normalize-context-options.js";
import type { SharedBundleSettings } from "./shared-bundle-settings.js";
import { getScriptBuildOptions } from "./script-options.js";
import { createSourcemapIgnorelistPlugin } from "./sourcemap-ignorelist-plugin.js";

const LINKER_DECLARATION_PREFIX = "ɵɵngDeclare";

// Shared bundles run on both server and browser, so `ngServerMode` can't be a `define` here.
// Raw text: esbuild doesn't lower banners to the target. (#157)
export const NG_SERVER_MODE_BANNER =
  "if (typeof globalThis.ngServerMode === 'undefined') globalThis.ngServerMode = typeof window === 'undefined';";

/**
 * Excludes @angular/core and @angular/compiler which define the declarations
 * and would cause false positives.
 */
export function requiresLinking(filePath: string, source: string): boolean {
  if (/[\\/]@angular[\\/](?:compiler|core)[\\/]/.test(filePath)) {
    return false;
  }

  return source.includes(LINKER_DECLARATION_PREFIX);
}

/**
 * Creates an esbuild plugin that applies the Angular linker to partially compiled
 * Angular libraries like a design system.
 *
 * Uses Angular's JavaScriptTransformer which handles linking internally.
 */
export function createAngularLinkerPlugin(
  jsTransformer: JavaScriptTransformer,
  advancedOptimizations: boolean,
  cache?: { store: Map<string, Uint8Array>; keyBase: string },
): esbuild.Plugin {
  return {
    name: "angular-linker",
    setup(build) {
      build.onLoad({ filter: /\.m?js$/ }, async (args) => {
        const contents = await fs.promises.readFile(args.path, "utf-8");

        const needsLinking = requiresLinking(args.path, contents);

        if (!needsLinking && !advancedOptimizations) {
          return { contents, loader: "js" };
        }

        const cacheKey = cache
          ? createHash("sha256")
              .update(`${cache.keyBase}--${needsLinking}--${args.path}--`)
              .update(contents)
              .digest("hex")
          : undefined;
        const cached = cacheKey && cache?.store.get(cacheKey);
        if (cached !== undefined) {
          return { contents: cached, loader: "js" };
        }

        const result = await jsTransformer.transformData(
          args.path,
          contents,
          !needsLinking,
        );
        if (cacheKey) cache?.store.set(cacheKey, result);

        return { contents: result, loader: "js" };
      });
    },
  };
}

const jsTransformerCacheStores = new Map<string, Map<string, Uint8Array>>();

function getOrCreateJsTransformerCacheStore(
  cachePath: string,
): Map<string, Uint8Array> {
  let store = jsTransformerCacheStores.get(cachePath);
  if (!store) {
    store = new Map<string, Uint8Array>();
    jsTransformerCacheStores.set(cachePath, store);
  }
  return store;
}

// No builderOptions: they reach the shared bundle only through the keyed `settings` (#148).
export async function createNodeModulesEsbuildContext(
  options: Omit<NormalizedContextOptions, "builderOptions">,
  settings: SharedBundleSettings,
): Promise<{
  ctx: esbuild.BuildContext;
  pluginDisposed: Promise<void>;
}> {
  const {
    context,
    entryPoints,
    external,
    outdir,
    cache,
    hash,
    chunks,
    platform,
  } = options;

  const workspaceRoot = context.workspaceRoot;

  const commonjsPluginModule = await import("@chialab/esbuild-plugin-commonjs");
  const commonjsPlugin = commonjsPluginModule.default;

  const { define: scriptDefine, ...scriptOptions } = getScriptBuildOptions(
    settings.script,
    platform ?? "browser",
  );
  // Angular ties this to AOT too, but our bundles are always AOT.
  const advancedOptimizations = settings.script.optimize;
  // Keys the transform cache, so it must hold every option that changes transformer output.
  // upstream: angular/angular-cli packages/angular/build/src/tools/esbuild/javascript-transformer.ts @ 1a728258d6
  const outputOptions = {
    sourcemap: !!settings.sourcemap,
    thirdPartySourcemaps: false,
    advancedOptimizations,
    jit: false,
  };
  // maxThreads: keep low for node_modules bundling
  const jsTransformer = new JavaScriptTransformer(outputOptions, 1);
  const jsTransformerCache = {
    store: getOrCreateJsTransformerCacheStore(cache.cachePath),
    keyBase: JSON.stringify(outputOptions),
  };

  const config: esbuild.BuildOptions = {
    entryPoints: entryPoints.map((ep) => ({
      in: ep.fileName,
      out: path.parse(ep.outName).name,
    })),
    outdir,
    absWorkingDir: workspaceRoot,
    entryNames: hash ? "[name]-[hash]" : "[name]",
    write: false,
    external,
    logLevel: "warning",
    bundle: true,
    sourcemap: settings.sourcemap,
    ...scriptOptions,
    splitting: chunks,
    platform: platform ?? "browser",
    format: "esm",
    target: settings.target,
    logLimit: 1,
    banner: { js: NG_SERVER_MODE_BANNER },
    plugins: [
      createAngularLinkerPlugin(jsTransformer, advancedOptimizations, jsTransformerCache),
      commonjsPlugin(),
      createSourcemapIgnorelistPlugin(),
      ...settings.plugins,
    ],
    define: {
      ...scriptDefine,
      ngJitMode: "false",
    },
    ...(settings.loader ? { loader: settings.loader } : {}),
    resolveExtensions: [".mjs", ".js", ".cjs"],
  };

  const ctx = await esbuild.context(config);

  const originalDispose = ctx.dispose.bind(ctx);
  ctx.dispose = async () => {
    await originalDispose();
    await jsTransformer.close();
  };

  return { ctx, pluginDisposed: Promise.resolve() };
}
