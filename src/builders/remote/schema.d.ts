import type { JsonObject } from '@angular-devkit/core';
import type { Plugin } from 'esbuild';
import type { ApplicationBuilderOptions } from '@angular/build';

export interface NfRemoteBuilderSchema extends JsonObject {
  tsConfig: string;
  dev: boolean;
  rebuildDelay: number;
  watch: boolean;
  watchLinkedDeps?: boolean;
  outputPath?: string | { base: string; browser?: string };
  projectName?: string;
  verbose?: boolean;
  entryPoints?: string[];
  cacheExternalArtifacts?: boolean;
  cachePath?: string;

  // Passthroughs to the Angular esbuild pipeline / asset copier.
  assets?: ApplicationBuilderOptions['assets'];
  stylePreprocessorOptions?: ApplicationBuilderOptions['stylePreprocessorOptions'];
  inlineStyleLanguage?: ApplicationBuilderOptions['inlineStyleLanguage'];
  fileReplacements?: ApplicationBuilderOptions['fileReplacements'];
  sourceMap?: ApplicationBuilderOptions['sourceMap'];
  optimization?: ApplicationBuilderOptions['optimization'];
  preserveSymlinks?: ApplicationBuilderOptions['preserveSymlinks'];
  polyfills?: ApplicationBuilderOptions['polyfills'];
}

export type NfRemoteInternalOptions = { plugins?: Plugin[] };
