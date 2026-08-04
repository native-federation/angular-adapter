import { SourceFileCache } from '@angular/build/private';
import type ts from 'typescript';

import { federationSourceFiles } from './federation-source-files.js';

function cacheWith(options: {
  outer?: readonly string[];
  typeScript?: readonly string[];
  referenced?: readonly string[];
}): SourceFileCache {
  const cache = new SourceFileCache();
  for (const file of options.outer ?? []) {
    cache.set(file, {} as ts.SourceFile);
  }
  for (const file of options.typeScript ?? []) {
    cache.typeScriptFileCache.set(file, '');
  }
  if (options.referenced) {
    cache.referencedFiles = options.referenced;
  }
  return cache;
}

describe('federationSourceFiles', () => {
  it('unions all three places the cache tracks files in', () => {
    // outer Map: in-process TS path; typeScriptFileCache: emitted .ts output;
    // referencedFiles: templates and styles (the only home they ever have).
    const cache = cacheWith({
      outer: ['/app/in-process.ts'],
      typeScript: ['/app/emitted.ts'],
      referenced: ['/app/cmp.html', '/app/cmp.scss'],
    });

    expect(federationSourceFiles(cache).sort()).toEqual([
      '/app/cmp.html',
      '/app/cmp.scss',
      '/app/emitted.ts',
      '/app/in-process.ts',
    ]);
  });

  it('deduplicates files reported by more than one source', () => {
    const cache = cacheWith({
      outer: ['/app/shared.ts'],
      typeScript: ['/app/shared.ts'],
      referenced: ['/app/shared.ts'],
    });

    expect(federationSourceFiles(cache)).toEqual(['/app/shared.ts']);
  });

  it('drops node_modules entries from every source', () => {
    const cache = cacheWith({
      outer: ['/repo/node_modules/dep/index.ts'],
      typeScript: ['/repo/node_modules/dep/emit.ts', '/repo/src/kept.ts'],
      referenced: ['/repo/node_modules/dep/style.css'],
    });

    expect(federationSourceFiles(cache)).toEqual(['/repo/src/kept.ts']);
  });

  it('handles a cache that never set referencedFiles', () => {
    const cache = cacheWith({ typeScript: ['/app/only.ts'] });

    expect(federationSourceFiles(cache)).toEqual(['/app/only.ts']);
  });
});
