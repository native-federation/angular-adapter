import { normalizeContextOptions } from './normalize-context-options.js';

describe('normalizeContextOptions', () => {
  const builderOptions = { someBuilderOption: 1 } as never;
  const context = { workspaceRoot: '/ws' } as never;

  const baseAdapterOptions = {
    entryPoints: [{ fileName: 'a.ts', outName: 'a.js' }],
    external: ['rxjs'],
    outdir: '/out',
    tsConfigPath: 'tsconfig.json',
    mappedPaths: { foo: 'bar' },
    cache: { cachePath: '/cache' },
    hash: true,
    chunks: true,
    platform: 'node',
  } as never;

  it('passes through the provided options unchanged', () => {
    const result = normalizeContextOptions(builderOptions, context, baseAdapterOptions);

    expect(result).toMatchObject({
      builderOptions,
      context,
      entryPoints: [{ fileName: 'a.ts', outName: 'a.js' }],
      external: ['rxjs'],
      outdir: '/out',
      tsConfigPath: 'tsconfig.json',
      mappedPaths: { foo: 'bar' },
      cache: { cachePath: '/cache' },
      hash: true,
      chunks: true,
      platform: 'node',
    });
  });

  it('coerces a missing hash flag to false', () => {
    const adapterOptions = { ...(baseAdapterOptions as object), hash: undefined } as never;

    const result = normalizeContextOptions(builderOptions, context, adapterOptions);

    expect(result.hash).toBe(false);
  });
});
