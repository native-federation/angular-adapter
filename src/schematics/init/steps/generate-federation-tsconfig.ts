import type { Tree } from '@angular-devkit/schematics';
import type { NormalizedOptions } from './normalize-options.js';
import * as path from 'path';

const NF_BUILDER = '@angular-architects/native-federation:build';

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
  /** Workspace-relative entry points seeding the program. */
  entryPoints: string[];
}

/**
 * Writes the tsconfig the federation build compiles against. It covers the exposes and shared
 * mappings rather than the app entry, so `files` is a plain list of entry points that the
 * builder rewrites per build (see tools/esbuild/update-federation-tsconfig.ts) and `include`
 * only picks up ambient declarations. It extends the app tsconfig because it also drives
 * esbuild's module resolution and so needs its paths.
 *
 * Both `extends` and `files` have to stay present: TypeScript reports an empty `files` list
 * (TS18002) unless the config also extends another one.
 */
export function writeFederationTsConfig(tree: Tree, options: FederationTsConfigOptions): string {
  const { projectRoot, projectSourceRoot, appTsConfig, entryPoints } = options;

  const federationTsConfig = federationTsConfigPath(projectRoot);

  const extendsPath = toPosix(path.relative(projectRoot, appTsConfig));
  const sourceDir = toPosix(path.relative(projectRoot, projectSourceRoot));

  tree.create(
    federationTsConfig,
    JSON.stringify(
      {
        extends: extendsPath.startsWith('.') ? extendsPath : `./${extendsPath}`,
        files: entryPoints.map(entry => toPosix(path.relative(projectRoot, entry))),
        include: [`${sourceDir}/**/*.d.ts`],
      },
      null,
      2
    )
  );

  return federationTsConfig;
}

export function generateFederationTsConfig(
  tree: Tree,
  options: NormalizedOptions,
  entryPoints: string[]
): string {
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
    entryPoints,
  });
}
