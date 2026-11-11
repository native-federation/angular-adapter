import type { ExternalConfig } from '@softarc/native-federation/config';
import { share } from './share-utils.js';

export function shareAngularLocales(
  keys: string[],
  opts: {
    config?: ExternalConfig;
    legacy?: boolean;
    pool?: string;
    // Must match how @angular/common is shared, or it is split over two bundles (#202).
    build?: ExternalConfig['build'];
    projectPath?: string;
  } = {}
) {
  const config: ExternalConfig = opts.config ?? {
    singleton: true,
    strictVersion: true,
    requiredVersion: 'auto',
  };
  const pool = opts.pool ?? config.pool;
  const build = opts.build ?? config.build;

  const locales = keys.reduce(
    (acc, key) => {
      const { packageInfo, ...rest } = config;
      const entry: ExternalConfig = {
        ...rest,
        ...(pool && { pool }),
        ...(build && { build }),
      };
      // The core resolves `locales/<key>.js` and its version itself. No version here:
      // the core fills in the installed @angular/common one; a user's version is a pin.
      if (opts.legacy || packageInfo) {
        entry.packageInfo = {
          esm: true,
          entryPoint: `node_modules/@angular/common/locales/${key}${opts.legacy ? '.mjs' : '.js'}`,
          ...packageInfo,
        } as ExternalConfig['packageInfo'];
      }
      acc[`@angular/common/locales/${key}`] = entry;
      return acc;
    },
    {} as Record<string, ExternalConfig>
  );

  return share(locales, opts.projectPath);
}
