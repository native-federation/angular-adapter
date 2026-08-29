import * as path from 'path';
import * as esbuild from 'esbuild';
import type { CompilerPluginOptions } from '@angular/build/private';

import { createAngularEsbuildContext } from './angular-bundler.js';
import { createAwaitableCompilerPlugin } from './create-awaitable-compiler-plugin.js';
import { updateFederationTsConfig } from './update-federation-tsconfig.js';
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

vi.mock('./update-federation-tsconfig.js', () => ({ updateFederationTsConfig: vi.fn() }));

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

  it('updates the tsconfig the NF target declared, passing the fallback entry points', async () => {
    await createAngularEsbuildContext(
      makeOptions({
        builderOptions: {
          optimization: false,
          sourceMap: false,
          manageTsConfig: true,
          fallbackEntryPoints: ['apps/example/src/main.ts'],
        },
      } as unknown as Partial<NormalizedContextOptions>)
    );

    // updateFederationTsConfig joins the workspace root itself
    expect(updateFederationTsConfig).toHaveBeenCalledWith(
      workspaceRoot,
      'apps/example/tsconfig.app.json',
      expect.anything(),
      ['apps/example/src/main.ts']
    );
    expect(lastBuildOptions().tsconfig).toBe(
      path.join(workspaceRoot, 'apps/example/tsconfig.app.json')
    );
  });

  // Without `tsConfig` on the NF target the builder falls back to the Angular target's own
  // tsconfig, which is the user's file and must be left alone.
  it('leaves the tsconfig alone when the NF target declared none', async () => {
    await createAngularEsbuildContext(makeOptions());

    expect(updateFederationTsConfig).not.toHaveBeenCalled();
  });

  // #117: left relative, esbuild resolves these through its own working directory, which need
  // not agree with the root the TypeScript program was built from.
  it('anchors workspace-root-relative entry points on the workspace root', async () => {
    await createAngularEsbuildContext(makeOptions());

    expect(lastBuildOptions().entryPoints).toEqual([
      { in: path.join(workspaceRoot, 'apps/example/src/main.ts'), out: 'main' },
    ]);
  });

  // Core hands shared mappings over absolute already.
  it('leaves an already-absolute entry point untouched', async () => {
    const absolute = path.join(workspaceRoot, 'libs', 'ui', 'src', 'index.ts');
    await createAngularEsbuildContext(
      makeOptions({ entryPoints: [{ fileName: absolute, outName: 'ui.js' }] })
    );

    expect(lastBuildOptions().entryPoints).toEqual([{ in: absolute, out: 'ui' }]);
  });
});
