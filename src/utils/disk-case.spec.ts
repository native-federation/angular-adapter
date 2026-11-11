import * as path from 'path';

import type { BuilderContext } from '@angular-devkit/architect';
import { toDiskCase } from '@softarc/native-federation/internal';

import { withDiskCaseWorkspaceRoot } from './disk-case.js';

// The case correction itself is core's `toDiskCase` (and tested there); here it is stubbed so
// these tests only cover how the corrected root is put on the context.
vi.mock('@softarc/native-federation/internal', () => ({ toDiskCase: vi.fn() }));

function mockDiskCase(impl: (p: string) => string): void {
  vi.mocked(toDiskCase).mockImplementation(impl);
}

beforeEach(() => {
  vi.clearAllMocks();
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
    mockDiskCase(() => path.normalize('C:\\ws'));
    const context = contextWith('c:\\ws');

    expect(withDiskCaseWorkspaceRoot(context).workspaceRoot).toBe(path.normalize('C:\\ws'));
  });

  it('keeps the rest of the context reachable', async () => {
    mockDiskCase(() => path.normalize('C:\\ws'));
    const context = contextWith('c:\\ws');

    const derived = withDiskCaseWorkspaceRoot(context);

    expect(derived.target).toBe(context.target);
    expect(derived.logger).toBe(context.logger);
    await expect(derived.getProjectMetadata('example')).resolves.toEqual({ root: 'apps/example' });
  });

  it('hands back the very same context when nothing needed correcting', () => {
    mockDiskCase(p => p);
    const context = contextWith('/ws');

    expect(withDiskCaseWorkspaceRoot(context)).toBe(context);
  });
});
