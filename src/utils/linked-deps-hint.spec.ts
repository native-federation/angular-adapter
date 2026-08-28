import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from '@softarc/native-federation/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintUnwatchedLinkedDeps } from './linked-deps-hint.js';

type Args = Parameters<typeof hintUnwatchedLinkedDeps>;

describe('hintUnwatchedLinkedDeps', () => {
  let root: string;
  let info: ReturnType<typeof vi.spyOn>;

  // A workspace whose node_modules entry for `key` is a symlink; `outside` decides
  // whether its real path escapes node_modules, which is what core calls a linked
  // checkout as opposed to a package manager's own symlink.
  const workspace = (key: string, outside: boolean): void => {
    const real = outside
      ? path.join(root, 'checkouts', key)
      : path.join(root, 'node_modules', '.store', key);
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'package.json'), JSON.stringify({ name: key, version: '1.0.0' }));

    const link = path.join(root, 'node_modules', key);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link, 'dir');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host' }));
  };

  const call = (key: string, watchLinkedDeps: boolean): void =>
    hintUnwatchedLinkedDeps({ shared: { [key]: {} } } as unknown as Args[0], {
      workspaceRoot: root,
      packageJson: path.join(root, 'package.json'),
      watchLinkedDeps,
    } as unknown as Args[1]);

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-hint-')));
    info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('names the linked package when the option is off', () => {
    workspace('my-lib', true);
    call('my-lib', false);

    expect(info).toHaveBeenCalledTimes(1);
    const message = String(info.mock.calls[0][0]);
    expect(message).toContain('my-lib');
    expect(message).toContain('watchLinkedDeps');
  });

  it('stays quiet when the option is already on', () => {
    workspace('my-lib', true);
    call('my-lib', true);

    expect(info).not.toHaveBeenCalled();
  });

  // The #130 shape: pnpm's default linker symlinks every dependency, so a hint keyed
  // on "is a symlink" would fire for the whole dependency graph.
  it('stays quiet for a symlink that resolves inside node_modules', () => {
    workspace('my-lib', false);
    call('my-lib', false);

    expect(info).not.toHaveBeenCalled();
  });

  it('stays quiet when nothing is linked', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host' }));
    call('my-lib', false);

    expect(info).not.toHaveBeenCalled();
  });
});
