import { share, type ExternalConfig } from '@softarc/native-federation/config';

export function shareAngularLocales(
  keys: string[],
  opts: { config?: ExternalConfig; legacy?: boolean } = {}
) {
  if (!opts.config) {
    opts.config = {
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    };
  }
  const ext = opts.legacy ? '.mjs' : '.js';
  const locales = keys.reduce((acc, key) => {
    acc[`@angular/common/locales/${key}`] = {
      ...opts.config!,
      packageInfo: {
        esm: true,
        entryPoint: `node_modules/@angular/common/locales/${key}${ext}`,
        ...opts.config!.packageInfo,
      },
    };
    return acc;
  }, {} as Record<string, ExternalConfig>);

  return share(locales);
}
