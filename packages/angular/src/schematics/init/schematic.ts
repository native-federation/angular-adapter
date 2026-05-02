import { chain, noop, type Rule, url } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from './schema.js';
import * as path from 'path';

import {
  normalizeOptions,
  getWorkspaceFileName,
  isSsrProject,
  getSsrFilePath,
} from './steps/normalize-options.js';
import { updatePolyfills } from './steps/update-polyfills.js';
import { generateRemoteMap } from './steps/generate-remote-map.js';
import { generateFederationConfig } from './steps/generate-federation-config.js';
import { updateWorkspaceConfig } from './steps/update-workspace-config.js';
import { addDependencies } from './steps/add-dependencies.js';
import { makeMainAsync } from './steps/make-main-async.js';
import { makeServerAsync } from './steps/make-server-async.js';
import { generateTsConfig } from './steps/generate-tsconfig.js';

export { updatePackageJson, patchAngularBuild } from './steps/update-package-json.js';
export { getWorkspaceFileName } from './steps/normalize-options.js';

export default function config(options: NfSchematicSchema): Rule {
  return async function (tree, context) {
    const workspaceFileName = getWorkspaceFileName(tree);
    const workspace = JSON.parse(tree.read(workspaceFileName)?.toString('utf8') ?? '{}');

    const normalized = normalizeOptions(options, workspace, tree);

    const {
      polyfills,
      projectName,
      projectRoot,
      projectSourceRoot,
      manifestPath,
      manifestRelPath,
      main,
    } = normalized;

    updatePolyfills(tree, polyfills);

    const remoteMap = await generateRemoteMap(workspace, projectName);

    if (options.type === 'dynamic-host' && !tree.exists(manifestPath)) {
      tree.create(manifestPath, JSON.stringify(remoteMap, null, '\t'));
    }

    const federationConfigPath = path.join(projectRoot, 'federation.config.mjs');

    const exists = tree.exists(federationConfigPath);

    const cand1 = path.join(projectSourceRoot, 'app', 'app.component.ts').replace(/\\/g, '/');
    const cand2 = path.join(projectSourceRoot, 'app', 'app.ts').replace(/\\/g, '/');

    const appComponent = tree.exists(cand1) ? cand1 : tree.exists(cand2) ? cand2 : 'update-this.ts';

    generateTsConfig(tree, projectRoot, main);

    const generateRule = !exists
      ? generateFederationConfig(
          url('./files'),
          remoteMap,
          projectRoot,
          projectSourceRoot,
          appComponent,
          options
        )
      : noop;

    const ssr = isSsrProject(normalized);
    const server = ssr ? getSsrFilePath(normalized) : '';

    updateWorkspaceConfig(tree, normalized, workspace, workspaceFileName, ssr);

    addDependencies(tree, context, ssr);

    return chain([
      generateRule,
      makeMainAsync(main, options, remoteMap, manifestRelPath),
      ssr ? makeServerAsync(server, options, remoteMap) : noop(),
    ]);
  };
}
