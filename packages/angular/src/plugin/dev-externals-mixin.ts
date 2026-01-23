import type { Plugin, UserConfig, ResolvedConfig } from 'vite';
import { federationBuilder } from '@softarc/native-federation';
import { filterExternals } from './externals-skip-list.js';

// see: https://github.com/vitejs/vite/issues/6393#issuecomment-1006819717

export const devExternalsMixin: Partial<Plugin> = {
  enforce: 'pre',
  config(config: UserConfig) {
    config.optimizeDeps = {
      ...(config.optimizeDeps ?? {}),
      exclude: [
        ...(config.optimizeDeps?.exclude ?? []),
        ...filterExternals(federationBuilder.externals),
      ],
    };
  },
  configResolved(resolvedConfig: ResolvedConfig) {
    const VALID_ID_PREFIX = `/@id/`;
    const reg = new RegExp(`${VALID_ID_PREFIX}(${federationBuilder.externals.join('|')})`, 'g');
    (resolvedConfig.plugins as Plugin[]).push({
      name: 'vite-plugin-ignore-static-import-replace-idprefix',
      transform: (code: string) =>
        reg.test(code) ? code.replace(reg, (_m, s1: string) => s1) : code,
    });
  },
  resolveId(id: string) {
    if (filterExternals(federationBuilder.externals).includes(id)) {
      return { id, external: true };
    }
    return null;
  },
};
