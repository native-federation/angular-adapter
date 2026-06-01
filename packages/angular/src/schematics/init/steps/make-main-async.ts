import type { Rule } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import * as path from 'path';

// The adapter's `initFederation` wrapper hides shimMode/logger/storage, so
// generated apps don't ship internal orchestrator options or `logLevel: 'debug'`.
const FEDERATION_IMPORT = `import { initFederation } from '@angular-architects/native-federation-v4';`;

function getFederationArg(
  options: NfSchematicSchema,
  remoteMap: unknown,
  manifestRelPath: string
): string {
  switch (options.type) {
    case 'dynamic-host':
      return `'${manifestRelPath}'`;
    case 'host':
      return JSON.stringify(remoteMap, null, 2).replace(/"/g, "'");
    default:
      return `{ '${options.project}': './remoteEntry.json' }`;
  }
}

export function makeMainAsync(
  main: string,
  options: NfSchematicSchema,
  remoteMap: unknown,
  manifestRelPath: string
): Rule {
  return async function (tree) {
    const mainPath = path.dirname(main);
    const bootstrapName = path.join(mainPath, 'bootstrap.ts');

    if (tree.exists(bootstrapName)) {
      console.info(`${bootstrapName} already exists.`);
      return;
    }

    const mainContent = tree.read(main);
    if (mainContent) tree.create(bootstrapName, mainContent);

    const federationArg = getFederationArg(options, remoteMap, manifestRelPath);

    tree.overwrite(
      main,
      `${FEDERATION_IMPORT}

initFederation(${federationArg})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`
    );
  };
}
