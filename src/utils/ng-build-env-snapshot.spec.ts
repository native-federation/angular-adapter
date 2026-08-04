import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { type NgBuildEnvVariable, replayNgBuildEnv } from './ng-build-env-snapshot.js';

const CACHE_ID = path.join('/ws/node_modules/@angular/build/src/utils/environment-options.js');

/** The values @angular/build freezes when no NG_BUILD_* variable is set. */
function defaultSnapshot(): Record<string, unknown> {
  return { useParallelTs: true, optimizeChunksThreshold: 3, maxWorkers: 4 };
}

function cacheWith(...snapshots: Record<string, unknown>[]) {
  const cache: Record<string, { exports?: unknown }> = {};
  snapshots.forEach((exports, i) => {
    cache[i === 0 ? CACHE_ID : CACHE_ID.replace('/ws/', `/ws/other-${i}/`)] = { exports };
  });
  return cache;
}

const BOTH: NgBuildEnvVariable[] = ['NG_BUILD_PARALLEL_TS', 'NG_BUILD_OPTIMIZE_CHUNKS'];
/** What setup-builder-env-variables.ts has written by the time we run. */
const ADAPTER_ENV = { NG_BUILD_PARALLEL_TS: '0', NG_BUILD_OPTIMIZE_CHUNKS: '0' };

describe('replayNgBuildEnv', () => {
  it('does nothing when @angular/build has not been loaded (the Angular CLI path)', () => {
    expect(replayNgBuildEnv(BOTH, {}, ADAPTER_ENV)).toEqual([]);
  });

  it('ignores other @angular/build modules', () => {
    // The healthy path already has 4 of them cached; a coarse match would fire here.
    const cache = { '/ws/node_modules/@angular/build/src/private.js': { exports: {} } };

    expect(replayNgBuildEnv(BOTH, cache, ADAPTER_ENV)).toEqual([]);
  });

  it('skips a cache entry without exports', () => {
    expect(replayNgBuildEnv(BOTH, { [CACHE_ID]: {} }, ADAPTER_ENV)).toEqual([]);
  });

  it('re-applies both variables onto a stale snapshot', () => {
    const snapshot = defaultSnapshot();

    const messages = replayNgBuildEnv(BOTH, cacheWith(snapshot), ADAPTER_ENV);

    expect(snapshot['useParallelTs']).toBe(false);
    expect(snapshot['optimizeChunksThreshold']).toBe(Infinity);
    expect(snapshot['maxWorkers']).toBe(4);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe('info');
    expect(messages[0]?.message).toContain('useParallelTs=false, optimizeChunksThreshold=Infinity');
  });

  it('only touches the variables it was asked about', () => {
    const snapshot = defaultSnapshot();

    replayNgBuildEnv(['NG_BUILD_PARALLEL_TS'], cacheWith(snapshot), ADAPTER_ENV);

    expect(snapshot['useParallelTs']).toBe(false);
    expect(snapshot['optimizeChunksThreshold']).toBe(3);
  });

  it('leaves the snapshot alone when the variable does not disable the feature', () => {
    const snapshot = defaultSnapshot();

    // A user who asked for parallel TS keeps it, exactly as under the CLI, where
    // setup-builder-env-variables.ts leaves an already-set variable in place.
    const messages = replayNgBuildEnv(BOTH, cacheWith(snapshot), {
      NG_BUILD_PARALLEL_TS: '1',
      NG_BUILD_OPTIMIZE_CHUNKS: '5',
    });

    expect(snapshot).toEqual(defaultSnapshot());
    expect(messages).toEqual([]);
  });

  it.each(['0', 'false', 'FALSE'])('accepts %s as "disabled"', value => {
    const snapshot = defaultSnapshot();

    replayNgBuildEnv(['NG_BUILD_PARALLEL_TS'], cacheWith(snapshot), {
      NG_BUILD_PARALLEL_TS: value,
    });

    expect(snapshot['useParallelTs']).toBe(false);
  });

  it('says nothing when the snapshot already matches', () => {
    const snapshot = { useParallelTs: false, optimizeChunksThreshold: Infinity };

    expect(replayNgBuildEnv(BOTH, cacheWith(snapshot), ADAPTER_ENV)).toEqual([]);
  });

  it('patches every copy of @angular/build in the cache', () => {
    const first = defaultSnapshot();
    const second = defaultSnapshot();

    replayNgBuildEnv(['NG_BUILD_OPTIMIZE_CHUNKS'], cacheWith(first, second), ADAPTER_ENV);

    expect(first['optimizeChunksThreshold']).toBe(Infinity);
    expect(second['optimizeChunksThreshold']).toBe(Infinity);
  });

  it('warns instead of throwing when upstream renamed the export', () => {
    const messages = replayNgBuildEnv(BOTH, cacheWith({ useParallelTs: true }), ADAPTER_ENV);

    expect(messages.map(m => m.level)).toEqual(['info', 'warn']);
    expect(messages[1]?.message).toContain(
      'optimizeChunksThreshold (expected a number, found undefined)'
    );
  });

  it('warns instead of throwing when upstream changed the type', () => {
    const messages = replayNgBuildEnv(
      ['NG_BUILD_OPTIMIZE_CHUNKS'],
      cacheWith({ optimizeChunksThreshold: 'three' }),
      ADAPTER_ENV
    );

    expect(messages[0]?.level).toBe('warn');
    expect(messages[0]?.message).toContain(
      'optimizeChunksThreshold (expected a number, found string)'
    );
  });

  it.each([
    ['an accessor', { get: () => 3 }],
    ['read-only', { value: 3, writable: false }],
  ])('warns instead of throwing when the export became %s', (_label, descriptor) => {
    const snapshot = {};
    Object.defineProperty(snapshot, 'optimizeChunksThreshold', descriptor);

    const messages = replayNgBuildEnv(
      ['NG_BUILD_OPTIMIZE_CHUNKS'],
      cacheWith(snapshot),
      ADAPTER_ENV
    );

    expect(messages[0]?.level).toBe('warn');
    expect(messages[0]?.message).toContain('optimizeChunksThreshold (not writable)');
  });

  it.each(['0', 'false', 'FALSE'])('is disabled by NF_NG_BUILD_ENV_REPLAY=%s', value => {
    const snapshot = defaultSnapshot();

    const messages = replayNgBuildEnv(BOTH, cacheWith(snapshot), {
      ...ADAPTER_ENV,
      NF_NG_BUILD_ENV_REPLAY: value,
    });

    expect(snapshot).toEqual(defaultSnapshot());
    expect(messages).toEqual([]);
  });
});
