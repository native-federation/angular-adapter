import { logger } from '@softarc/native-federation/internal';
import { watch, statSync, type FSWatcher } from 'fs';
import { join } from 'path';

const toUnix = (p: string) => p.replace(/\\/g, '/');

export interface NfWatcher {
  add(paths: string | readonly string[]): void;
  close(): Promise<void>;
  readonly pendingChanges: Set<string>;
}

export function createNfWatcher(): NfWatcher {
  const watchers = new Map<string, FSWatcher>();
  const pendingChanges = new Set<string>();

  return {
    pendingChanges,

    add(paths) {
      const list = typeof paths === 'string' ? [paths] : [...paths];
      for (const p of list) {
        if (watchers.has(p)) continue;
        try {
          const isDir = statSync(p).isDirectory();
          const w = isDir
            ? watch(p, { recursive: true }, (_, filename) => {
                if (filename) pendingChanges.add(toUnix(join(p, filename)));
              })
            : watch(p, () => pendingChanges.add(toUnix(p)));
          watchers.set(p, w);
        } catch {
          logger.debug(`Could not watch path '${p}'.`);
        }
      }
    },

    async close() {
      for (const w of watchers.values()) {
        w.close();
      }
      watchers.clear();
    },
  };
}

export function syncNfWatcher(
  watcher: NfWatcher,
  bundlerCache: { keys(): IterableIterator<string> }
): void {
  const files = [...bundlerCache.keys()].filter(k => !k.includes('node_modules'));
  if (files.length) watcher.add(files);
}
