import type { Tree } from '@angular-devkit/schematics';
import type { NormalizedOptions } from './normalize-options.js';
import * as path from 'path';

const NF_BUILDER = '@angular-architects/native-federation:build';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

// The federation build compiles exposes and shared mappings, not the app entry, so it
// starts from an empty program that the builder fills in per build. It extends the app
// tsconfig because it also drives esbuild's module resolution and so needs its paths.
export function generateFederationTsConfig(tree: Tree, options: NormalizedOptions): string {
  const { projectConfig, projectRoot, projectSourceRoot } = options;

  const federationTsConfig = toPosix(path.join(projectRoot, 'tsconfig.federation.json'));

  if (projectConfig.architect.build.builder === NF_BUILDER || tree.exists(federationTsConfig)) {
    return federationTsConfig;
  }

  const appTsConfig =
    projectConfig.architect.build.options?.tsConfig ??
    projectConfig.architect.esbuild?.options?.tsConfig;

  if (!appTsConfig) {
    throw new Error(`The build target of ${options.projectName} has no tsConfig!`);
  }

  const extendsPath = toPosix(path.relative(projectRoot, appTsConfig));
  const sourceDir = toPosix(path.relative(projectRoot, projectSourceRoot));

  tree.create(
    federationTsConfig,
    JSON.stringify(
      {
        extends: extendsPath.startsWith('.') ? extendsPath : `./${extendsPath}`,
        files: [],
        include: [`${sourceDir}/**/*.d.ts`],
      },
      null,
      2
    )
  );

  return federationTsConfig;
}
