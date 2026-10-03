import * as path from 'path';
import type { Plugin } from 'esbuild';
import { getSupportedBrowsers, transformSupportedBrowsersToTargets } from '@angular/build/private';
import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';

import { normalizeSourceMaps } from '../../utils/normalize-build-options.js';
import { resolveScriptSettings, type ScriptSettings } from './script-options.js';
import type { NfInternalOptions } from '../../builders/build/schema.js';

// Everything the adapter feeds into the shared externals bundle beyond what core keys itself.
export interface SharedBundleSettings {
  target: string[];
  sourcemap: boolean | 'external';
  loader?: ApplicationBuilderOptions['loader'];
  script: ScriptSettings;
  // Not hashable, so left out of the externals cache key.
  plugins: Plugin[];
}

export async function resolveSharedBundleSettings(
  builderOptions: ApplicationBuilderOptions & NfInternalOptions,
  context: BuilderContext
): Promise<SharedBundleSettings> {
  const projectMetadata = await context.getProjectMetadata(context.target!.project);
  const projectRoot = path.join(
    context.workspaceRoot,
    (projectMetadata['root'] as string | undefined) ?? ''
  );
  const browsers = getSupportedBrowsers(projectRoot, context.logger as unknown as Console);
  const sourceMaps = normalizeSourceMaps(builderOptions.sourceMap!);

  return {
    target: transformSupportedBrowsersToTargets(browsers),
    sourcemap: !!sourceMaps.scripts && (sourceMaps.hidden ? 'external' : true),
    loader: builderOptions.loader,
    script: resolveScriptSettings(builderOptions),
    plugins: Array.isArray(builderOptions.plugins) ? builderOptions.plugins : [],
  };
}
