import * as fs from 'fs';
import * as esbuild from 'esbuild';
import { AbortedError } from '@softarc/native-federation/internal';

import { createAngularBuildAdapter } from './angular-esbuild-adapter.js';
import { createAngularEsbuildContext } from './angular-bundler.js';
import { createNodeModulesEsbuildContext } from './node-modules-bundler.js';
import { normalizeContextOptions } from '../../utils/normalize-context-options.js';

vi.mock('fs');
vi.mock('esbuild', () => ({ stop: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./angular-bundler.js', () => ({ createAngularEsbuildContext: vi.fn() }));
vi.mock('./node-modules-bundler.js', () => ({ createNodeModulesEsbuildContext: vi.fn() }));
vi.mock('../../utils/normalize-context-options.js', () => ({ normalizeContextOptions: vi.fn() }));

const ngBuilderOptions = {} as never;
const context = {} as never;

function makeCtx() {
  return {
    rebuild: vi.fn().mockResolvedValue({
      outputFiles: [{ path: '/tmp/build/main.js', text: 'code' }],
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function normalizedWith(overrides: Record<string, unknown> = {}) {
  return {
    builderOptions: ngBuilderOptions,
    context,
    entryPoints: [{ fileName: 'a.ts', outName: 'a.js' }],
    external: [],
    outdir: '/out',
    cache: { bundlerCache: { invalidate: vi.fn(), loadResultCache: {} }, cachePath: '/c' },
    dev: false,
    isMappingOrExposed: true,
    hash: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // setNgServerMode: pretend the file to patch doesn't exist so it is a no-op
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(normalizeContextOptions).mockReturnValue(normalizedWith() as never);
  vi.mocked(createAngularEsbuildContext).mockResolvedValue({
    ctx: makeCtx() as never,
    pluginDisposed: Promise.resolve(),
  });
  vi.mocked(createNodeModulesEsbuildContext).mockResolvedValue({
    ctx: makeCtx() as never,
    pluginDisposed: Promise.resolve(),
  });
});

describe('createAngularBuildAdapter', () => {
  it('throws when build is called before setup', async () => {
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await expect(adapter.build('remote')).rejects.toThrow(
      'No context found for build "remote". Call setup() first.'
    );
  });

  it('throws when disposing a name that was never set up', async () => {
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await expect(adapter.dispose('ghost')).rejects.toThrow(
      "Could not dispose of non-existing build 'ghost'"
    );
  });

  it('uses the Angular esbuild context for mapping/exposed builds and caches it', async () => {
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);

    await adapter.setup('remote', {} as never);
    // second setup with the same name is a no-op
    await adapter.setup('remote', {} as never);

    expect(createAngularEsbuildContext).toHaveBeenCalledWith(expect.anything(), 'remote');
    expect(createNodeModulesEsbuildContext).not.toHaveBeenCalled();
  });

  it('uses the node_modules context when the build is not a mapping/exposed', async () => {
    vi.mocked(normalizeContextOptions).mockReturnValue(
      normalizedWith({ isMappingOrExposed: false }) as never
    );
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);

    await adapter.setup('deps', {} as never);

    expect(createNodeModulesEsbuildContext).toHaveBeenCalledTimes(1);
    expect(createAngularEsbuildContext).not.toHaveBeenCalled();
  });

  it('rebuilds, writes output files and returns their paths', async () => {
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await adapter.setup('remote', {} as never);

    const result = await adapter.build('remote');

    expect(fs.writeFileSync).toHaveBeenCalledWith('/out/main.js', 'code');
    expect(result).toEqual([{ fileName: '/out/main.js' }]);
  });

  it('invalidates the bundler cache for modified files before rebuilding', async () => {
    const normalized = normalizedWith();
    vi.mocked(normalizeContextOptions).mockReturnValue(normalized as never);
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await adapter.setup('remote', {} as never);

    await adapter.build('remote', { modifiedFiles: ['a.ts'] });

    expect(normalized.cache.bundlerCache.invalidate).toHaveBeenCalledWith(new Set(['a.ts']));
  });

  it('throws AbortedError when the signal is already aborted', async () => {
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await adapter.setup('remote', {} as never);

    await expect(
      adapter.build('remote', { signal: { aborted: true } as AbortSignal })
    ).rejects.toBeInstanceOf(AbortedError);
  });

  it('disposes all cached contexts and stops esbuild on a full dispose', async () => {
    const ctx = makeCtx();
    vi.mocked(createAngularEsbuildContext).mockResolvedValue({
      ctx: ctx as never,
      pluginDisposed: Promise.resolve(),
    });
    const adapter = createAngularBuildAdapter(ngBuilderOptions, context);
    await adapter.setup('remote', {} as never);

    await adapter.dispose();

    expect(ctx.dispose).toHaveBeenCalledTimes(1);
    expect(esbuild.stop).toHaveBeenCalledTimes(1);
    // cache is cleared, so a subsequent build fails again
    await expect(adapter.build('remote')).rejects.toThrow('No context found');
  });
});
