import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkedSharedDirs, logger } from '@softarc/native-federation/internal';

type LinkedSharedDirsArgs = Parameters<typeof linkedSharedDirs>;

function packageNameOf(dir: string): string {
  try {
    const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name;
    return typeof name === 'string' ? name : dir;
  } catch {
    return dir;
  }
}

/**
 * Without this the `watchLinkedDeps` default reads as a broken build: linking a library
 * and getting no reload looks the same as the feature not working. Only worth saying
 * while watching, and only when turning the option on would actually change something —
 * so ask `linkedSharedDirs` with it forced on, since it returns `[]` when it is off.
 */
export function hintUnwatchedLinkedDeps(
  config: LinkedSharedDirsArgs[0],
  options: LinkedSharedDirsArgs[1]
): void {
  if (options.watchLinkedDeps) return;

  const dirs = linkedSharedDirs(config, { ...options, watchLinkedDeps: true });
  if (dirs.length === 0) return;

  logger.info(
    `Detected npm-linked shared packages: ${dirs.map(packageNameOf).join(', ')}. ` +
      `Set 'watchLinkedDeps' to true on this target to rebuild when they change.`
  );
}
