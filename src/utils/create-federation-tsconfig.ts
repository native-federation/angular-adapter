import type { EntryPoint } from '@softarc/native-federation';
import path from 'path';
import fs from 'fs';
import JSON5 from 'json5';
import { isDeepStrictEqual } from 'util';

/**
 * Updates the federation tsconfig to include optimized mapping entry points.
 * Only modifies the file when there are non-local entry points to add.
 */
export function updateFederationTsConfig(
  workspaceRoot: string,
  tsConfigPath: string,
  entryPoints: EntryPoint[]
): void {
  const fullTsConfigPath = path.join(workspaceRoot, tsConfigPath);
  const tsconfigDir = path.dirname(fullTsConfigPath);

  const filtered = entryPoints
    .filter(ep => !ep.fileName.startsWith('.'))
    .map(ep => path.relative(tsconfigDir, ep.fileName).replace(/\\\\/g, '/'));

  if (filtered.length === 0) {
    return;
  }

  const tsconfigAsString = fs.readFileSync(fullTsConfigPath, 'utf-8');
  const tsconfig = JSON5.parse(tsconfigAsString);

  if (!tsconfig.include) {
    tsconfig.include = [];
  }

  for (const ep of filtered) {
    if (!tsconfig.include.includes(ep)) {
      tsconfig.include.push(ep);
    }
  }

  const content = JSON5.stringify(tsconfig, null, 2);

  if (!doesFileExistAndJsonEqual(fullTsConfigPath, content)) {
    fs.writeFileSync(fullTsConfigPath, JSON.stringify(tsconfig, null, 2));
  }
}

function doesFileExistAndJsonEqual(filePath: string, content: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const currentContent = fs.readFileSync(filePath, 'utf-8');
    const currentJson = JSON5.parse(currentContent);
    const newJson = JSON5.parse(content);

    return isDeepStrictEqual(currentJson, newJson);
  } catch {
    return false;
  }
}
