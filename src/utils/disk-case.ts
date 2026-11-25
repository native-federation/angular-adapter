import type { BuilderContext } from '@angular-devkit/architect';
import { toDiskCase } from '@softarc/native-federation/internal';

/**
 * Windows reports the same directory under whatever drive-letter case the caller used, so the
 * root Nx inherits from the invoking shell can differ by case alone from the one esbuild's own
 * working directory and `process.cwd()` produce. Everything downstream compares paths derived
 * from it as plain strings — most damagingly the angular-compiler plugin's emitted-file cache,
 * whose keys follow the TypeScript program (and thus the workspace root) while its lookups
 * follow esbuild. See issue #117.
 */
export function withDiskCaseWorkspaceRoot(context: BuilderContext): BuilderContext {
  const workspaceRoot = toDiskCase(context.workspaceRoot);

  if (workspaceRoot === context.workspaceRoot) {
    return context;
  }

  // Derived, not spread: the architect context's methods close over the original object, and a
  // non-enumerable or accessor member would not survive a copy.
  return Object.create(context, {
    workspaceRoot: { value: workspaceRoot, enumerable: true },
  }) as BuilderContext;
}
