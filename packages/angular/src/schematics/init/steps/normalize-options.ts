import type { Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import * as path from 'path';

export type NormalizedOptions = {
  polyfills: string;
  projectName: string;
  projectRoot: string;
  projectSourceRoot: string;
  manifestPath: string;
  manifestRelPath: string;
  projectConfig: any;
  main: string;
  port: number;
};

export type PackageJson = {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

export function getWorkspaceFileName(tree: Tree): string {
  if (tree.exists('angular.json')) {
    return 'angular.json';
  }
  if (tree.exists('workspace.json')) {
    return 'workspace.json';
  }
  throw new Error(
    "angular.json or workspace.json expected! Did you call this in your project's root?"
  );
}

export function normalizeOptions(
  options: NfSchematicSchema,
  workspace: any,
  tree: Tree
): NormalizedOptions {
  if (!options.project) {
    options.project = workspace.defaultProject;
  }

  const projects = Object.keys(workspace.projects);

  if (!options.project && projects.length === 0) {
    throw new Error(`No default project found. Please specifiy a project name!`);
  }

  if (!options.project) {
    console.log('Using first configured project as default project: ' + projects[0]);
    options.project = projects[0]!;
  }

  const projectName = options.project;
  const projectConfig = workspace.projects[projectName];

  if (!projectConfig) {
    throw new Error(`Project ${projectName} not found in angular.json.`);
  }

  const projectRoot: string = projectConfig.root?.replace(/\\/g, '/');
  const projectSourceRoot: string = projectConfig.sourceRoot?.replace(/\\/g, '/');

  const publicPath = path.join(projectRoot, 'public').replace(/\\/g, '/');

  let manifestPath = path.join(publicPath, 'federation.manifest.json').replace(/\\/g, '/');

  let manifestRelPath = 'federation.manifest.json';

  const hasPublicFolder = tree
    .getDir(projectRoot)
    .subdirs.map(p => String(p))
    .includes('public');

  if (!hasPublicFolder) {
    manifestPath = path
      .join(projectRoot, 'src/assets/federation.manifest.json')
      .replace(/\\/g, '/');

    manifestRelPath = 'assets/federation.manifest.json';
  }

  const main =
    projectConfig.architect.build.options.main ||
    projectConfig.architect.build.options.browser ||
    projectConfig.architect.esbuild.options.main || // fallback, if esbuild is already set
    projectConfig.architect.esbuild.options.browser;

  if (!projectConfig.architect.build.options.polyfills) {
    projectConfig.architect.build.options.polyfills = [];
  }

  if (typeof projectConfig.architect.build.options.polyfills === 'string') {
    projectConfig.architect.build.options.polyfills = [
      projectConfig.architect.build.options.polyfills,
    ];
  }

  const polyfills = projectConfig.architect.build.options.polyfills;
  return {
    polyfills,
    projectName,
    projectRoot,
    projectSourceRoot,
    manifestPath,
    manifestRelPath,
    projectConfig,
    main,
    port: +(options.port || 4200),
  };
}

export function isSsrProject(normalized: NormalizedOptions) {
  return !!normalized.projectConfig?.architect?.build.options?.ssr;
}

export function getSsrFilePath(normalized: NormalizedOptions): string {
  return normalized.projectConfig.architect.build.options.ssr.entry;
}
