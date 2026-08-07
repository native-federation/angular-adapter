import fs from 'fs';
import path from 'path';
import JSON5 from 'json5';

import { updateFederationTsConfig } from './create-federation-tsconfig.js';
import type { EntryPoint } from '@softarc/native-federation';

vi.mock('fs');

function entry(fileName: string): EntryPoint {
  return { fileName, outName: 'out.js' } as EntryPoint;
}

describe('updateFederationTsConfig', () => {
  afterEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('returns early without touching fs when there are no entry points', () => {
    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [], true);

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('resolves workspace-root-relative exposes against the workspace root', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: [] }) as never);

    updateFederationTsConfig(
      '/ws',
      'projects/mfe1/tsconfig.fed.json',
      [entry('./projects/mfe1/src/bootstrap.ts')],
      true
    );

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['src/bootstrap.ts']);
  });

  it('appends absolute mapping entry points relative to the tsconfig dir', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: ['existing.ts'] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')], true);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['existing.ts', 'src/a.ts']);
  });

  it('skips mapping entry points but keeps exposes when mappings are not optimized', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: [] }) as never);

    updateFederationTsConfig(
      '/ws',
      'tsconfig.fed.json',
      [entry('/ws/libs/unused/src/index.ts'), entry('./src/bootstrap.ts')],
      false
    );

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['src/bootstrap.ts']);
  });

  it('returns early without touching fs when only mappings are present and unoptimized', () => {
    updateFederationTsConfig(
      '/ws',
      'tsconfig.fed.json',
      [entry('/ws/libs/unused/src/index.ts')],
      false
    );

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('does not duplicate an include that is already present', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: ['src/a.ts'] }) as never);

    updateFederationTsConfig(
      '/ws',
      'tsconfig.fed.json',
      [entry('/ws/src/a.ts'), entry('/ws/src/b.ts')],
      true
    );

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('creates the include array when the tsconfig has none', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ compilerOptions: {} }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')], true);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['src/a.ts']);
  });

  it('normalizes OS-specific backslash separators to forward slashes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: [] }) as never);
    // Simulate Windows: path.relative returns single-backslash separators.
    const relativeSpy = vi
      .spyOn(path, 'relative')
      .mockReturnValue('..\\libs\\shared\\src\\index.ts');

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/libs/shared/src/index.ts')], true);

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0]![1]));
    expect(written.include).toEqual(['../libs/shared/src/index.ts']);

    relativeSpy.mockRestore();
  });

  it('does not write when the resulting config is unchanged', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON5.stringify({ include: ['src/a.ts'] }) as never);

    updateFederationTsConfig('/ws', 'tsconfig.fed.json', [entry('/ws/src/a.ts')], true);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
