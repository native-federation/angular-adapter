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
   * The federation tsconfig, set only when the NF target declares one. That file is the
   * builder's to manage (see tools/esbuild/create-federation-tsconfig.ts); when it is absent
   * the builder falls back to the Angular target's own tsconfig, which must not be rewritten.
   */
  managedTsConfig?: string;

  /**
   * Roots keeping the federation program non-empty when a build has no entry points of its
   * own — core's reachability entry points, which default to the project's main.ts.
   */
  fallbackEntryPoints?: string[];
};
