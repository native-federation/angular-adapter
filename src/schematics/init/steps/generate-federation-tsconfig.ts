import type { Tree } from '@angular-devkit/schematics';
import type { NormalizedOptions } from './normalize-options.js';
import * as path from 'path';

const NF_BUILDER = '@angular-architects/native-federation-v4:build';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function federationTsConfigPath(projectRoot: string): string {
  return toPosix(path.join(projectRoot, 'tsconfig.federation.json'));
}

export interface FederationTsConfigOptions {
  projectRoot: string;
  projectSourceRoot: string;
  /** Workspace-relative path of the tsconfig to extend, usually the app's. */
  appTsConfig: string;
}

// No `files`: each build context supplies its own (utils/write-context-tsconfig.ts).
// Extends the app tsconfig for its paths, which esbuild's module resolution also needs.
export function writeFederationTsConfig(tree: Tree, options: FederationTsConfigOptions): string {
  const { projectRoot, projectSourceRoot, appTsConfig } = options;

  const federationTsConfig = federationTsConfigPath(projectRoot);

  const extendsPath = toPosix(path.relative(projectRoot, appTsConfig));
  const sourceDir = toPosix(path.relative(projectRoot, projectSourceRoot));

  tree.create(
    federationTsConfig,
    JSON.stringify(
      {
        extends: extendsPath.startsWith('.') ? extendsPath : `./${extendsPath}`,
        include: [`${sourceDir}/**/*.d.ts`],
      },
      null,
      2
    )
  );

  return federationTsConfig;
}

export function generateFederationTsConfig(tree: Tree, options: NormalizedOptions): string {
  const { projectConfig, projectRoot, projectSourceRoot } = options;

  const federationTsConfig = federationTsConfigPath(projectRoot);

  if (projectConfig.architect.build.builder === NF_BUILDER || tree.exists(federationTsConfig)) {
    return federationTsConfig;
  }

  const appTsConfig =
    projectConfig.architect.build.options?.tsConfig ??
    projectConfig.architect.esbuild?.options?.tsConfig;

  if (!appTsConfig) {
    throw new Error(`The build target of ${options.projectName} has no tsConfig!`);
  }

  return writeFederationTsConfig(tree, {
    projectRoot,
    projectSourceRoot,
    appTsConfig,
  });
}
