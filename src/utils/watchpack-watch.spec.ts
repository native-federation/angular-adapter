import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchpackWatch } from './watchpack-watch';

// Watchpack is event-driven, but the events still cross a real fs boundary, so every
// assertion waits for a condition rather than a fixed delay.
const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 8000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for a watch event');
};

// Watchpack only reports changes newer than the watch's start time, and mtime
// granularity on some filesystems is a full second.
const settle = () => new Promise(r => setTimeout(r, 300));

describe('watchpackWatch', () => {
  let root: string;
  const handles: { close(): void }[] = [];

  const watch = (
    target: string,
    opts: { recursive: boolean; poll?: { intervalMs: number } }
  ): string[] => {
    const seen: string[] = [];
    handles.push(watchpackWatch(target, opts, f => f && seen.push(f)));
    return seen;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-watchpack-'));
  });

  afterEach(() => {
    for (const h of handles.splice(0)) h.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a changed file relative to the watched directory', async () => {
    fs.writeFileSync(path.join(root, 'a.ts'), 'one');
    const seen = watch(root, { recursive: false });
    await settle();

    fs.writeFileSync(path.join(root, 'a.ts'), 'two');
    await waitFor(() => seen.includes('a.ts'));
  });

  it('reports a file added after the watch started', async () => {
    const seen = watch(root, { recursive: false });
    await settle();

    fs.writeFileSync(path.join(root, 'new.ts'), 'hello');
    await waitFor(() => seen.includes('new.ts'));
  });

  // Watchpack descends whatever it is handed, so `recursive: false` cannot stop it the
  // way fs.watch does — it only caps the reported path at depth 1. Two levels down, and
  // modifying an existing file so no parent directory's mtime moves: the only way 'sub'
  // can be reported is watchpack having descended to it.
  it('collapses a change below depth 1 onto its depth-1 ancestor when not recursive', async () => {
    const nested = path.join(root, 'sub', 'deeper');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'deep.ts'), 'one');
    const seen = watch(root, { recursive: false });
    await settle();

    fs.writeFileSync(path.join(nested, 'deep.ts'), 'two');
    await waitFor(() => seen.includes('sub'));
    expect(seen.filter(f => f.includes('deep.ts'))).toEqual([]);
  });

  it('reports nested changes when recursive', async () => {
    const nested = path.join(root, 'sub');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'deep.ts'), 'one');
    const seen = watch(root, { recursive: true });
    await settle();

    fs.writeFileSync(path.join(nested, 'deep.ts'), 'two');
    await waitFor(() => seen.some(f => f.endsWith('deep.ts')));
  });

  it('ignores node_modules under the watched root', async () => {
    const modules = path.join(root, 'node_modules', 'pkg');
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(path.join(modules, 'index.js'), 'one');
    const seen = watch(root, { recursive: true });
    await settle();

    fs.writeFileSync(path.join(modules, 'index.js'), 'two');
    await settle();
    expect(seen.filter(f => f.includes('node_modules'))).toEqual([]);
  });

  // What `ng build my-lib` does to dist: the whole directory is replaced, not
  // rewritten in place. A raw recursive fs.watch misses this and then dies.
  it('survives the watched directory being swapped out', async () => {
    const dist = path.join(root, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'main.js'), 'one');

    const seen = watch(dist, { recursive: true, poll: { intervalMs: 100 } });
    await settle();

    const replacement = path.join(root, 'dist-next');
    fs.mkdirSync(replacement);
    fs.writeFileSync(path.join(replacement, 'main.js'), 'two');
    fs.rmSync(dist, { recursive: true, force: true });
    fs.renameSync(replacement, dist);

    await waitFor(() => seen.some(f => f.endsWith('main.js')));

    // And the watch is still live afterwards, which is the half fs.watch loses.
    seen.length = 0;
    fs.writeFileSync(path.join(dist, 'main.js'), 'three');
    await waitFor(() => seen.some(f => f.endsWith('main.js')));
  });
});
