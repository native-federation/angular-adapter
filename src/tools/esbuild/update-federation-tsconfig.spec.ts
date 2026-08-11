import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import { updateFederationTsConfig } from './update-federation-tsconfig.js';
import type { EntryPoint } from '@softarc/native-federation';

vi.mock('fs');

function entry(fileName: string): EntryPoint {
  return { fileName, outName: 'out.js' } as EntryPoint;
}

function written() {
  return JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
}

describe('updateFederationTsConfig', () => {
  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('returns early without touching fs when there is nothing to compile', () => {
    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [], []);

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('throws naming the tsconfig when the file the target points at is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() =>
      updateFederationTsConfig('/ws', 'projects/mfe1/tsconfig.fed.json', [
        entry('./projects/mfe1/src/bootstrap.ts'),
      ])
    ).toThrow(/"projects\/mfe1\/tsconfig\.fed\.json" does not exist/);

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('resolves workspace-root-relative exposes against the workspace root', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);

    updateFederationTsConfig('/ws', 'projects/mfe1/tsconfig.fed.json', [
      entry('./projects/mfe1/src/bootstrap.ts'),
    ]);

    expect(written().files).toEqual(['src/bootstrap.ts']);
  });

  it('resolves absolute mapping entry points relative to the tsconfig dir', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')]);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(written().files).toEqual(['src/a.ts']);
  });

  // Regression: with `ignoreUnusedDeps: false` core hands over every tsconfig path mapping,
  // used or not. They are all bundled, so they all have to be in the program.
  it('keeps mapping entry points alongside exposes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [
      entry('/ws/libs/unused/src/index.ts'),
      entry('./src/bootstrap.ts'),
    ]);

    expect(written().files).toEqual(['libs/unused/src/index.ts', 'src/bootstrap.ts']);
  });

  it('replaces the previous files, dropping entry points that are gone', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON5.stringify({ files: ['src/renamed-away.ts'], include: ['src/**/*.d.ts'] }) as never
    );

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('./src/a.ts')]);

    expect(written()).toEqual({ files: ['src/a.ts'], include: ['src/**/*.d.ts'] });
  });

  it('deduplicates entry points resolving to the same file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [
      entry('/ws/src/a.ts'),
      entry('./src/a.ts'),
    ]);

    expect(written().files).toEqual(['src/a.ts']);
  });

  it('falls back to the given entry points when the build has none of its own', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);

    updateFederationTsConfig('/ws', 'projects/host/tsconfig.fed.json', [], [
      'projects/host/src/main.ts',
    ]);

    expect(written().files).toEqual(['src/main.ts']);
  });

  it('creates the files array when the tsconfig has none', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ compilerOptions: {} }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')]);

    expect(written().files).toEqual(['src/a.ts']);
  });

  it('normalizes OS-specific backslash separators to forward slashes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: [] }) as never);
    // Simulate Windows: path.relative returns single-backslash separators.
    const relativeSpy = vi
      .spyOn(path, 'relative')
      .mockReturnValue('..\\libs\\shared\\src\\index.ts');

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/libs/shared/src/index.ts')]);

    expect(written().files).toEqual(['../libs/shared/src/index.ts']);

    relativeSpy.mockRestore();
  });

  it('does not write when the resulting config is unchanged', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ files: ['src/a.ts'] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')]);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
