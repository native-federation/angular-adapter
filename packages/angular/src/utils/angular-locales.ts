import { share, type SharedConfig } from '@nf-beta/core/build';

export function shareAngularLocales(
  keys: string[],
  config: SharedConfig = {
    singleton: true,
    strictVersion: true,
    requiredVersion: 'auto',
  }
) {
  const locales = keys.reduce((acc, key) => {
    acc[`@angular/common/locales/${key}`] = {
      ...config,
    };
    acc[`@angular/common/locales/${key}`]!.packageInfo = {
      ...(config.packageInfo ?? { esm: true, version: '0.0.0' }),
      entryPoint:
        config.packageInfo?.entryPoint || `node_modules/@angular/common/locales/${key}.mjs`,
    };
    return acc;
  }, {} as Record<string, SharedConfig>);

  return share(locales);
}
