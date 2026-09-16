import * as fs from 'fs';
import * as path from 'path';

import type { BuilderContext } from '@angular-devkit/architect';

import { toDiskCase, withDiskCaseWorkspaceRoot } from './disk-case.js';

vi.mock('fs');

function mockNativeRealpath(impl: (p: string) => string): void {
  // vi.mock('fs') stubs realpathSync but not the `.native` property hanging off it.
  vi.mocked(fs).realpathSync = Object.assign(vi.fn(), {
    native: vi.fn(impl),
  }) as unknown as typeof fs.realpathSync;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toDiskCase', () => {
  // The reported case: Nx inherits `c:\…` from the shell while the filesystem stores `C:\…`.
  it('adopts the on-disk spelling when only the case differs', () => {
    mockNativeRealpath(() => 'C:\\ws\\project');

    expect(toDiskCase('c:\\ws\\project')).toBe(path.normalize('C:\\ws\\project'));
  });

  it('accepts a correction that also differs in separator style', () => {
    mockNativeRealpath(() => 'C:/ws/project');

    expect(toDiskCase('c:\\ws\\project')).toBe(path.normalize('C:/ws/project'));
  });

  it('ignores a trailing slash when deciding whether the paths are the same', () => {
    mockNativeRealpath(() => 'C:/ws/project');

    expect(toDiskCase('c:/ws/project/')).toBe(path.normalize('C:/ws/project'));
  });

  // A symlinked workspace root must stay on the path it was handed: npm-linked and pnpm
  // setups resolve to a different directory entirely, not to a re-cased one.
  it('keeps the input when realpath resolves to a different directory', () => {
    mockNativeRealpath(() => '/real/checkout');

    expect(toDiskCase('/links/project')).toBe('/links/project');
  });

  it('keeps the input when realpath throws', () => {
    mockNativeRealpath(() => {
      throw new Error('ENOENT');
    });

    expect(toDiskCase('/gone')).toBe('/gone');
  });

  it('is a no-op when the spelling already matches', () => {
    mockNativeRealpath(p => p);

    expect(toDiskCase('/ws/project')).toBe('/ws/project');
  });
});

describe('withDiskCaseWorkspaceRoot', () => {
  function contextWith(workspaceRoot: string) {
    return {
      workspaceRoot,
      target: { project: 'example' },
      logger: { warn: vi.fn() },
      getProjectMetadata: async () => ({ root: 'apps/example' }),
    } as unknown as BuilderContext;
  }

  it('returns a context carrying the on-disk spelling of the root', () => {
    mockNativeRealpath(() => 'C:\\ws');
    const context = contextWith('c:\\ws');

    expect(withDiskCaseWorkspaceRoot(context).workspaceRoot).toBe(path.normalize('C:\\ws'));
  });

  it('keeps the rest of the context reachable', async () => {
    mockNativeRealpath(() => 'C:\\ws');
    const context = contextWith('c:\\ws');

    const derived = withDiskCaseWorkspaceRoot(context);

    expect(derived.target).toBe(context.target);
    expect(derived.logger).toBe(context.logger);
    await expect(derived.getProjectMetadata('example')).resolves.toEqual({ root: 'apps/example' });
  });

  it('hands back the very same context when nothing needed correcting', () => {
    mockNativeRealpath(p => p);
    const context = contextWith('/ws');

    expect(withDiskCaseWorkspaceRoot(context)).toBe(context);
  });
});
