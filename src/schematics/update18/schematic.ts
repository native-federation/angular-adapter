import type { Rule, Tree } from '@angular-devkit/schematics';

import { updatePackageJson } from '../init/schematic.js';

export default function update18(): Rule {
  return async function (tree: Tree) {
    // Drop the obsolete postinstall patch script. The `@angular/build` private
    // entry is now consumed directly via its native `./private` export, so the
    // node_modules patch (`patchAngularBuild`) is no longer applied.
    updatePackageJson(tree);
  };
}
