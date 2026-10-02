import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import type { ExternalsCacheKey } from '@softarc/native-federation/domain';

import type { SharedBundleSettings } from './shared-bundle-settings.js';

export interface KeyedVersions {
  adapter: string;
  esbuild: string;
  angularBuild: string;
}

export function readKeyedVersions(): KeyedVersions {
  const require = createRequire(import.meta.url);
  // Self-reference through our own `exports`, so it doesn't depend on this file's location.
  const adapterPkg = require('@angular-architects/native-federation/package.json') as {
    name: string;
    version: string;
  };
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
