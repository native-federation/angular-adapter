import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import commonjsPlugin from '@chialab/esbuild-plugin-commonjs';

import type { JavaScriptTransformer } from '@angular/build/private';

import { createAngularLinkerPlugin, requiresLinking } from './node-modules-bundler.js';

describe('requiresLinking', () => {
  it('returns true for partially-compiled sources containing a declaration prefix', () => {
    const source = 'export const x = ɵɵngDeclareComponent({ ... });';
    expect(requiresLinking('/node_modules/my-design-system/fesm2022/lib.mjs', source)).toBe(true);
  });

  it('returns false for sources without a declaration prefix', () => {
    expect(requiresLinking('/node_modules/some-lib/index.js', 'export const x = 1;')).toBe(false);
  });

  it('excludes @angular/core even if it contains the declaration prefix', () => {
    const source = 'ɵɵngDeclareClassMetadata(...)';
    expect(requiresLinking('/node_modules/@angular/core/fesm2022/core.mjs', source)).toBe(false);
  });

  it('excludes @angular/compiler even if it contains the declaration prefix', () => {
    const source = 'ɵɵngDeclareComponent(...)';
    expect(requiresLinking('/node_modules/@angular/compiler/fesm2022/compiler.mjs', source)).toBe(
      false
    );
  });

  it('matches @angular paths using either path separator', () => {
    const source = 'ɵɵngDeclareDirective(...)';
    expect(requiresLinking('C:\\node_modules\\@angular\\core\\core.mjs', source)).toBe(false);
  });

  it('does not exclude other @angular packages such as @angular/common', () => {
    const source = 'ɵɵngDeclarePipe(...)';
    expect(requiresLinking('/node_modules/@angular/common/fesm2022/common.mjs', source)).toBe(true);
  });
});

describe('createAngularLinkerPlugin', () => {
  let fixtureDir: string;

  // Mimics quill-delta/dist/Delta.js (5.1.0): plain CJS with named exports, ending in the
  // UMD sniff that @chialab/esbuild-plugin-commonjs misdetects — it wraps the body in an IIFE
  // called with `exports === void 0`, losing every `exports.X =` assignment (issue #83).
  const CJS_WITH_UMD_TAIL = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttributeMap = exports.OpIterator = void 0;
const AttributeMap = { compose: () => 'composed' };
exports.AttributeMap = AttributeMap;
const OpIterator = function () {};
exports.OpIterator = OpIterator;
function Delta() {}
// The real package also hangs the named exports off the default export, which is what makes
// esbuild's native CJS interop resolve them once module.exports is reassigned below.
Delta.AttributeMap = AttributeMap;
Delta.OpIterator = OpIterator;
exports.default = Delta;
if (typeof module === 'object') {
    module.exports = Delta;
    module.exports.default = Delta;
}
`;

  const ESM_IMPORTER = `import Delta, { AttributeMap, OpIterator } from './delta.js';
export const composed = AttributeMap.compose();
export const kinds = [typeof Delta, typeof OpIterator];
`;

  function createJsTransformerStub(): JavaScriptTransformer {
    return {
      transformData: vi.fn(async () => {
        throw new Error('transformData should not run for files that do not require linking');
      }),
    } as unknown as JavaScriptTransformer;
  }

  async function bundle(
    jsTransformer: JavaScriptTransformer,
    advancedOptimizations: boolean,
    cache?: { store: Map<string, string>; keyBase: string }
  ) {
    const outfile = path.join(fixtureDir, 'out.mjs');

    await esbuild.build({
      entryPoints: [path.join(fixtureDir, 'entry.js')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      resolveExtensions: ['.mjs', '.js', '.cjs'],
      plugins: [
        createAngularLinkerPlugin(jsTransformer, advancedOptimizations, cache),
        commonjsPlugin(),
      ],
    });

    return outfile;
  }

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-linker-plugin-'));
    fs.writeFileSync(path.join(fixtureDir, 'delta.js'), CJS_WITH_UMD_TAIL);
    fs.writeFileSync(path.join(fixtureDir, 'entry.js'), ESM_IMPORTER);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('keeps named exports of a UMD-sniffing CJS dependency intact in dev mode', async () => {
    const outfile = await bundle(createJsTransformerStub(), false);

    const { composed, kinds } = await import(/* @vite-ignore */ outfile);
    expect(composed).toBe('composed');
    expect(kinds).toEqual(['function', 'function']);
  });

  it('does not run the js transformer for files that do not require linking in dev mode', async () => {
    const jsTransformer = createJsTransformerStub();

    await bundle(jsTransformer, false);

    expect(jsTransformer.transformData).not.toHaveBeenCalled();
  });

  describe('transform cache', () => {
    function createLinkingStub(): JavaScriptTransformer {
      return {
        transformData: vi.fn(async (_path: string, contents: string) =>
          Buffer.from(`${contents}\nexport const linked = true;`, 'utf-8')
        ),
      } as unknown as JavaScriptTransformer;
    }

    beforeEach(() => {
      fs.writeFileSync(
        path.join(fixtureDir, 'entry.js'),
        'export const cmp = "ɵɵngDeclareComponent";\n'
      );
    });

    it('reuses the transform of an unchanged file across builds', async () => {
      const jsTransformer = createLinkingStub();
      const cache = { store: new Map<string, string>(), keyBase: '{"sourcemap":false}' };

      await bundle(jsTransformer, false, cache);
      const outfile = await bundle(jsTransformer, false, cache);

      expect(jsTransformer.transformData).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(outfile, 'utf-8')).toContain('linked = true');
    });

    it('transforms again when the file contents change', async () => {
      const jsTransformer = createLinkingStub();
      const cache = { store: new Map<string, string>(), keyBase: '{"sourcemap":false}' };

      await bundle(jsTransformer, false, cache);
      fs.appendFileSync(path.join(fixtureDir, 'entry.js'), 'export const other = 1;\n');
      await bundle(jsTransformer, false, cache);

      expect(jsTransformer.transformData).toHaveBeenCalledTimes(2);
    });

    it('transforms again when the output options change', async () => {
      const jsTransformer = createLinkingStub();
      const store = new Map<string, string>();

      await bundle(jsTransformer, false, { store, keyBase: '{"sourcemap":false}' });
      await bundle(jsTransformer, false, { store, keyBase: '{"sourcemap":true}' });

      expect(jsTransformer.transformData).toHaveBeenCalledTimes(2);
    });

    it('transforms every build when no cache is given', async () => {
      const jsTransformer = createLinkingStub();

      await bundle(jsTransformer, false);
      await bundle(jsTransformer, false);

      expect(jsTransformer.transformData).toHaveBeenCalledTimes(2);
    });
  });
});
