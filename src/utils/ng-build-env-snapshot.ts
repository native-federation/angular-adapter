import { createRequire } from 'node:module';
import * as path from 'node:path';

export type NgBuildEnvVariable = 'NG_BUILD_PARALLEL_TS' | 'NG_BUILD_OPTIMIZE_CHUNKS';

export interface ReplayMessage {
  level: 'info' | 'warn';
  message: string;
}

// What `environment-options.js` derives from each variable when it disables the feature.
// Angular 21 exports chunk optimization as the opt-in boolean `shouldOptimizeChunks`;
// Angular 22 replaced it with the threshold number `optimizeChunksThreshold`.
const DISABLED: Record<NgBuildEnvVariable, { property: string; value: boolean | number }> = {
  NG_BUILD_PARALLEL_TS: { property: 'useParallelTs', value: false },
  NG_BUILD_OPTIMIZE_CHUNKS: { property: 'shouldOptimizeChunks', value: false },
};

const ENV_OPTIONS_SUFFIX = path.join('@angular', 'build', 'src', 'utils', 'environment-options.js');

/** Escape hatch: `0`/`false` leaves an already-loaded @angular/build alone. */
const OPT_OUT_VARIABLE = 'NF_NG_BUILD_ENV_REPLAY';

const OFF_VALUES = new Set(['0', 'false']);

function isOff(value: string | undefined): boolean {
  return value !== undefined && OFF_VALUES.has(value.toLowerCase());
}

type EnvLike = Record<string, string | undefined>;
type CacheLike = Record<string, { exports?: unknown } | undefined>;

/**
 * Re-applies the `NG_BUILD_*` variables the caller just disabled onto an
 * `@angular/build` that was already loaded — see the README FAQ and #107 / #114.
 * Nx requires `@angular/build/private` before resolving the builder, and
 * `environment-options.js` snapshots the variables on first load, so the caller's
 * writes land too late. Mutating the cached exports works because both consumers
 * re-read the property per call; evicting the module does not, as they keep a
 * reference to the stale namespace.
 *
 * Must run before this package imports `@angular/build`, or it detects our own
 * load. No match means "not loaded yet" *or* "cannot see it" (ESM), not "healthy".
 */
export function replayNgBuildEnv(
  variables: readonly NgBuildEnvVariable[],
  cache: CacheLike = createRequire(import.meta.url).cache,
  env: EnvLike = process.env
): ReplayMessage[] {
  if (isOff(env[OPT_OUT_VARIABLE])) {
    return [];
  }

  const replayed: string[] = [];
  const failed: string[] = [];

  for (const id of Object.keys(cache)) {
    // The exact file, never `@angular/build`: 4 of its modules are already cached
    // here on the healthy path, so a coarse match reports every CLI build as broken.
    if (!id.endsWith(ENV_OPTIONS_SUFFIX)) continue;
    const snapshot = cache[id]?.exports as Record<string, unknown> | undefined;
    if (!snapshot) continue;

    for (const variable of variables) {
      const { property, value } = DISABLED[variable];
      if (!isOff(env[variable]) || snapshot[property] === value) continue;

      if (typeof snapshot[property] !== typeof value) {
        failed.push(`${property} (expected a ${typeof value}, found ${typeof snapshot[property]})`);
        continue;
      }
      try {
        snapshot[property] = value;
      } catch {
        // Strict mode: assigning to a getter-only export throws.
      }
      if (snapshot[property] === value) {
        replayed.push(`${property}=${value}`);
      } else {
        failed.push(`${property} (not writable)`);
      }
    }
  }

  const messages: ReplayMessage[] = [];
  if (replayed.length > 0) {
    messages.push({
      level: 'info',
      message:
        `@angular/build was already loaded when this builder started (Nx preloads it), ` +
        `so its build environment was stale; re-applied ${replayed.join(', ')}.`,
    });
  }
  if (failed.length > 0) {
    messages.push({
      level: 'warn',
      message:
        `Could not re-apply ${failed.join(', ')} on the already-loaded @angular/build. Builds ` +
        `may re-bundle federated chunks. Set NG_BUILD_OPTIMIZE_CHUNKS=0 and ` +
        `NG_BUILD_PARALLEL_TS=0 in the environment (e.g. a workspace-root .env file) and ` +
        `report this at https://github.com/native-federation/angular-adapter/issues.`,
    });
  }

  return messages;
}
