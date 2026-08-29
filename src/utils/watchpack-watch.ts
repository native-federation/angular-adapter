import * as path from 'node:path';
import Watchpack from 'watchpack';
import type { WatchPort } from '@softarc/native-federation/internal';

/**
 * Watchpack-backed replacement for core's built-in watch. Event-driven like `fs.watch`
 * for a source directory, but it survives the `dist` swap `ng build <lib>` does, which
 * `fs.watch` reports once before dying on the deleted inode.
 */
export const watchpackWatch: WatchPort['watch'] = (watchPath, opts, onEvent) => {
  const root = path.resolve(watchPath);

  const watchpack = new Watchpack({
    // Core hands us realpaths; following would only descend into .pnpm.
    followSymlinks: false,
    // Don't drop: watchpack only re-covers a swapped directory while polling.
    poll: opts.poll ? opts.poll.intervalMs : false,
    ignored: entry => {
      const rel = path.relative(root, entry);
      if (!rel || rel.startsWith('..')) return false;
      const segments = rel.split(path.sep);
      if (segments.includes('node_modules')) return true;
      // Watchpack descends either way; this only collapses a deeper change onto its
      // depth-1 ancestor. fs.watch would report nothing at all, but core's only
      // non-recursive watch drops the collapsed path as an untracked file anyway.
      return !opts.recursive && segments.length > 1;
    },
  });

  const emit = (entry: string): void => {
    const rel = path.relative(root, entry);
    if (rel) onEvent(rel);
  };

  watchpack.on('change', emit);
  watchpack.on('remove', emit);
  watchpack.watch({ directories: [root], startTime: Date.now() });

  return { close: () => watchpack.close() };
};
