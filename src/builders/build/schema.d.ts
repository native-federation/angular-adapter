import type { JsonObject } from "@angular-devkit/core";
import type { BuildNotificationOptions } from "@softarc/native-federation";
import type { ESMSInitOptions } from "es-module-shims";
import type { Plugin } from "esbuild";

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
   * Enables instrumentation to collect code coverage data for specific files.
   *
   * Used exclusively for tests and shouldn't be used for other kinds of builds.
   */
  instrumentForCoverage?: (filename: string) => boolean;

  /**
   * Whether the tsconfig the federation build resolved to is the builder's to rewrite (see
   * tools/esbuild/update-federation-tsconfig.ts). True only when the NF target declares a
   * `tsConfig` of its own; without one the build falls back to the Angular target's tsconfig,
   * where `files` is Angular's — replacing it would drop main.ts from the app's own program.
   */
  manageTsConfig?: boolean;

  /**
   * Roots keeping the federation program non-empty when a build has no entry points of its
   * own — core's reachability entry points, which default to the project's main.ts.
   */
  fallbackEntryPoints?: string[];
};
