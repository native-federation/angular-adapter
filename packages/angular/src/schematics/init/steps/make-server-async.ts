import type { Rule, Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import * as path from 'path';

export function makeServerAsync(
  server: string,
  options: NfSchematicSchema,
  remoteMap: unknown
): Rule {
  return async function (tree: Tree) {
    const mainPath = path.dirname(server);
    const bootstrapName = path.join(mainPath, 'bootstrap-server.ts');

    if (tree.exists(bootstrapName)) {
      console.info(`${bootstrapName} already exists.`);
      return;
    }

    const cors = `import { createRequire } from "module";
const require = createRequire(import.meta.url);
const cors = require("cors");
`;
    const mainContent = tree.read(server)?.toString('utf8');
    const updatedContent = (cors + mainContent)
      .replace(
        `const port = process.env['PORT'] || 4000`,
        `const port = process.env['PORT'] || ${options.port || 4000}`
      )
      .replace(
        `const app = express();`,
        `const app = express();\n\tapp.use(cors());\n  app.set('view engine', 'html');`
      )
      .replace(`if (isMainModule(import.meta.url)) {`, ``)
      .replace(/\}(?![\s\S]*\})/, '');

    tree.create(bootstrapName, updatedContent);

    let newMainContent = '';
    if (options.type === 'dynamic-host') {
      newMainContent = `import { initNodeFederation } from '@softarc/native-federation-node';

console.log('Starting SSR for Shell');

(async () => {

  await initNodeFederation({
    remotesOrManifestUrl: '../browser/federation.manifest.json',
    relBundlePath: '../browser/',
  });

  await import('./bootstrap-server');

})();
`;
    } else if (options.type === 'host') {
      const manifest = JSON.stringify(remoteMap, null, 2).replace(/"/g, "'");
      newMainContent = `import { initNodeFederation } from '@softarc/native-federation-node';

console.log('Starting SSR for Shell');

(async () => {

  await initNodeFederation({
    remotesOrManifestUrl: ${manifest},
    relBundlePath: '../browser/',
  });

  await import('./bootstrap-server');

})();
`;
    } else {
      newMainContent = `import { initNodeFederation } from '@softarc/native-federation-node';

(async () => {

  await initNodeFederation({
    relBundlePath: '../browser/'
  });

  await import('./bootstrap-server');

})();
`;
    }

    tree.overwrite(server, newMainContent);
  };
}
