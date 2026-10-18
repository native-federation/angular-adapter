import * as path from 'path';

import { resolveCachePath } from './resolve-cache-path.js';

const root = path.resolve('/workspace/app');

describe('resolveCachePath', () => {
  it('falls back to core default when unset or empty', () => {
    expect(resolveCachePath(root)).toBe(path.join(root, 'node_modules/.cache/native-federation'));
    expect(resolveCachePath(root, '')).toBe(
      path.join(root, 'node_modules/.cache/native-federation')
    );
  });

  it('resolves a relative path against the workspace root', () => {
    expect(resolveCachePath(root, '.angular/nf-cache')).toBe(path.join(root, '.angular/nf-cache'));
  });

  it('keeps an absolute path as is', () => {
    const abs = path.resolve('/tmp/nf-cache');
    expect(resolveCachePath(root, abs)).toBe(abs);
  });

  it('normalizes ".." segments, allowing a folder outside the workspace', () => {
    expect(resolveCachePath(root, '../shared-cache/nf')).toBe(
      path.resolve('/workspace/shared-cache/nf')
    );
  });

  it('accepts a sibling whose name merely starts with ".."', () => {
    // path.relative(root/..foo, root) is "..": a plain prefix check on ".." would misread
    // names like this, so the helper compares whole segments.
    expect(resolveCachePath(root, '..foo')).toBe(path.join(root, '..foo'));
  });

  it('rejects an ancestor whose child folder name starts with ".."', () => {
    const odd = path.resolve('/workspace/..hidden/app');
    expect(() => resolveCachePath(odd, '..')).toThrow(/contains the workspace root/);
  });

  // Core rm -rf's <cachePath>/<project> on an adapter minor bump; these would hit sources.
  it.each(['.', './', '..', '../..', root, path.resolve('/')])(
    'rejects %s, which contains the workspace root',
    cachePath => {
      expect(() => resolveCachePath(root, cachePath)).toThrow(/contains the workspace root/);
    }
  );
});
