import type { JsonObject } from '@angular-devkit/core';
import type { BuildNotificationOptions } from '@softarc/native-federation-runtime';
import type { ESMSInitOptions } from 'es-module-shims';

export interface NfBuilderSchema extends JsonObject {
  target: string;
  dev: boolean;
  port: number;
  rebuildDelay: number;
  buildNotifications?: BuildNotificationOptions;
  watch: boolean;
  skipHtmlTransform: boolean;
  esmsInitOptions: ESMSInitOptions;
  baseHref?: string;
  outputPath?: string;
  projectName?: string;
  ssr: boolean;
  devServer?: boolean;
  entryPoints?: string[];
  cacheExternalArtifacts?: boolean;
}
