import * as fs from 'fs';
import * as path from 'path';

export interface StaleWatchEventFilter {
  /** Record the current mtime when a file first enters the watch list. */
  seed(file: string): void;
  /** True when the event reflects an actual content change (or a deletion). */
  isRealChange(file: string): boolean;
}

/**
 * Drops file-watch events that do not correspond to a content change.
 *
 * On macOS, FSEvents re-delivers "changed" events for recently modified files
 * on a ~30s cadence even when nothing touched them again (mtime and ctime
 * stay put). Once the watch list covers every federation-tracked source
 * (federationSourceFiles), a single recently-edited file otherwise wakes the
 * rebuild loop forever — rebuild, replayed event, rebuild — pinning a core
 * until the dev server is stopped.
 *
 * Comparing the file's mtime against the last value seen lets every real
 * save through (its mtime advances) while replays compare equal and are
 * dropped before they reach the dirty buffer. A failed stat counts as a real
 * change: a deleted or renamed-away file must trigger a rebuild.
 */
export function createStaleWatchEventFilter(): StaleWatchEventFilter {
  const mtimes = new Map<string, number>();

  const mtimeOf = (file: string): number | null => {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return null;
    }
  };

  return {
    seed(file: string): void {
      const key = path.normalize(file);
      if (mtimes.has(key)) return;
      const mtime = mtimeOf(key);
      if (mtime !== null) mtimes.set(key, mtime);
    },
    isRealChange(file: string): boolean {
      const key = path.normalize(file);
      const mtime = mtimeOf(key);
      if (mtime === null) {
        mtimes.delete(key);
        return true;
      }
      if (mtimes.get(key) === mtime) {
        return false;
      }
      mtimes.set(key, mtime);
      return true;
    },
  };
}
