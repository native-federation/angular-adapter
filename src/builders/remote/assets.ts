// Portions adapted from angular/angular-cli (packages/angular/build/src/utils/), which @angular/build's
// exports map doesn't expose (#153). Copyright Google LLC. MIT License: https://angular.dev/license

import * as fs from 'fs';
import * as path from 'path';
import { glob, isDynamicPattern } from 'tinyglobby';

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

// upstream: angular/angular-cli packages/angular/build/src/utils/path.ts @ bdda8bbf1b
function isSubDirectory(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(parent, child));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// upstream: angular/angular-cli packages/angular/build/src/utils/normalize-asset-patterns.ts @ bdda8bbf1b
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

// upstream: angular/angular-cli packages/angular/build/src/utils/resolve-assets.ts @ bdda8bbf1b
const DEFAULT_ASSET_IGNORE_FILES: ReadonlySet<string> = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db']);
const DEFAULT_ASSET_IGNORE_PATTERNS: readonly string[] = Array.from(
  DEFAULT_ASSET_IGNORE_FILES,
  file => `**/${file}`
);

// upstream: angular/angular-cli packages/angular/build/src/utils/resolve-assets.ts @ bdda8bbf1b
function normalizeIgnorePattern(pattern: string): string[] {
  if (!pattern) {
    return [];
  }

  const posixNormalized = path.posix.normalize(pattern);
  const normalized =
    posixNormalized.length > 1 && posixNormalized.endsWith('/')
      ? posixNormalized.slice(0, -1)
      : posixNormalized;

  if (!normalized.endsWith('*')) {
    return [`${normalized}/**`];
  }

  if (normalized === '**' || normalized.endsWith('/**')) {
    return [normalized];
  }

  return [normalized, `${normalized}/**`];
}

// upstream: angular/angular-cli packages/angular/build/src/utils/resolve-assets.ts @ bdda8bbf1b
function normalizeAssetIgnorePatterns(ignore?: readonly string[]): string[] {
  if (!ignore?.length) {
    return [...DEFAULT_ASSET_IGNORE_PATTERNS];
  }

  return [...DEFAULT_ASSET_IGNORE_PATTERNS, ...ignore.flatMap(normalizeIgnorePattern)];
}

// upstream: angular/angular-cli packages/angular/build/src/utils/resolve-assets.ts @ bdda8bbf1b
async function resolveAssetEntry(
  entry: NormalizedAssetEntry,
  workspaceRoot: string
): Promise<{ source: string; destination: string }[]> {
  if (!entry.glob || entry.glob.endsWith('/')) {
    return [];
  }

  const cwd = path.resolve(workspaceRoot, entry.input);

  if (!entry.ignore?.length && !isDynamicPattern(entry.glob)) {
    const src = path.join(cwd, entry.glob);
    if (isSubDirectory(cwd, src)) {
      if (DEFAULT_ASSET_IGNORE_FILES.has(path.basename(src))) {
        return [];
      }

      try {
        const stats = await (entry.followSymlinks ? fs.promises.stat(src) : fs.promises.lstat(src));
        if (stats.isFile()) {
          const filePath = entry.flatten ? path.basename(src) : path.relative(cwd, src);

          return [{ source: src, destination: path.join(entry.output, filePath) }];
        }

        return [];
      } catch {
        return [];
      }
    }
  }

  const files = await glob(entry.glob, {
    cwd,
    dot: true,
    expandDirectories: false,
    ignore: normalizeAssetIgnorePatterns(entry.ignore),
    followSymbolicLinks: entry.followSymlinks ?? false,
  });

  return files.map(file => {
    const destination = path.join(entry.output, entry.flatten ? path.basename(file) : file);
    if (destination === '..' || destination.startsWith(`..${path.sep}`)) {
      throw new Error('An asset cannot be written to a location outside of the output path.');
    }

    return { source: path.join(cwd, file), destination };
  });
}

// Deviation: sequential instead of Angular's bounded `mapConcurrent`; a remote has few asset entries.
async function resolveAssets(
  entries: NormalizedAssetEntry[],
  workspaceRoot: string
): Promise<{ source: string; destination: string }[]> {
  const resolved: { source: string; destination: string }[] = [];
  for (const entry of entries) {
    resolved.push(...(await resolveAssetEntry(entry, workspaceRoot)));
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
