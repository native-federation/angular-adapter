import * as path from 'path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { getSupportedBrowsers, transformSupportedBrowsersToTargets } from '@angular/build/private';
import type { ApplicationBuilderOptions } from '@angular/build';
import type { BuilderContext } from '@angular-devkit/architect';
import type { ExternalsCacheKey } from '@softarc/native-federation/domain';

import { normalizeSourceMaps } from '../../utils/normalize-build-options.js';

// Everything the adapter feeds into the shared externals bundle beyond what core keys itself.
export interface SharedBundleSettings {
  target: string[];
  sourcemap: boolean | 'external';
  loader?: ApplicationBuilderOptions['loader'];
}

export interface KeyedVersions {
  adapter: string;
  esbuild: string;
  angularBuild: string;
}

export async function resolveSharedBundleSettings(
  builderOptions: ApplicationBuilderOptions,
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
  };
}

export function readKeyedVersions(): KeyedVersions {
  const require = createRequire(import.meta.url);
  // Same depth from src/tools/esbuild/ and dist/src/tools/esbuild/, so this resolves to the
  // repo manifest under test and to the published one in dist.
  const adapterPkg = require('../../../package.json') as { name: string; version: string };
  const angularBuildPkg = require('@angular/build/package.json') as { version: string };

  return {
    adapter: `${adapterPkg.name}@${adapterPkg.version}`,
    esbuild: esbuild.version,
    angularBuild: angularBuildPkg.version,
  };
}

export function createExternalsCacheKey(
  settings: SharedBundleSettings,
  versions: KeyedVersions = readKeyedVersions()
): ExternalsCacheKey {
  const loader = Object.entries(settings.loader ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));

  return {
    adapter: versions.adapter,
    options: {
      esbuild: versions.esbuild,
      angularBuild: versions.angularBuild,
      target: [...settings.target].sort().join(','),
      sourceMap: settings.sourcemap,
      loader: JSON.stringify(loader),
    },
  };
}
