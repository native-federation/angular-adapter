import type { Tree } from '@angular-devkit/schematics';
import * as path from 'path';

export function generateTsConfig(tree: Tree, projectRoot: string, main: string): void {
  const tsconfigPath = path.join(projectRoot, 'tsconfig.federation.json').replace(/\\/g, '/');

  if (tree.exists(tsconfigPath)) {
    return;
  }

  const relToRoot = path.relative(projectRoot, '.').replace(/\\/g, '/') || '.';
  const mainRelative = path.relative(projectRoot, main).replace(/\\/g, '/');

  const tsconfig = {
    extends: `${relToRoot}/tsconfig.json`,
    compilerOptions: {
      outDir: `${relToRoot}/out-tsc/app`,
      types: [],
    },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.spec.ts'],
    files: [mainRelative],
  };

  tree.create(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
}
