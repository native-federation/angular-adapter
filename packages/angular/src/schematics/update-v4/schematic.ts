import type { Rule, Tree } from '@angular-devkit/schematics';
import type { UpdateV4Schema } from './schema.js';

import { getWorkspaceFileName } from '../init/schematic.js';

import * as path from 'path';

const V3_PACKAGE = '@angular-architects/native-federation';
const V4_PACKAGE = '@angular-architects/native-federation-v4';
const V3_BUILDER = `${V3_PACKAGE}:build`;
const V4_BUILDER = `${V4_PACKAGE}:build`;

export default function updateV4(options: UpdateV4Schema): Rule {
  return async function (tree: Tree) {
    const workspaceFileName = getWorkspaceFileName(tree);
    const workspace = JSON.parse(tree.read(workspaceFileName)?.toString('utf8') ?? '{}');

    updateBuilderReferences(tree, workspace, workspaceFileName);
    migrateFederationConfigs(tree, workspace, options);
    migrateMainTs(tree, workspace, options);
  };
}

/**
 * Step 2: Update all builder references in angular.json / workspace.json
 * from @angular-architects/native-federation-v4:build to @angular-architects/native-federation-v4:build
 */
function updateBuilderReferences(tree: Tree, workspace: any, workspaceFileName: string): void {
  let modified = false;

  for (const projectName of Object.keys(workspace.projects ?? {})) {
    const project = workspace.projects[projectName];
    const architect = project?.architect ?? {};
    const sourceRoot = (project?.sourceRoot ?? '').replace(/\\/g, '/');

    for (const targetName of Object.keys(architect)) {
      const target = architect[targetName];
      if (target?.builder === V3_BUILDER) {
        target.builder = V4_BUILDER;
        modified = true;
        console.log(`Updated builder for "${projectName}:${targetName}" to ${V4_BUILDER}`);
      }

      // Add entryPoints and projectName to NF builder targets if not already set
      if (
        (target?.builder === V3_BUILDER || target?.builder === V4_BUILDER) &&
        !target?.options?.entryPoints
      ) {
        target.options ??= {};
        target.options.entryPoints = [path.join(sourceRoot, 'main.ts')];
        if (!target.options.projectName) {
          target.options.projectName = projectName;
        }
        modified = true;
      }
    }
  }

  if (modified) {
    tree.overwrite(workspaceFileName, JSON.stringify(workspace, null, '\t'));
  }
}

/**
 * Step 3: Migrate federation.config.js files from CJS to ESM and rename to .mjs
 * - require() → import
 * - module.exports = → export default
 * - Update package references from v3 to v4
 * - Rename federation.config.js → federation.config.mjs
 */
function migrateFederationConfigs(tree: Tree, workspace: any, options: UpdateV4Schema): void {
  const projects = resolveProjects(workspace, options);

  for (const { projectRoot } of projects) {
    const configPath = path.join(projectRoot, 'federation.config.js');
    const mjsConfigPath = path.join(projectRoot, 'federation.config.mjs');
    if (!tree.exists(configPath)) {
      continue;
    }

    let content = tree.readText(configPath);
    const originalContent = content;

    // Convert CJS require to ESM import
    // Matches: const { foo, bar } = require('...');
    const requireRegex = /const\s+(\{[^}]+\})\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g;
    const imports: string[] = [];
    content = content.replace(requireRegex, (_match, bindings: string, modulePath: string) => {
      const updatedPath = modulePath.replace(V3_PACKAGE, V4_PACKAGE);
      imports.push(`import ${bindings} from '${updatedPath}';`);
      return ''; // Remove the require line; import will be prepended
    });

    // Prepend collected imports at the top (after removing old requires)
    if (imports.length > 0) {
      content = imports.join('\n') + '\n' + content.trimStart();
    }

    // Convert module.exports = to export default
    content = content.replace(/module\.exports\s*=\s*/, 'export default ');

    // Also update any remaining inline @angular-architects/native-federation references
    // (e.g. in comments or other import paths) to the v4 package
    content = content.replace(
      new RegExp(escapeRegExp(V3_PACKAGE + '/config'), 'g'),
      V4_PACKAGE + '/config'
    );
    content = content.replace(new RegExp(escapeRegExp(V3_PACKAGE) + '(?!/)', 'g'), V4_PACKAGE);

    if (content !== originalContent) {
      tree.delete(configPath);
      tree.create(mjsConfigPath, content);
      console.log(`Migrated ${configPath} to ESM (renamed to ${mjsConfigPath})`);
    }
  }
}

/**
 * Step 4: Update main.ts imports from @angular-architects/native-federation
 * to @angular-architects/native-federation-v4
 */
function migrateMainTs(tree: Tree, workspace: any, options: UpdateV4Schema): void {
  const projects = resolveProjects(workspace, options);

  for (const { projectConfig } of projects) {
    const main =
      projectConfig?.architect?.build?.options?.browser ??
      projectConfig?.architect?.build?.options?.main ??
      projectConfig?.architect?.esbuild?.options?.browser ??
      projectConfig?.architect?.esbuild?.options?.main;

    if (!main || !tree.exists(main)) {
      continue;
    }

    let content = tree.readText(main);
    const originalContent = content;

    content = content.replace(
      new RegExp(`(['"])${escapeRegExp(V3_PACKAGE)}\\1`, 'g'),
      `$1${V4_PACKAGE}$1`
    );

    if (content !== originalContent) {
      tree.overwrite(main, content);
      console.log(`Updated initFederation import in ${main}`);
    }
  }
}

function resolveProjects(
  workspace: any,
  options: UpdateV4Schema
): Array<{ projectName: string; projectRoot: string; projectConfig: any }> {
  const projects: Array<{ projectName: string; projectRoot: string; projectConfig: any }> = [];

  if (options.project) {
    const projectConfig = workspace.projects?.[options.project];
    if (projectConfig) {
      projects.push({
        projectName: options.project,
        projectRoot: projectConfig.root?.replace(/\\/g, '/') ?? '',
        projectConfig,
      });
    }
  } else {
    // Migrate all projects
    for (const projectName of Object.keys(workspace.projects ?? {})) {
      const projectConfig = workspace.projects[projectName];
      projects.push({
        projectName,
        projectRoot: projectConfig.root?.replace(/\\/g, '/') ?? '',
        projectConfig,
      });
    }
  }

  return projects;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
