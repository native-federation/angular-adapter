import * as path from "path";

import { isUnderAnyDir, isUnderDir } from "@softarc/native-federation/internal";

export interface FederationFreshness {
  /** Record the outcome of a watcher-driven federation rebuild. */
  mark(success: boolean): void;
  /**
   * True when the Angular output being consumed now needs no federation rebuild.
   * Clears the flag either way — it only vouches for the window since the last
   * consumed Angular output, so it must be consumed with that output rather than
   * at the point a rebuild would run.
   */
  consume(dirtyPathCount: number | undefined): boolean;
}

export function createFederationFreshness(): FederationFreshness {
  let fresh = false;

  return {
    mark(success: boolean): void {
      fresh = success;
    },
    consume(dirtyPathCount: number | undefined): boolean {
      const covers = fresh && dirtyPathCount === 0;
      fresh = false;
      return covers;
    },
  };
}

/**
 * Whether a watcher wake-up should drive a federation-only rebuild. `undefined`
 * means no watcher, so nothing can be pending.
 */
export function shouldRunWatcherRebuild(
  first: boolean,
  dirtyPathCount: number | undefined,
): boolean {
  return !first && dirtyPathCount !== undefined && dirtyPathCount > 0;
}

/**
 * Whether a changed path has to wake the federation rebuild directly, because
 * Angular's iterator will not emit for it.
 *
 * `watchedFiles` is what the last federation build compiled. `wakeDirs` covers
 * what that set cannot: linked shared packages (externals to the app build) and
 * shared-mapping source dirs, where a *newly created* file is by definition
 * absent from any compiled-inputs set and is not yet imported by the app.
 *
 * Core's `isUnderAnyDir` rather than a `path.sep` comparison: it delivers posix
 * paths, so splicing in the native separator is always false on Windows.
 *
 * `outputPath` is excluded first: with `sharedMappings` unset core promotes every
 * tsconfig `paths` entry to a mapping, so an entry point near the workspace root
 * yields a wake dir containing the federation output — and a rebuild writes there
 * with a fresh mtime, which is not a replay, so the loop would wake itself forever.
 * Filtering the event rather than dropping the dir keeps the rest of that dir's
 * sources woken.
 */
export function shouldWakeFederation(
  changedPath: string,
  watchedFiles: ReadonlySet<string>,
  wakeDirs: readonly string[],
  outputPath: string,
): boolean {
  if (isUnderDir(changedPath, outputPath)) return false;

  return (
    isUnderAnyDir(changedPath, wakeDirs) ||
    watchedFiles.has(path.normalize(changedPath))
  );
}
