import type { Rule, Tree } from '@angular-devkit/schematics';

import { patchAngularBuild, updatePackageJson } from '../init/schematic.js';

export default function update18(): Rule {
  return async function (tree: Tree) {
    updatePackageJson(tree);
    patchAngularBuild(tree);
  };
}
