import type { Rule, Tree } from '@angular-devkit/schematics';
import * as path from 'path';

/**
 * Switch the scaffolded `RenderMode.Prerender` to `Server` in
 * `app.routes.server.ts`. A federated remote loads at runtime and can't be
 * prerendered, so the catch-all route must render on the server. Idempotent.
 */
export function setServerRenderMode(projectSourceRoot: string): Rule {
  return async function (tree: Tree) {
    const routesPath = path
      .join(projectSourceRoot, 'app', 'app.routes.server.ts')
      .replace(/\\/g, '/');

    const content = tree.read(routesPath)?.toString('utf8');
    if (!content) {
      console.info(`${routesPath} not found; skipping render mode update.`);
      return;
    }

    if (!content.includes('RenderMode.Prerender')) {
      return;
    }

    tree.overwrite(routesPath, content.replace(/RenderMode\.Prerender/g, 'RenderMode.Server'));
  };
}
