import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as esbuild from 'esbuild';
import type { EntryPoint } from '@softarc/native-federation';

import { entriesByOutputName } from './output-entries.js';

// Runs real esbuild with the options angular-bundler.ts uses for exposed modules (entry names,
// splitting, absWorkingDir, write: false), so the metafile shape is esbuild's own.
let ws: string;

function writeSources(files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(ws, name)), { recursive: true });
    fs.writeFileSync(path.join(ws, name), text);
  }
}

async function build(
  entryPoints: EntryPoint[],
  { hash = true, ...options }: { hash?: boolean } & esbuild.BuildOptions = {}
) {
  const result = await esbuild.build({
    entryPoints: entryPoints.map(ep => ({
      in: path.resolve(ws, ep.fileName),
      out: path.parse(ep.outName).name,
    })),
    outdir: path.join(ws, 'dist'),
    absWorkingDir: ws,
    entryNames: hash ? '[name]-[hash]' : '[name]',
    write: false,
    metafile: true,
    bundle: true,
    splitting: true,
    format: 'esm',
    logLevel: 'silent',
    ...options,
  });
  return { result, entries: entriesByOutputName(result.metafile, entryPoints, ws) };
}

function textOf(result: esbuild.BuildResult, fileName: string) {
  return result.outputFiles!.find(f => path.basename(f.path) === fileName)!.text;
}

function outputFor(entries: Map<string, string>, outName: string) {
  return [...entries].find(([, entry]) => entry === outName)?.[0];
}

beforeEach(() => {
  // realpath: macOS hands out /var/... tmp dirs that are symlinks to /private/var/...
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-output-entries-')));
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('entriesByOutputName', () => {
  // core#193: core cut `chunk-<hash>.js` at its last `-` and published the shared chunk as `./chunk`.
  it('maps an exposed `chunk` to its entry, not to the split chunk', async () => {
    writeSources({
      'src/shared.ts': 'export const shared = () => "shared";',
      'src/chunk.ts': 'import { shared } from "./shared"; export const chunk = shared();',
      'src/other.ts': 'import { shared } from "./shared"; export const other = shared();',
    });

    const { result, entries } = await build([
      { fileName: 'src/chunk.ts', outName: 'chunk.js' },
      { fileName: 'src/other.ts', outName: 'other.js' },
    ]);

    // Sanity check: the fixture really produces a split chunk next to the `chunk` entry.
    const chunks = result.outputFiles!.filter(f => path.basename(f.path).startsWith('chunk-'));
    expect(chunks).toHaveLength(2);
    expect(entries.size).toBe(2);
    expect(textOf(result, outputFor(entries, 'chunk.js')!)).toContain('// src/chunk.ts');
    expect(textOf(result, outputFor(entries, 'other.js')!)).toContain('// src/other.ts');
  });

  it('sets the entry on the script only, not on the stylesheet it imports', async () => {
    writeSources({
      'src/styled.ts': 'import "./styled.css"; export const styled = 1;',
      'src/styled.css': '.a { color: red; }',
    });

    const { entries } = await build([{ fileName: 'src/styled.ts', outName: 'styled.js' }]);

    expect([...entries.keys()]).toEqual([expect.stringMatching(/^styled-[A-Z2-7]{8}\.js$/)]);
  });

  it.each([true, false])('tells apart one file exposed under two keys (hash: %s)', async hash => {
    writeSources({ 'src/cmp.ts': 'export const cmp = 1;' });

    // Core flattens `./a/Cmp` + `./b/Cmp` to `Cmp.js` + `Cmp_2.js`.
    const { entries } = await build(
      [
        { fileName: 'src/cmp.ts', outName: 'Cmp.js' },
        { fileName: 'src/cmp.ts', outName: 'Cmp_2.js' },
      ],
      { hash }
    );

    expect(outputFor(entries, 'Cmp.js')).toMatch(hash ? /^Cmp-[A-Z2-7]{8}\.js$/ : /^Cmp\.js$/);
    expect(outputFor(entries, 'Cmp_2.js')).toMatch(hash ? /^Cmp_2-[A-Z2-7]{8}\.js$/ : /^Cmp_2\.js$/);
  });

  // `a-b-<hash>.js` also starts with `a-`.
  it('tells apart out names where one is a dash-prefix of the other', async () => {
    writeSources({ 'src/x.ts': 'export const x = 1;' });

    const { entries } = await build([
      { fileName: 'src/x.ts', outName: 'a.js' },
      { fileName: 'src/x.ts', outName: 'a-b.js' },
    ]);

    expect(outputFor(entries, 'a.js')).toMatch(/^a-[A-Z2-7]{8}\.js$/);
    expect(outputFor(entries, 'a-b.js')).toMatch(/^a-b-[A-Z2-7]{8}\.js$/);
  });

  // Core hands shared mappings over absolute.
  it('accepts entry points handed over absolute', async () => {
    writeSources({ 'libs/ui/index.ts': 'export const ui = 1;' });

    const { entries } = await build([
      { fileName: path.join(ws, 'libs/ui/index.ts'), outName: 'ui.js' },
    ]);

    expect([...entries.values()]).toEqual(['ui.js']);
  });

  // esbuild records the real path of an entry reached through a symlink (e.g. a linked lib).
  it.each([false, true])(
    'matches an entry reached through a symlink (preserveSymlinks: %s)',
    async preserveSymlinks => {
      writeSources({ 'linked-real/lnk.ts': 'export const linked = 1;' });
      fs.symlinkSync(path.join(ws, 'linked-real'), path.join(ws, 'linked'), 'dir');

      const { entries } = await build([{ fileName: 'linked/lnk.ts', outName: 'linked.js' }], {
        preserveSymlinks,
      });

      expect([...entries.values()]).toEqual(['linked.js']);
    }
  );

  // A lazy chunk is named after its file and carries an entryPoint, like an entry does.
  it('does not let a lazily imported module claim an entry with the same name', async () => {
    writeSources({
      'src/lazy/other.ts': 'export const lazy = 1;',
      'src/main.ts': 'export const load = () => import("./lazy/other");',
      'src/other.ts': 'export const other = 1;',
    });

    const { result, entries } = await build([
      { fileName: 'src/main.ts', outName: 'main.js' },
      { fileName: 'src/other.ts', outName: 'other.js' },
    ]);

    const others = result.outputFiles!.filter(f => path.basename(f.path).startsWith('other-'));
    expect(others).toHaveLength(2);
    expect(textOf(result, outputFor(entries, 'other.js')!)).toContain('// src/other.ts');
  });

  // Core keys every result by `entry` once one sets it, so the unmatched one would be lost.
  it('sets no entry at all when one entry point cannot be matched', async () => {
    writeSources({ 'src/a.ts': 'export const a = 1;' });
    const virtualEntry: esbuild.Plugin = {
      name: 'virtual-entry',
      setup(build) {
        build.onResolve({ filter: /virtual\.ts$/ }, args => ({
          path: args.path,
          namespace: 'virtual',
        }));
        build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
          contents: 'export const v = 1;',
        }));
      },
    };

    const { entries } = await build(
      [
        { fileName: 'src/a.ts', outName: 'a.js' },
        { fileName: 'src/virtual.ts', outName: 'virtual.js' },
      ],
      { plugins: [virtualEntry] }
    );

    expect(entries.size).toBe(0);
  });

  // Shared bundles are built without a metafile.
  it('sets no entry without a metafile', () => {
    const entryPoints = [{ fileName: 'a.ts', outName: 'a.js' }];

    expect(entriesByOutputName(undefined, entryPoints, ws).size).toBe(0);
  });
});
