import {
  chain,
  noop,
  SchematicsException,
  type Rule,
  type SchematicContext,
  type Tree,
  url,
} from '@angular-devkit/schematics';
import { DEFAULT_NF_CONFIG_FILE_NAME } from '../../config/constants.js';
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
import { generateFederationTsConfig } from './steps/generate-federation-tsconfig.js';
import { addDependencies } from './steps/add-dependencies.js';
import { makeMainAsync, type WebComponentOutcome } from './steps/make-main-async.js';
import { makeServerAsync } from './steps/make-server-async.js';
import { setServerRenderMode } from './steps/set-server-render-mode.js';
import { wireServeSsrScript } from './steps/wire-serve-ssr-script.js';
import { resolveAppComponent } from './steps/resolve-app-component.js';

export { updatePackageJson } from './steps/update-package-json.js';
export { getWorkspaceFileName } from './steps/normalize-options.js';

export default function config(options: NfSchematicSchema): Rule {
  return async function (tree) {
    if (options.webcomponent && options.type !== 'remote') {
      throw new SchematicsException(
        `--webcomponent is only valid for --type remote; a '${options.type}' bootstraps the ` +
          `application itself, which registering a custom element does not do.`
      );
    }

    const workspaceFileName = getWorkspaceFileName(tree);
    const workspace = JSON.parse(tree.read(workspaceFileName)?.toString('utf8') ?? '{}');

    const normalized = normalizeOptions(options, workspace, tree);

    const {
      polyfills,
      projectName,
      projectRoot,
      projectSourceRoot,
      manifestPath,
    } = normalized;

    updatePolyfills(tree, polyfills);

    const remoteMap = await generateRemoteMap(workspace, projectName);

    if (options.type === 'dynamic-host' && !tree.exists(manifestPath)) {
      tree.create(manifestPath, JSON.stringify(remoteMap, null, '\t'));
    }

    const federationConfigPath = path.join(projectRoot, DEFAULT_NF_CONFIG_FILE_NAME);

    const exists = tree.exists(federationConfigPath);

    const appComponent = resolveAppComponent(tree, projectSourceRoot)?.path ?? 'update-this.ts';

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

    const federationTsConfig = generateFederationTsConfig(tree, normalized);

    updateWorkspaceConfig(tree, normalized, workspace, workspaceFileName, ssr, federationTsConfig);

    // `--webcomponent` is a no-op when bootstrap.ts already exists, so @angular/elements is
    // only pulled in once makeMainAsync has actually written a custom element bootstrap.
    const webComponent: WebComponentOutcome = { generated: false };

    return chain([
      generateRule,
      makeMainAsync(normalized, options, remoteMap, webComponent),
      (t: Tree, c: SchematicContext) =>
        addDependencies(t, c, { ssr, webcomponent: webComponent.generated }),
      ssr ? makeServerAsync(server, options) : noop(),
      ssr ? setServerRenderMode(projectSourceRoot) : noop(),
      ssr ? wireServeSsrScript(projectName) : noop(),
    ]);
  };
}
