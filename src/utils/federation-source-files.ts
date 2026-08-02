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
