import * as esbuild from 'esbuild';
import * as path from 'path';
import { createRequire } from 'node:module';

import {
  transformSupportedBrowsersToTargets,
  getSupportedBrowsers,
  generateSearchDirectories,
  findTailwindConfiguration,
  loadPostcssConfiguration,
  type BundleStylesheetOptions,
  type CompilerPluginOptions,
} from '@angular/build/private';

import {
  normalizeOptimization,
  normalizeSourceMaps,
} from '@angular-devkit/build-angular/src/utils/index.js';

import { createAwaitableCompilerPlugin } from './create-awaitable-compiler-plugin.js';
import type { NormalizedContextOptions } from './normalize-context-options.js';
import { writeContextTsConfig } from './write-context-tsconfig.js';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';

export async function createAngularEsbuildContext(
  options: NormalizedContextOptions,
  bundleName: string
): Promise<{
  ctx: esbuild.BuildContext;
  pluginDisposed: Promise<void>;
}> {
  const {
    builderOptions,
    context,
    entryPoints,
    external,
    outdir,
    cache,
    dev,
    hash,
    chunks,
    platform,
    mappedPaths,
  } = options;

  const federationTsConfig = options.tsConfigPath;

  if (!federationTsConfig) {
    throw new Error('tsConfigPath is required for Angular/esbuild context creation');
  }

  const workspaceRoot = context.workspaceRoot;

  const projectMetadata = await context.getProjectMetadata(context.target!.project);
  const projectRoot = path.join(
    workspaceRoot,
    (projectMetadata['root'] as string | undefined) ?? ''
  );

  const browsers = getSupportedBrowsers(projectRoot, context.logger as unknown as Console);
  const target = transformSupportedBrowsersToTargets(browsers);

  const optimizationOptions = normalizeOptimization(builderOptions.optimization);
  const sourcemapOptions = normalizeSourceMaps(builderOptions.sourceMap!);

  const searchDirectories = await generateSearchDirectories([projectRoot, workspaceRoot]);
  const postcssConfiguration = await loadPostcssConfiguration(searchDirectories);
  const tailwindConfiguration = postcssConfiguration
    ? undefined
    : await getTailwindConfig(searchDirectories);

  const outputNames = {
    bundles: '[name]',
    media: 'media/[name]',
  };

  let fileReplacements: Record<string, string> | undefined;
  if (builderOptions.fileReplacements) {
    for (const replacement of builderOptions.fileReplacements) {
      fileReplacements ??= {};
      fileReplacements[path.join(workspaceRoot, replacement.replace)] = path.join(
        workspaceRoot,
        replacement.with
      );
    }
  }

  // Without an NF-declared tsconfig this is the Angular target's own, which is left as is.
  const tsConfigPath = builderOptions.manageTsConfig
    ? writeContextTsConfig({
        workspaceRoot,
        tsConfigPath: federationTsConfig,
        cacheDir: cache.cachePath,
        bundleName,
        entryPoints,
        fallbackEntryPoints: builderOptions.fallbackEntryPoints,
      })
    : path.join(workspaceRoot, federationTsConfig);

  const pluginOptions: CompilerPluginOptions = {
    sourcemap: !!sourcemapOptions.scripts && (sourcemapOptions.hidden ? 'external' : true),
    thirdPartySourcemaps: sourcemapOptions.vendor,
    tsconfig: tsConfigPath,
    jit: false,
    advancedOptimizations: !dev,
    fileReplacements,
    sourceFileCache: cache.bundlerCache,
    loadResultCache: cache.bundlerCache.loadResultCache,
    incremental: true,
    includeTestMetadata: !optimizationOptions.scripts,
  };

  const stylesheetBundlerOptions: BundleStylesheetOptions & { inlineStyleLanguage: string } = {
    workspaceRoot,
    inlineFonts: !!optimizationOptions.fonts.inline,
    optimization: !!optimizationOptions.styles.minify,
    sourcemap:
      // Hidden component stylesheet sourcemaps are inaccessible which is effectively
      // the same as being disabled. Disabling has the advantage of avoiding the overhead
      // of sourcemap processing.
      sourcemapOptions.styles && !sourcemapOptions.hidden ? 'linked' : false,
    outputNames,
    includePaths: builderOptions.stylePreprocessorOptions?.includePaths,
    sass: builderOptions?.stylePreprocessorOptions?.sass as BundleStylesheetOptions['sass'],
    externalDependencies: external,
    target,
    inlineStyleLanguage: builderOptions.inlineStyleLanguage ?? 'css',
    preserveSymlinks: builderOptions.preserveSymlinks,
    tailwindConfiguration,
    postcssConfiguration,
    cacheOptions: {
      enabled: true,
      basePath: cache.cachePath,
      path: cache.cachePath,
    },
  };

  const commonjsPluginModule = await import('@chialab/esbuild-plugin-commonjs');
  const commonjsPlugin = commonjsPluginModule.default;

  stylesheetBundlerOptions.externalDependencies = [];

  const [compilerPlugin, pluginDisposed] = createAwaitableCompilerPlugin(
    pluginOptions,
    stylesheetBundlerOptions
  );

  const customPlugins = Array.isArray(options.builderOptions.plugins)
    ? options.builderOptions.plugins
    : [];

  const config: esbuild.BuildOptions = {
    entryPoints: entryPoints.map(ep => ({
      // Anchored on workspaceRoot rather than left relative (core hands exposes over
      // workspace-root-relative): esbuild resolves relative entry points through its own
      // working directory, which need not be the root the TypeScript program — and with it
      // the compiler plugin's cache keys — was built from.
      in: path.isAbsolute(ep.fileName) ? ep.fileName : path.join(workspaceRoot, ep.fileName),
      out: path.parse(ep.outName).name,
    })),
    outdir,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    write: false,
    external,
    logLevel: 'warning',
    bundle: true,
    sourcemap: sourcemapOptions.scripts,
    minify: !dev,
    supported: {
      'async-await': false,
      'object-rest-spread': false,
    },
    splitting: chunks,
    preserveSymlinks: builderOptions.preserveSymlinks,
    platform: platform ?? 'browser',
    format: 'esm',
    target: target,
    logLimit: 0,
    plugins: [
      compilerPlugin,
      // Angular's synthesized deep imports would otherwise inline a second copy of a mapped lib.
      ...(Object.keys(mappedPaths).length > 0 ? [createSharedMappingsPlugin(mappedPaths)] : []),
      commonjsPlugin(),
      ...customPlugins,
    ],
    define: {
      ...builderOptions.define,
      ...(dev ? {} : { ngDevMode: 'false' }),
      ngJitMode: 'false',
    },
    ...(builderOptions.loader ? { loader: builderOptions.loader } : {}),
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.cjs'],
    // The compiler plugin only hooks onLoad; esbuild resolves bare specifiers itself
    // and would otherwise only honour paths from an auto-discovered `tsconfig.json`.
    tsconfig: tsConfigPath,
  };

  const ctx = await esbuild.context(config);

  return { ctx, pluginDisposed };
}

async function getTailwindConfig(
  searchDirectories: { root: string; files: Set<string> }[]
): Promise<{ file: string; package: string } | undefined> {
  const tailwindConfigurationPath = findTailwindConfiguration(searchDirectories);

  if (!tailwindConfigurationPath) {
    return undefined;
  }

  return {
    file: tailwindConfigurationPath,
    package: createRequire(tailwindConfigurationPath).resolve('tailwindcss'),
  };
}
