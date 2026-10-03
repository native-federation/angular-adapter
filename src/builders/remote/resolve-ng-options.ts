import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';

import type { NfRemoteBuilderSchema } from './schema.js';

export interface ResolvedNgOptions {
  ngBuilderOptions: ApplicationBuilderOptions;
  projectRoot: string;
  projectSourceRoot: string | undefined;
}

/**
 * Builds the subset of ApplicationBuilderOptions that the esbuild adapter actually
 * reads (see angular-bundler.ts / node-modules-bundler.ts).
 *
 * Unlike the `build` builder — which runs a full Angular target and has its options
 * validated and defaulted by context.validateOptions — the remote builder has no
 * Angular target to delegate to, so it forwards only these compile-level options
 * straight from its own schema. `optimization`/`sourceMap` are normalized later at
 * the point of use by the bundler.
 *
 * tsConfig, outputPath and assets are intentionally omitted: the federation adapter
 * supplies the tsconfig path and output dir, and assets are copied by the remote
 * builder's own pipeline (see assets.ts) — none are read off ApplicationBuilderOptions.
 */
export async function resolveNgBuilderOptions(
  remote: NfRemoteBuilderSchema,
  context: BuilderContext
): Promise<ResolvedNgOptions> {
  const projectMetadata = await context.getProjectMetadata(context.target!.project);
  const projectRoot = (projectMetadata['root'] as string | undefined) ?? '';
  const projectSourceRoot = projectMetadata['sourceRoot'] as string | undefined;

  const ngBuilderOptions: ApplicationBuilderOptions = {
    stylePreprocessorOptions: remote.stylePreprocessorOptions,
    inlineStyleLanguage: remote.inlineStyleLanguage,
    fileReplacements: remote.fileReplacements,
    sourceMap: remote.sourceMap,
    optimization: remote.optimization,
    preserveSymlinks: remote.preserveSymlinks,
    polyfills: remote.polyfills,
  } as ApplicationBuilderOptions;

  return { ngBuilderOptions, projectRoot, projectSourceRoot };
}
