import type { SourceFileCache } from '@angular/build/private';

/**
 * Files the federation compilation actually tracked, deduplicated and without
 * node_modules — the watch list for federation-only rebuilds.
 *
 * Emitted `.ts` output lands in `typeScriptFileCache`, while templates and
 * styles are listed only in `referencedFiles`; reading just one of them left
 * shared-mapping and exposed sources stale until the dev server restarted.
 */
export function federationSourceFiles(cache: SourceFileCache): string[] {
  return [
    ...new Set<string>([...cache.typeScriptFileCache.keys(), ...(cache.referencedFiles ?? [])]),
  ].filter((file) => !file.includes('node_modules'));
}
