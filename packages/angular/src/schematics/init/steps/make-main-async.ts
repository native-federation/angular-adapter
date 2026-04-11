import type { Rule } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import * as path from 'path';

const ORCHESTRATOR_IMPORTS = `import { initFederation } from '@softarc/native-federation-orchestrator';
import {
  useShimImportMap,
  consoleLogger,
  globalThisStorageEntry,
} from '@softarc/native-federation-orchestrator/options';`;

const ORCHESTRATOR_OPTIONS = `{
  ...useShimImportMap({ shimMode: true }),
  logger: consoleLogger,
  storage: globalThisStorageEntry,
  hostRemoteEntry: './remoteEntry.json',
  logLevel: 'debug',
}`;

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
      `${ORCHESTRATOR_IMPORTS}

initFederation(${federationArg}, ${ORCHESTRATOR_OPTIONS})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`
    );
  };
}
