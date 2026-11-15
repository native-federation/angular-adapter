import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import type { Metafile } from 'esbuild';

import { EXTRACTION_FILE_SEPARATOR, extractLicenses } from './license-extractor.js';

// Angular's original, loaded by absolute file path because the exports map blocks the
// `@angular/build/src/...` specifier (#153). Test-only: used as the reference implementation.
const require = createRequire(import.meta.url);
const angularBuildRoot = path.dirname(require.resolve('@angular/build/package.json'));
const angular = require(path.join(angularBuildRoot, 'src/tools/esbuild/license-extractor.js')) as {
  extractLicenses: (metafiles: Metafile[], rootDirectory: string) => Promise<string>;
};

let ws: string;

function write(rel: string, content: string): void {
  const file = path.join(ws, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function metafile(inputs: Record<string, number>): Metafile {
  return {
    inputs: {},
    outputs: {
      'out/bundle.js': {
        bytes: 1,
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([input, bytesInOutput]) => [input, { bytesInOutput }])
        ),
        imports: [],
        exports: [],
      },
    },
  };
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-license-extractor-'));
  write('node_modules/mit-pkg/package.json', JSON.stringify({ name: 'mit-pkg', version: '1.0.0', license: 'MIT' }));
  write('node_modules/mit-pkg/LICENSE', 'MIT text\n');
  write('node_modules/mit-pkg/index.js', '');
  write(
    'node_modules/@scope/custom/package.json',
    JSON.stringify({ name: '@scope/custom', version: '2.0.0', license: 'SEE LICENSE IN terms.txt' })
  );
  write('node_modules/@scope/custom/terms.txt', 'Custom terms\n');
  write('node_modules/@scope/custom/dist/index.js', '');
  write('node_modules/no-file/package.json', JSON.stringify({ name: 'no-file', version: '3.0.0', license: 'ISC' }));
  write('node_modules/no-file/index.js', '');
  write('node_modules/shaken/package.json', JSON.stringify({ name: 'shaken', version: '4.0.0', license: 'MIT' }));
  write('node_modules/shaken/index.js', '');
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe('extractLicenses', () => {
  const metafiles = () => [
    metafile({
      'src/app.ts': 10,
      'node_modules/mit-pkg/index.js': 10,
      'node_modules/@scope/custom/dist/index.js': 10,
      'node_modules/no-file/index.js': 10,
      'node_modules/shaken/index.js': 0,
    }),
    metafile({ 'node_modules/mit-pkg/index.js': 5 }),
  ];

  it('produces the same file as @angular/build', async () => {
    expect(await extractLicenses(metafiles(), ws)).toBe(await angular.extractLicenses(metafiles(), ws));
  });

  it('lists each package once, without tree-shaken ones', async () => {
    const entries = (await extractLicenses(metafiles(), ws)).split(EXTRACTION_FILE_SEPARATOR);

    expect(entries.map(entry => entry.match(/^Package: (.+)$/m)?.[1]).filter(Boolean)).toEqual([
      'mit-pkg',
      '@scope/custom',
      'no-file',
    ]);
  });
});
