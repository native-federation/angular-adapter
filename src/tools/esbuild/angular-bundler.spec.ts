import * as path from 'path';
import * as esbuild from 'esbuild';
import type { CompilerPluginOptions } from '@angular/build/private';

import { createAngularEsbuildContext } from './angular-bundler.js';
import { createAwaitableCompilerPlugin } from './create-awaitable-compiler-plugin.js';
import { updateFederationTsConfig } from './create-federation-tsconfig.js';
import type { NormalizedContextOptions } from '../../utils/normalize-context-options.js';

vi.mock('esbuild', () => ({ context: vi.fn().mockResolvedValue({ rebuild: vi.fn() }) }));

vi.mock('@angular/build/private', () => ({
  getSupportedBrowsers: () => ['chrome 130'],
  transformSupportedBrowsersToTargets: () => ['chrome130'],
  generateSearchDirectories: async () => [],
  findTailwindConfiguration: () => undefined,
  loadPostcssConfiguration: async () => undefined,
}));

vi.mock('./create-awaitable-compiler-plugin.js', () => ({
  createAwaitableCompilerPlugin: vi
    .fn()
    .mockReturnValue([{ name: 'angular-compiler', setup: vi.fn() }, Promise.resolve()]),
}));

vi.mock('./create-federation-tsconfig.js', () => ({ updateFederationTsConfig: vi.fn() }));

vi.mock('@chialab/esbuild-plugin-commonjs', () => ({
  default: () => ({ name: 'commonjs', setup: vi.fn() }),
}));

const workspaceRoot = path.join(path.sep, 'ws');

function makeOptions(overrides: Partial<NormalizedContextOptions> = {}) {
  return {
    builderOptions: { optimization: false, sourceMap: false },
    context: {
      workspaceRoot,
      target: { project: 'example' },
      logger: { warn: vi.fn() },
      getProjectMetadata: async () => ({ root: 'apps/example' }),
    },
    entryPoints: [{ fileName: 'apps/example/src/main.ts', outName: 'main.js' }],
    external: [],
    outdir: '/out',
    tsConfigPath: 'apps/example/tsconfig.app.json',
    mappedPaths: {},
    cache: { bundlerCache: { loadResultCache: {} }, cachePath: '/cache' },
    dev: false,
    isMappingOrExposed: true,
    hash: false,
    optimizedMappings: false,
    ...overrides,
  } as unknown as NormalizedContextOptions;
}

function lastBuildOptions(): esbuild.BuildOptions {
  return vi.mocked(esbuild.context).mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(esbuild.context).mockResolvedValue({ rebuild: vi.fn() } as never);
});

describe('createAngularEsbuildContext', () => {
  it('throws when no tsconfig is configured', async () => {
    const options = makeOptions({ tsConfigPath: undefined });

    await expect(createAngularEsbuildContext(options)).rejects.toThrow('tsConfigPath is required');
  });

  // #98
  it('passes the normalized tsconfig path to esbuild, not only to the plugin', async () => {
    await createAngularEsbuildContext(makeOptions());

    const expected = path.join(workspaceRoot, 'apps/example/tsconfig.app.json');

    expect(lastBuildOptions().tsconfig).toBe(expected);

    const [pluginOptions] = vi.mocked(createAwaitableCompilerPlugin).mock.calls[0] as [
      CompilerPluginOptions,
    ];
    expect(pluginOptions.tsconfig).toBe(expected);
  });

  it('joins the workspace root once when mappings are optimized', async () => {
    await createAngularEsbuildContext(makeOptions({ optimizedMappings: true }));

    // updateFederationTsConfig joins the workspace root itself
    expect(updateFederationTsConfig).toHaveBeenCalledWith(
      workspaceRoot,
      'apps/example/tsconfig.app.json',
      expect.anything(),
      true
    );
    expect(lastBuildOptions().tsconfig).toBe(
      path.join(workspaceRoot, 'apps/example/tsconfig.app.json')
    );
  });

  it('still updates the tsconfig when mappings are not optimized, so exposes land in the program', async () => {
    await createAngularEsbuildContext(makeOptions({ optimizedMappings: false }));

    expect(updateFederationTsConfig).toHaveBeenCalledWith(
      workspaceRoot,
      'apps/example/tsconfig.app.json',
      expect.anything(),
      false
    );
  });
});
