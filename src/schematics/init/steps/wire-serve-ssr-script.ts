import type { Rule, Tree } from '@angular-devkit/schematics';

const NODE_PRELOAD = '@angular-architects/native-federation-v4/node-preload';

/**
 * Rewrite the target project's `serve:ssr:<project>` npm script to launch through
 * the federation `--import` preload (see `src/node-preload.ts`); without the flag
 * the SSR server renders without federated remotes. Scoped to the project being
 * added so sibling (possibly non-federated) SSR apps are left untouched. Idempotent.
 */
export function wireServeSsrScript(projectName: string): Rule {
  return async function (tree: Tree) {
    if (!tree.exists('package.json')) {
      return;
    }

    const pkg = JSON.parse(tree.read('package.json')!.toString('utf8'));
    const scripts: Record<string, string> | undefined = pkg.scripts;
    const name = `serve:ssr:${projectName}`;
    const cmd = scripts?.[name];

    if (typeof cmd !== 'string') {
      console.info(
        `No "${name}" script found; add "--import ${NODE_PRELOAD}" to your SSR launch ` +
          `command manually so federated remotes render server-side.`
      );
      return;
    }

    if (cmd.includes(NODE_PRELOAD)) {
      return;
    }

    // Insert the preload after `node` (start of script or after a `&&`), so a
    // wrapper like `cross-env X=Y && node …` keeps its prefix.
    const updated = cmd.replace(/(^|&&\s*)node\b/, `$1node --import ${NODE_PRELOAD}`);
    if (updated !== cmd) {
      scripts![name] = updated;
      tree.overwrite('package.json', JSON.stringify(pkg, null, 2));
    }
  };
}
