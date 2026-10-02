// Portions adapted from angular/angular-cli (packages/angular/build/src/utils/), which @angular/build's
// exports map doesn't expose (#153). Copyright Google LLC. MIT License: https://angular.dev/license

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'tinyglobby';

import type { ApplicationBuilderOptions } from '@angular/build';

export type NormalizedAssetEntry = {
  glob: string;
  input: string;
  output: string;
  ignore?: string[];
  followSymlinks?: boolean;
  flatten?: boolean;
};

type AssetPattern = NonNullable<ApplicationBuilderOptions['assets']>[number];

// upstream: angular/angular-cli packages/angular/build/src/utils/path.ts @ 6c6bb21485
function isSubDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(parent, child));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// upstream: angular/angular-cli packages/angular/build/src/utils/normalize-asset-patterns.ts @ 163a03264b
export function normalizeRemoteAssetEntries(
  assets: ApplicationBuilderOptions['assets'] | undefined,
  workspaceRoot: string,
  projectRoot: string,
  projectSourceRoot: string | undefined
): NormalizedAssetEntry[] {
  if (!assets || assets.length === 0) return [];

  const sourceRoot = path.resolve(workspaceRoot, projectSourceRoot || path.join(projectRoot, 'src'));
  const resolvedProjectRoot = path.resolve(workspaceRoot, projectRoot);

  return assets.map(pattern => {
    const entry = normalizeAssetPattern(pattern, workspaceRoot, sourceRoot, resolvedProjectRoot);
    if (entry.output.startsWith('..')) {
      throw new Error('An asset cannot be written to a location outside of the output path.');
    }
    return entry;
  });
}

function normalizeAssetPattern(
  pattern: AssetPattern,
  workspaceRoot: string,
  sourceRoot: string,
  projectRoot: string
): NormalizedAssetEntry {
  if (typeof pattern !== 'string') {
    if (!isSubDirectory(workspaceRoot, pattern.input)) {
      throw new Error(`The ${pattern.input} asset path must be within the workspace root.`);
    }
    return { ...pattern, output: path.join('.', pattern.output ?? '') };
  }

  const assetPath = path.normalize(pattern);
  const resolvedAssetPath = path.resolve(workspaceRoot, assetPath);
  const root = [sourceRoot, projectRoot, workspaceRoot].find(dir =>
    isSubDirectory(dir, resolvedAssetPath)
  );
  if (!root) {
    throw new Error(`The ${pattern} asset path must be within the workspace root.`);
  }

  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(resolvedAssetPath).isDirectory();
  } catch {
    isDirectory = true;
  }

  const input = isDirectory ? assetPath : path.dirname(assetPath);
  return {
    glob: isDirectory ? '**/*' : path.basename(assetPath),
    input,
    output: path.relative(root, path.resolve(workspaceRoot, input)),
  };
}

// upstream: angular/angular-cli packages/angular/build/src/utils/resolve-assets.ts @ a0a6b422cd
const DEFAULT_ASSET_IGNORE = ['.gitkeep', '**/.DS_Store', '**/Thumbs.db'];

async function resolveAssets(
  entries: NormalizedAssetEntry[],
  workspaceRoot: string
): Promise<{ source: string; destination: string }[]> {
  const resolved: { source: string; destination: string }[] = [];
  for (const entry of entries) {
    const cwd = path.resolve(workspaceRoot, entry.input);
    const files = await glob(entry.glob, {
      cwd,
      dot: true,
      ignore: [...DEFAULT_ASSET_IGNORE, ...(entry.ignore ?? [])],
      followSymbolicLinks: entry.followSymlinks ?? false,
    });
    for (const file of files) {
      resolved.push({
        source: path.join(cwd, file),
        destination: path.join(entry.output, entry.flatten ? path.basename(file) : file),
      });
    }
  }
  return resolved;
}

async function writeAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string,
  changed?: Set<string>
): Promise<void> {
  if (entries.length === 0) return;

  const resolved = await resolveAssets(entries, workspaceRoot);

  const createdDirs = new Set<string>();
  for (const { source, destination } of resolved) {
    if (changed && !changed.has(source)) continue;

    const dest = path.join(outputDir, destination);
    const dir = path.dirname(dest);
    if (!createdDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    fs.copyFileSync(source, dest, fs.constants.COPYFILE_FICLONE);
  }
}

export function copyAllAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string
): Promise<void> {
  return writeAssets(entries, outputDir, workspaceRoot);
}

export function copyChangedAssets(
  entries: NormalizedAssetEntry[],
  outputDir: string,
  workspaceRoot: string,
  changedFiles: Iterable<string>
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();

  const changed = new Set<string>();
  for (const file of changedFiles) {
    changed.add(path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file));
  }
  if (changed.size === 0) return Promise.resolve();

  return writeAssets(entries, outputDir, workspaceRoot, changed);
}

export function getAssetWatchDirs(
  entries: NormalizedAssetEntry[],
  workspaceRoot: string
): string[] {
  return entries.map(entry => path.resolve(workspaceRoot, entry.input));
}
