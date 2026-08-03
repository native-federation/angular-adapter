import { createNfWatcher, type NfFileWatcher } from '@softarc/native-federation/internal';

export interface DebouncedChangeWatcher {
  watcher: NfFileWatcher;
  pendingPaths: Set<string>;
  waitForChange: () => Promise<void>;
  resetChangePromise: () => void;
  dispose: () => void;
}

export function createDebouncedChangeWatcher(
  rebuildDelay: number,
  isRealChange?: (path: string) => boolean
): DebouncedChangeWatcher {
  const pendingPaths = new Set<string>();

  let notifyChange: () => void = () => {};
  let changePromise: Promise<void> = new Promise<void>(r => (notifyChange = r));

  const resetChangePromise = (): void => {
    changePromise = new Promise<void>(r => (notifyChange = r));
  };

  const debounceMs = Math.max(10, rebuildDelay);
  let debounceTimer: NodeJS.Timeout | undefined;
  const scheduleNotify = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      notifyChange();
    }, debounceMs);
  };

  const watcher = createNfWatcher({
    onChange: p => {
      // Same-mtime replays (macOS FSEvents re-delivers events for recently
      // edited files) must not enter pendingPaths: each entry drives a full
      // rebuild cycle, so unfiltered replays rebuild forever.
      if (isRealChange && !isRealChange(p)) return;
      pendingPaths.add(p);
      scheduleNotify();
    },
  });

  return {
    watcher,
    pendingPaths,
    waitForChange: () => changePromise,
    resetChangePromise,
    dispose: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}
