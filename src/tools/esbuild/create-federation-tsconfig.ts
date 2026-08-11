import type { EntryPoint } from '@softarc/native-federation';
import path from 'path';
import fs from 'fs';
import JSON5 from 'json5';
import { isDeepStrictEqual } from 'util';

/**
 * Puts the federation entry points into the federation tsconfig's `files`, so the
 * angular-compiler plugin finds them in the TypeScript program.
 *
 * The two keys are owned by different sides: the schematic writes `extends` and `include`
 * (see schematics/init/steps/generate-federation-tsconfig.ts), this writes `files`. Because
 * `files` is replaced rather than appended to, an expose that was renamed or removed leaves
 * nothing behind.
 *
 * Only ever call this for a tsconfig the NF target explicitly points at — it is rewritten
 * as plain JSON, which drops any comments the file had.
 */
export function updateFederationTsConfig(
  workspaceRoot: string,
  tsConfigPath: string,
  entryPoints: EntryPoint[],
  fallbackEntryPoints: string[] = []
): void {
  const fullTsConfigPath = path.join(workspaceRoot, tsConfigPath);
  const tsconfigDir = path.dirname(fullTsConfigPath);

  // Core hands exposes over workspace-root-relative and shared mappings absolute.
  const toTsConfigRelative = (fileName: string) => {
    const absolute = path.isAbsolute(fileName) ? fileName : path.join(workspaceRoot, fileName);

    return path.relative(tsconfigDir, absolute).replace(/\\/g, '/');
  };

  const resolved = entryPoints.map(ep => toTsConfigRelative(ep.fileName));

  // A host without exposes or shared mappings has no entry points of its own; the app's
  // main.ts keeps the program from being empty.
  const files = [
    ...new Set(resolved.length > 0 ? resolved : fallbackEntryPoints.map(toTsConfigRelative)),
  ];

  if (files.length === 0) {
    return;
  }

  if (!fs.existsSync(fullTsConfigPath)) {
    throw new Error(
      `The federation tsconfig "${tsConfigPath}" does not exist, so the exposed modules and ` +
        `shared mappings cannot be added to the TypeScript program.`
    );
  }

  const tsconfigAsString = fs.readFileSync(fullTsConfigPath, 'utf-8');
  const tsconfig = JSON5.parse(tsconfigAsString);

  tsconfig.files = files;

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
