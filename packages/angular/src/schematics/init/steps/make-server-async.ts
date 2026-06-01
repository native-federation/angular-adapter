import type { Rule, Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';

/**
 * Enable CORS in an SSR project's `server.ts` (remotes are served from other
 * origins). Federation itself is initialised at launch by the `--import` preload
 * (see `src/node-preload.ts`), not here.
 */
export function makeServerAsync(server: string, options: NfSchematicSchema): Rule {
  return async function (tree: Tree) {
    const content = tree.read(server)?.toString('utf8');

    if (!content) {
      console.info(`${server} not found; skipping SSR server setup.`);
      return;
    }

    if (content.includes('app.use(cors())')) {
      console.info(`${server} already prepared for federated SSR.`);
      return;
    }

    const cors = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cors = require('cors');
`;

    const updatedContent = (cors + content)
      .replace(
        // Anchor loosely on Angular's scaffolded `process.env['PORT'] || <n>` so
        // a whitespace/default-value tweak in the template doesn't silently no-op.
        /const port = process\.env\['PORT'\]\s*\|\|\s*\d+/,
        `const port = process.env['PORT'] || ${options.port || 4000}`
      )
      .replace(`const app = express();`, `const app = express();\n  app.use(cors());`);

    tree.overwrite(server, updatedContent);
  };
}
