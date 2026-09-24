import type { JsonObject } from '@angular-devkit/core';
import type { BuildNotificationOptions } from '@softarc/native-federation-runtime';
import type { ESMSInitOptions } from 'es-module-shims';
import type { Plugin } from 'esbuild';

export interface NfBuilderSchema extends JsonObject {
  target: string;
  dev: boolean;
  port: number;
  rebuildDelay: number;
  buildNotifications?: BuildNotificationOptions;
  federationConfigPath?: string;
  watch?: boolean;
  watchLinkedDeps?: boolean;
  skipHtmlTransform: boolean;
  esmsInitOptions: ESMSInitOptions;
  baseHref?: string;
  outputPath?: string;
  define?: Record<string, string>;
  projectName?: string;
  ssr: boolean;
  tsConfig?: string;
  devServer?: boolean;
  entryPoints?: string[];
  cacheExternalArtifacts?: boolean;
}

export type NfInternalOptions = {
  plugins?: Plugin[];

  /**
   * Whether each build context gets a generated tsconfig extending the resolved one. True only
   * when the NF target declares a `tsConfig` of its own.
   */
  manageTsConfig?: boolean;

  /**
   * Roots keeping the federation program non-empty when a build has no entry points of its
   * own — core's reachability entry points, which default to the project's main.ts.
   */
  fallbackEntryPoints?: string[];
};
