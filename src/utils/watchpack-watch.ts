import * as path from 'node:path';
import Watchpack from 'watchpack';
import type { WatchPort } from '@softarc/native-federation/internal';

/**
 * Watchpack-backed replacement for core's built-in watch, which is dependency-free
 * but re-walks the tree every poll interval — around a quarter of a core on a large
 * checkout. Watchpack is event-driven and already survives the directory swap that
 * `ng build <lib>` does to `dist`, which a raw `fs.watch` does not.
 */
export const watchpackWatch: WatchPort['watch'] = (watchPath, opts, onEvent) => {
  const root = path.resolve(watchPath);

  const watchpack = new Watchpack({
    // Core debounces and drops replays itself; batching again here only adds latency.
    aggregateTimeout: 0,
    followSymlinks: false,
    poll: opts.poll ? opts.poll.intervalMs : false,
    ignored: entry => {
      const rel = path.relative(root, entry);
      if (!rel || rel.startsWith('..')) return false;
      const segments = rel.split(path.sep);
      if (segments.includes('node_modules')) return true;
      // Watchpack always descends. Leaving depth 1 visible keeps a non-recursive
      // watch reporting entries added or removed directly under `root` — ignoring
      // everything below is what stops it going deeper than fs.watch would.
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
