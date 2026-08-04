import { SourceFileCache } from '@angular/build/private';
import type ts from 'typescript';

import * as path from 'path';

import {
  describeFederationCache,
  federationSourceFiles,
  federationWatchPaths,
} from './federation-source-files.js';

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

describe('describeFederationCache', () => {
  it('reports the size of each tracking source', () => {
    const cache = cacheWith({
      typeScript: ['/app/a.ts', '/app/b.ts'],
      referenced: ['/app/a.html'],
    });

    expect(describeFederationCache(cache)).toBe(
      'SourceFileCache tracked files: outer=0, typeScript=2, referenced=1',
    );
  });
});

describe('federationWatchPaths', () => {
  const root = path.resolve('/workspace');

  it('collapses workspace files into their top-level source trees', () => {
    const paths = federationWatchPaths(
      [
        path.join(root, 'libs', 'a', 'src', 'index.ts'),
        path.join(root, 'libs', 'b', 'src', 'index.ts'),
        path.join(root, 'apps', 'shell', 'main.ts'),
      ],
      root,
    );

    expect(paths.sort()).toEqual([path.join(root, 'apps'), path.join(root, 'libs')].sort());
  });

  it('keeps files outside the workspace as single-file watches', () => {
    const outside = path.resolve('/elsewhere/lib/index.ts');

    expect(federationWatchPaths([outside], root)).toEqual([outside]);
  });

  it('never watches dot dirs, node_modules or build outputs recursively', () => {
    const dotFile = path.join(root, '.cache', 'x.ts');
    const nodeModulesFile = path.join(root, 'node_modules', 'pkg', 'index.ts');
    const distFile = path.join(root, 'dist', 'main.js');

    const paths = federationWatchPaths([dotFile, nodeModulesFile, distFile], root);

    expect(paths.sort()).toEqual([dotFile, nodeModulesFile, distFile].sort());
  });

  it('keeps a workspace-root-level file as itself', () => {
    const rootFile = path.join(root, 'tsconfig.base.json');

    expect(federationWatchPaths([rootFile], root)).toEqual([rootFile]);
  });

  it('deduplicates nested candidates: a parent tree covers its children', () => {
    const paths = federationWatchPaths(
      [
        path.join(root, 'libs', 'a', 'src', 'index.ts'),
        path.resolve('/elsewhere/libs-extra/index.ts'),
        path.join(root, 'libs', 'deep', 'nested', 'file.ts'),
      ],
      root,
    );

    expect(paths.sort()).toEqual(
      [path.join(root, 'libs'), path.resolve('/elsewhere/libs-extra/index.ts')].sort(),
    );
  });
});
