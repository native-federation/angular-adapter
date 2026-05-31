import type { Rule, Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';

/**
 * Prepare an SSR project's `server.ts` for federated SSR. Federation is *not*
 * initialised here (the build's generated entry does that — see
 * `tools/federation-server-entry.ts`); this step only:
 *  - enables CORS (remotes are served from other origins), and
 *  - makes the server listen when imported (not main) by honouring `pm_id`,
 *    which the generated entry sets.
 */
export function makeServerAsync(server: string, options: NfSchematicSchema): Rule {
  return async function (tree: Tree) {
    const content = tree.read(server)?.toString('utf8');

    if (!content) {
      console.info(`${server} not found; skipping SSR server setup.`);
      return;
    }

    if (content.includes("process.env['pm_id']")) {
      console.info(`${server} already prepared for federated SSR.`);
      return;
    }

    const cors = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cors = require('cors');
`;

    const updatedContent = (cors + content)
      .replace(
        `const port = process.env['PORT'] || 4000`,
        `const port = process.env['PORT'] || ${options.port || 4000}`
      )
      .replace(`const app = express();`, `const app = express();\n  app.use(cors());`)
      .replace(
        `if (isMainModule(import.meta.url)) {`,
        `if (isMainModule(import.meta.url) || process.env['pm_id']) {`
      );

    tree.overwrite(server, updatedContent);
  };
}
