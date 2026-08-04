import * as path from 'path';

import type { SourceFileCache } from '@angular/build/private';

/**
 * Files the federation compilation actually tracked, deduplicated and without
 * node_modules — the watch list for federation-only rebuilds.
 *
 * Where Angular's `SourceFileCache` records a tracked file depends on the
 * compilation mode. With in-process type checking (`NG_BUILD_PARALLEL_TS=0`)
 * `augmentHostWithCaching` fills the outer Map with parsed `.ts` sources; on
 * the default parallel path the type checker runs in a worker with its own
 * cache and the outer Map stays empty. On both paths emitted `.ts` output
 * lands in `typeScriptFileCache`, and templates/styles are listed only in
 * `referencedFiles`. Reading only `keys()` therefore always missed templates
 * and styles, and on the parallel path missed every tracked file — so
 * shared-mapping and exposed sources never invalidated and the dev server
 * kept serving stale bundles until it was restarted.
 */
export function federationSourceFiles(cache: SourceFileCache): string[] {
  return [
    ...new Set<string>([
      ...cache.keys(),
      ...cache.typeScriptFileCache.keys(),
      ...(cache.referencedFiles ?? []),
    ]),
  ].filter((file) => !file.includes('node_modules'));
}

/**
 * Collapse tracked source files into bounded top-level workspace source trees
 * so Native Federation does not create one fs watcher per source file.
 *
 * A large workspace tracks thousands of sources; per-file watchers do not
 * scale (macOS FSEvents in particular replays and throttles under that many
 * streams, and every platform pays an fd per watcher). Watching the few
 * top-level directories that CONTAIN those files (`libs`, `apps`, ...) keeps
 * the watcher count flat while the callers' relevance filter (is the event
 * path a tracked federation source?) keeps rebuild triggers exact.
 *
 * Files outside the workspace root, at the workspace root itself, or under
 * top-level directories that must never be watched recursively (dot dirs,
 * `node_modules`, build outputs) stay as single-file watches. Nested
 * candidates are deduplicated: a parent directory covers its children.
 */
export function federationWatchPaths(
  files: readonly string[],
  workspaceRoot: string,
): string[] {
  const root = path.resolve(workspaceRoot);
  const candidates = new Set<string>();
  for (const file of files) {
    const resolvedFile = path.resolve(file);
    const relative = path.relative(root, resolvedFile);
    const isInWorkspace =
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative);
    if (!isInWorkspace) {
      candidates.add(resolvedFile);
      continue;
    }
    const segments = relative.split(path.sep);
    const topLevel = segments[0] ?? relative;
    const canWatchSourceTree =
      segments.length > 1 &&
      !topLevel.startsWith('.') &&
      !['node_modules', 'dist', 'out-tsc'].includes(topLevel);
    candidates.add(canWatchSourceTree ? path.join(root, topLevel) : resolvedFile);
  }
  const ordered = [...candidates].sort((left, right) => left.length - right.length);
  const watchPaths: string[] = [];
  for (const candidate of ordered) {
    if (
      watchPaths.some(
        (parent) =>
          candidate === parent || candidate.startsWith(`${parent}${path.sep}`),
      )
    )
      continue;
    watchPaths.push(candidate);
  }
  return watchPaths;
}

/**
 * One-line fingerprint of where the cache tracked its files, for diagnosing
 * which compilation path a dev server is on: a populated outer Map means
 * in-process type checking (`NG_BUILD_PARALLEL_TS=0`); an empty outer Map
 * alongside a populated `typeScriptFileCache` means the parallel-TS path.
 */
export function describeFederationCache(cache: SourceFileCache): string {
  return (
    `SourceFileCache tracked files: outer=${cache.size}, ` +
    `typeScript=${cache.typeScriptFileCache.size}, ` +
    `referenced=${cache.referencedFiles?.length ?? 0}`
  );
}
