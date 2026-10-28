import * as fs from 'fs';
import * as path from 'path';
import type * as esbuild from 'esbuild';
import type { EntryPoint } from '@softarc/native-federation';

// `[name]` or `[name]-[hash]`; esbuild hashes are base32 and contain no `-`.
const SCRIPT_SUFFIX = /(-[A-Z2-7]{8})?\.js$/;

export function entriesByOutputName(
  metafile: esbuild.Metafile | undefined,
  entryPoints: EntryPoint[],
  workspaceRoot: string
): Map<string, string> {
  const entries = new Map<string, string>();
  if (!metafile) return entries;

  // esbuild reports an entry reached through a symlink by its real path.
  const source = (file: string) => realpath(path.resolve(workspaceRoot, file));
  const byOutName = new Map(entryPoints.map(ep => [path.parse(ep.outName).name, ep]));

  for (const [outPath, output] of Object.entries(metafile.outputs)) {
    if (!output.entryPoint) continue;
    const fileName = path.basename(outPath);
    const ep = byOutName.get(fileName.replace(SCRIPT_SUFFIX, ''));
    // A lazily imported module carries an entryPoint too and may share an entry's name.
    if (ep && source(ep.fileName) === source(output.entryPoint)) {
      entries.set(fileName, ep.outName);
    }
  }

  // Once one result sets `entry`, core stops matching by file name, so a partial map would lose
  // the unmatched entries; an empty one keeps core's own name matching.
  const claimed = new Set(entries.values());
  return claimed.size === entryPoints.length && entries.size === claimed.size ? entries : new Map();
}

function realpath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    // Plugin namespaces such as `virtual:x` are no file.
    return file;
  }
}
