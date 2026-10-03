import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as esbuild from 'esbuild';
import type { BuildResult, OutputFile, PluginBuild } from 'esbuild';

import { createSourcemapIgnorelistPlugin } from './sourcemap-ignorelist-plugin.js';

const WS = path.resolve('/ws');
// Where core writes shared bundles: inside the federation cache, below node_modules.
const CACHE_DIR = path.join(WS, 'node_modules/.cache/native-federation/app/browser-shared');
const DIST_DIR = path.join(WS, 'dist/app/browser');

function outputFile(filePath: string, text: string): OutputFile {
  return { path: filePath, contents: Buffer.from(text, 'utf-8') } as OutputFile;
}

function runOnEnd(outputFiles: OutputFile[], sourcemap: esbuild.BuildOptions['sourcemap'] = true) {
  let onEnd: ((result: BuildResult) => void) | undefined;
  createSourcemapIgnorelistPlugin().setup({
    initialOptions: { sourcemap },
    onEnd: (cb: (result: BuildResult) => void) => (onEnd = cb),
  } as unknown as PluginBuild);

  onEnd?.({ outputFiles } as BuildResult);
  return outputFiles.map(f => JSON.parse(Buffer.from(f.contents).toString('utf-8')));
}

function map(sources: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 3, ...extra, sources, mappings: '' });
}

describe('createSourcemapIgnorelistPlugin', () => {
  // The case from #149: no `node_modules/` in the source strings, only after resolving them.
  it('ignores cache-relative sources of shared bundles', () => {
    const [result] = runOnEnd([
      outputFile(
        path.join(CACHE_DIR, '_angular_core.js.map'),
        map([
          '../../../../@angular/core/fesm2022/core.mjs',
          '../../../../@angular/core/fesm2022/primitives/signals.mjs',
        ])
      ),
    ]);

    expect(result.x_google_ignoreList).toEqual([0, 1]);
  });

  it('ignores only the node_modules sources of a mapping or exposed bundle', () => {
    const [result] = runOnEnd([
      outputFile(
        path.join(DIST_DIR, 'my-lib.js.map'),
        map(['../../../libs/my-lib/src/index.ts', '../../../node_modules/tslib/tslib.es6.mjs'])
      ),
    ]);

    expect(result.x_google_ignoreList).toEqual([1]);
  });

  // Same as Angular: a linked package outside the workspace is usually the code being debugged.
  it('keeps sources outside the workspace visible when not under node_modules', () => {
    const [result] = runOnEnd([
      outputFile(
        path.join(DIST_DIR, 'my-lib.js.map'),
        map(['../../../../linked-lib/src/index.ts'])
      ),
    ]);

    expect(result.x_google_ignoreList).toBeUndefined();
  });

  it('does not treat a directory merely ending in node_modules as one', () => {
    const [result] = runOnEnd([
      outputFile(path.join(DIST_DIR, 'a.js.map'), map(['../../../not_node_modules/x.js'])),
    ]);

    expect(result.x_google_ignoreList).toBeUndefined();
  });

  // Angular 21.2's plugin has no fast path and no existing-ignore-list check, so main's specs for
  // those are not ported here.

  it('only touches .map files', () => {
    const js = outputFile(path.join(CACHE_DIR, 'a.js'), map(['../../../../rxjs/index.js']));
    const before = Buffer.from(js.contents);

    runOnEnd([js]);

    expect(Buffer.from(js.contents).equals(before)).toBe(true);
  });

  it('does nothing without source maps', () => {
    const file = outputFile(path.join(CACHE_DIR, 'a.js.map'), map(['../../../../rxjs/index.js']));

    const [result] = runOnEnd([file], false);

    expect(result.x_google_ignoreList).toBeUndefined();
  });

  describe('with esbuild', () => {
    let ws: string;

    beforeEach(() => {
      ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-ignorelist-'));
      fs.mkdirSync(path.join(ws, 'node_modules/dep'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'node_modules/dep/index.js'), 'export const dep = 1;\n');
      fs.writeFileSync(
        path.join(ws, 'entry.js'),
        "import { dep } from './node_modules/dep/index.js';\nexport const value = dep;\n"
      );
    });

    afterEach(() => {
      fs.rmSync(ws, { recursive: true, force: true });
    });

    it('marks node_modules sources of a bundle emitted into the federation cache', async () => {
      const result = await esbuild.build({
        entryPoints: [path.join(ws, 'entry.js')],
        outdir: path.join(ws, 'node_modules/.cache/native-federation/app/browser-shared'),
        absWorkingDir: ws,
        bundle: true,
        format: 'esm',
        write: false,
        sourcemap: true,
        logLevel: 'silent',
        plugins: [createSourcemapIgnorelistPlugin()],
      });

      const mapFile = result.outputFiles.find(f => f.path.endsWith('.map'))!;
      const sourceMap = JSON.parse(mapFile.text);

      // The raw strings carry no node_modules segment; this is what upstream's plugin misses.
      expect(sourceMap.sources).toEqual(['../../../../dep/index.js', '../../../../../entry.js']);
      expect(sourceMap.x_google_ignoreList).toEqual([0]);
    });
  });
});
