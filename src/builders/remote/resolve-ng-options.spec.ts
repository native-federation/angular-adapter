import type { BuilderContext } from '@angular-devkit/architect';

import { resolveNgBuilderOptions } from './resolve-ng-options.js';
import { resolveScriptSettings } from '../../tools/esbuild/script-options.js';
import type { NfRemoteBuilderSchema } from './schema.js';

const context = {
  target: { project: 'mfe1' },
  getProjectMetadata: async () => ({ root: 'projects/mfe1' }),
} as unknown as BuilderContext;

async function scriptSettingsFor(remote: Partial<NfRemoteBuilderSchema>) {
  const { ngBuilderOptions } = await resolveNgBuilderOptions(
    { tsConfig: 'tsconfig.federation.json', ...remote } as NfRemoteBuilderSchema,
    context
  );
  return { ngBuilderOptions, script: resolveScriptSettings(ngBuilderOptions, {}) };
}

describe('resolveNgBuilderOptions', () => {
  // A remote has no polyfills of its own, so it needs the host's to know whether its
  // exposed code runs under Zone.js (#163).
  it('forwards polyfills, so a zone.js host gets downleveled async/await', async () => {
    const { ngBuilderOptions, script } = await scriptSettingsFor({ polyfills: ['zone.js'] });

    expect(ngBuilderOptions.polyfills).toEqual(['zone.js']);
    expect(script.zoneless).toBe(false);
  });

  // Same default as Angular's isZonelessApp for an app without polyfills.
  it('treats a remote without polyfills as zoneless', async () => {
    const { script } = await scriptSettingsFor({});

    expect(script.zoneless).toBe(true);
  });
});
