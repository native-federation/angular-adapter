import * as fs from 'fs';
import * as path from 'path';

import type { BuilderContext } from '@angular-devkit/architect';

/**
 * Windows reports the same directory under whatever drive-letter case the caller used, so the
 * root Nx inherits from the invoking shell can differ by case alone from the one esbuild's own
 * working directory and `process.cwd()` produce. Everything downstream compares paths derived
 * from it as plain strings — most damagingly the angular-compiler plugin's emitted-file cache,
 * whose keys follow the TypeScript program (and thus the workspace root) while its lookups
 * follow esbuild. See issue #117.
 */
export function withCanonicalWorkspaceRoot(context: BuilderContext): BuilderContext {
  const workspaceRoot = toCanonicalCase(context.workspaceRoot);

  if (workspaceRoot === context.workspaceRoot) {
    return context;
  }

  // Derived, not spread: the architect context's methods close over the original object, and a
  // non-enumerable or accessor member would not survive a copy.
  return Object.create(context, {
    workspaceRoot: { value: workspaceRoot, enumerable: true },
  }) as BuilderContext;
}

/**
 * The on-disk spelling of `p`, but only when it differs from `p` by case alone. `realpath` also
 * resolves symlinks, and adopting that result would move npm-linked and pnpm workspaces off the
 * path they were handed.
 */
export function toCanonicalCase(p: string): string {
  let real: string;

  try {
    // `fs.realpathSync` walks the components of the string it was given and only rewrites the
    // ones that are symlinks, so it preserves the caller's casing. Only the native variant
    // reports the case as stored on disk.
    real = fs.realpathSync.native(p);
  } catch {
    return p;
  }

  return isSamePath(real, p) ? path.normalize(real) : p;
}

// Separator style and a trailing slash are not differences worth rejecting a correction over.
const forCompare = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function isSamePath(a: string, b: string): boolean {
  return forCompare(a) === forCompare(b);
}
