import * as path from 'path';

import { getDefaultCachePath } from '@softarc/native-federation/internal';

export function resolveCachePath(workspaceRoot: string, cachePath?: string): string {
  if (!cachePath) {
    return getDefaultCachePath(workspaceRoot);
  }

  const resolved = path.resolve(workspaceRoot, cachePath);

  // Core purges `<cachePath>/<project>` whenever the adapter's minor changes, so a cachePath
  // at or above the workspace root could delete a source folder named like the project.
  const up = path.relative(resolved, workspaceRoot);
  const isOutside = up === '..' || up.startsWith(`..${path.sep}`) || path.isAbsolute(up);
  if (!isOutside) {
    throw new Error(
      `The cachePath "${cachePath}" resolves to "${resolved}", which contains the workspace ` +
        `root. Point it at a dedicated folder, e.g. ".angular/nf-cache".`
    );
  }

  return resolved;
}
