import type { Rule, Tree } from "@angular-devkit/schematics";
import { getWorkspaceFileName } from "../init/schematic.js";
import {
  federationTsConfigPath,
  writeFederationTsConfig,
} from "../init/steps/generate-federation-tsconfig.js";

import * as path from "path";

const NF_PACKAGE = "@angular-architects/native-federation";
// Temporary package used during the Angular 22 RC window; folded back here.
const BETA_PACKAGE = "@angular-architects/native-federation-v4";
const NF_BUILDER = `${NF_PACKAGE}:build`;
const BETA_BUILDER = `${BETA_PACKAGE}:build`;

// `ng update` migration for v22: brings every project onto the ESM standard and onto its own
// federation tsconfig. Every step re-runs safely, so the collection entry can be bumped to a
// later version to reach projects that already ran an earlier one.
export default function update22(): Rule {
  return async function (tree: Tree) {
    const workspaceFileName = getWorkspaceFileName(tree);
    const workspace = JSON.parse(
      tree.read(workspaceFileName)?.toString("utf8") ?? "{}",
    );

    normalizeBuilderReferences(tree, workspace, workspaceFileName);
    generateFederationTsConfigs(tree, workspace, workspaceFileName);
    migrateFederationConfigs(tree, workspace);
    normalizeMainTsImports(tree, workspace);
  };
}

/**
 * Give every federated project its own tsconfig.federation.json. Without one the builder
 * compiles the federation artifacts against the Angular target's tsconfig — the whole app,
 * for every build — and would have to rewrite that file to add the exposes to its program.
 */
function generateFederationTsConfigs(
  tree: Tree,
  workspace: any,
  workspaceFileName: string,
): void {
  let modified = false;

  for (const projectName of Object.keys(workspace.projects ?? {})) {
    const project = workspace.projects[projectName];
    const architect = project?.architect ?? {};

    const targets = Object.values(architect).filter(
      (target: any) =>
        target?.builder === NF_BUILDER && !target?.options?.tsConfig,
    ) as { options?: Record<string, unknown> }[];

    if (targets.length === 0) {
      continue;
    }

    const projectRoot: string = (project.root ?? "").replace(/\\/g, "/");
    const federationTsConfig = federationTsConfigPath(projectRoot);

    if (!tree.exists(federationTsConfig)) {
      // `esbuild` is where the init schematic parked the original build target.
      const original = architect.esbuild ?? architect.build;
      const appTsConfig = original?.options?.tsConfig;

      if (!appTsConfig) {
        console.warn(
          `Skipping ${projectName}: its build target has no tsConfig, so ` +
            `${federationTsConfig} cannot be generated.`,
        );
        continue;
      }

      const projectSourceRoot: string = (
        project.sourceRoot ?? path.join(projectRoot, "src")
      ).replace(/\\/g, "/");

      writeFederationTsConfig(tree, {
        projectRoot,
        projectSourceRoot,
        appTsConfig,
        // The exposes live in federation.config.mjs, which is not ours to parse; main.ts
        // keeps the program non-empty until the first build fills in the real entries.
        entryPoints: [
          original.options.browser ??
            original.options.main ??
            path.join(projectSourceRoot, "main.ts"),
        ],
      });

      console.log(`Generated ${federationTsConfig}`);
    }

    for (const target of targets) {
      target.options ??= {};
      target.options.tsConfig = federationTsConfig;
    }

    modified = true;
  }

  if (modified) {
    tree.overwrite(workspaceFileName, JSON.stringify(workspace, null, "\t"));
  }
}

// Rename the beta builder back and ensure NF targets carry entryPoints/projectName.
function normalizeBuilderReferences(
  tree: Tree,
  workspace: any,
  workspaceFileName: string,
): void {
  let modified = false;

  for (const projectName of Object.keys(workspace.projects ?? {})) {
    const project = workspace.projects[projectName];
    const architect = project?.architect ?? {};
    const sourceRoot = (project?.sourceRoot ?? "").replace(/\\/g, "/");

    for (const targetName of Object.keys(architect)) {
      const target = architect[targetName];

      if (target?.builder === BETA_BUILDER) {
        target.builder = NF_BUILDER;
        modified = true;
        console.log(
          `Updated builder for "${projectName}:${targetName}" to ${NF_BUILDER}`,
        );
      }

      if (target?.builder === NF_BUILDER && !target?.options?.entryPoints) {
        target.options ??= {};
        target.options.entryPoints = [path.join(sourceRoot, "main.ts")];
        if (!target.options.projectName) {
          target.options.projectName = projectName;
        }
        modified = true;
      }
    }
  }

  if (modified) {
    tree.overwrite(workspaceFileName, JSON.stringify(workspace, null, "\t"));
  }
}

// Convert federation.config.js (CJS) to federation.config.mjs (ESM); .mjs configs
// only get their package references normalized.
function migrateFederationConfigs(tree: Tree, workspace: any): void {
  for (const { projectRoot } of resolveProjects(workspace)) {
    const jsConfigPath = path.join(projectRoot, "federation.config.js");
    const mjsConfigPath = path.join(projectRoot, "federation.config.mjs");

    if (!tree.exists(jsConfigPath) && tree.exists(mjsConfigPath)) {
      const content = tree.readText(mjsConfigPath);
      const normalized = normalizePackageReferences(content);
      if (normalized !== content) {
        tree.overwrite(mjsConfigPath, normalized);
        console.log(`Normalized package references in ${mjsConfigPath}`);
      }
      continue;
    }

    if (!tree.exists(jsConfigPath)) {
      continue;
    }

    let content = tree.readText(jsConfigPath);
    const originalContent = content;

    // const { foo } = require('...') → import { foo } from '...'
    const requireRegex =
      /const\s+(\{[^}]+\})\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g;
    const imports: string[] = [];
    content = content.replace(
      requireRegex,
      (_match, bindings: string, modulePath: string) => {
        imports.push(`import ${bindings} from '${modulePath}';`);
        return "";
      },
    );

    if (imports.length > 0) {
      content = imports.join("\n") + "\n" + content.trimStart();
    }

    content = content.replace(/module\.exports\s*=\s*/, "export default ");
    content = normalizePackageReferences(content);

    if (content !== originalContent || imports.length > 0) {
      tree.delete(jsConfigPath);
      tree.create(mjsConfigPath, content);
      console.log(
        `Migrated ${jsConfigPath} to ESM (renamed to ${mjsConfigPath})`,
      );
    }
  }
}

// Rewrite beta `-v4` imports in main.ts back to the canonical package.
function normalizeMainTsImports(tree: Tree, workspace: any): void {
  for (const { projectConfig } of resolveProjects(workspace)) {
    const main =
      projectConfig?.architect?.build?.options?.browser ??
      projectConfig?.architect?.build?.options?.main ??
      projectConfig?.architect?.esbuild?.options?.browser ??
      projectConfig?.architect?.esbuild?.options?.main;

    if (!main || !tree.exists(main)) {
      continue;
    }

    const content = tree.readText(main);
    const normalized = normalizePackageReferences(content);

    if (normalized !== content) {
      tree.overwrite(main, normalized);
      console.log(`Normalized native-federation import in ${main}`);
    }
  }
}

// Rewrite every `-v4` specifier (bare + subpaths) back to the canonical package.
function normalizePackageReferences(content: string): string {
  return content.replace(
    new RegExp(escapeRegExp(BETA_PACKAGE), "g"),
    NF_PACKAGE,
  );
}

function resolveProjects(
  workspace: any,
): Array<{ projectName: string; projectRoot: string; projectConfig: any }> {
  return Object.keys(workspace.projects ?? {}).map((projectName) => {
    const projectConfig = workspace.projects[projectName];
    return {
      projectName,
      projectRoot: projectConfig.root?.replace(/\\/g, "/") ?? "",
      projectConfig,
    };
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
