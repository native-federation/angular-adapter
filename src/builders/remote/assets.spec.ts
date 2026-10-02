import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';

import { copyAllAssets, copyChangedAssets, normalizeRemoteAssetEntries } from './assets.js';

// Angular's originals, loaded by absolute file path because the exports map blocks the
// `@angular/build/src/...` specifier (#153). Test-only: used as the reference implementation.
const require = createRequire(import.meta.url);
const angularBuildRoot = path.dirname(require.resolve('@angular/build/package.json'));
const { normalizeAssetPatterns } = require(
  path.join(angularBuildRoot, 'src/utils/normalize-asset-patterns.js')
);
const { resolveAssets } = require(path.join(angularBuildRoot, 'src/utils/resolve-assets.js'));

let ws: string;
let out: string;

function write(rel: string, content = rel): void {
  const file = path.join(ws, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter(d => d.isFile())
    .map(d => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .sort();
}

beforeEach(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-assets-')));
  out = path.join(ws, 'dist');
  write('projects/mfe/src/favicon.ico');
  write('projects/mfe/src/assets/logo.svg');
  write('projects/mfe/src/assets/i18n/en.json');
  write('projects/mfe/src/assets/.gitkeep');
  write('projects/mfe/src/assets/.well-known/config');
  write('projects/mfe/src/assets/Thumbs.db');
  write('projects/mfe/public/robots.txt');
  write('projects/mfe/public/nested/a.txt');
  write('projects/mfe/README.md');
  write('shared/brand/font.woff2');
  write('shared/brand/skip.tmp');
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

// Covers every branch of Angular's normalizer: string file / dir / missing path under sourceRoot,
// under projectRoot, under workspaceRoot, and object patterns with/without output, ignore, flatten.
const patterns = [
  'projects/mfe/src/favicon.ico',
  'projects/mfe/src/assets',
  'projects/mfe/src/does-not-exist',
  'projects/mfe/README.md',
  'shared/brand',
  { glob: '**/*', input: 'projects/mfe/public' },
  { glob: '**/*.txt', input: 'projects/mfe/public', output: 'static', flatten: true },
  { glob: '**/*', input: 'shared/brand', output: '/brand/', ignore: ['*.tmp'] },
];

describe('normalizeRemoteAssetEntries', () => {
  it('matches @angular/build for every pattern shape', () => {
    const ours = normalizeRemoteAssetEntries(
      structuredClone(patterns),
      ws,
      'projects/mfe',
      'projects/mfe/src'
    );
    const angular = normalizeAssetPatterns(
      structuredClone(patterns),
      ws,
      'projects/mfe',
      'projects/mfe/src'
    );

    expect(ours).toEqual(angular);
  });

  it('defaults sourceRoot to <projectRoot>/src like @angular/build', () => {
    const ours = normalizeRemoteAssetEntries(
      structuredClone(patterns),
      ws,
      'projects/mfe',
      undefined
    );
    const angular = normalizeAssetPatterns(structuredClone(patterns), ws, 'projects/mfe', undefined);

    expect(ours).toEqual(angular);
  });

  it('returns nothing for missing or empty assets', () => {
    expect(normalizeRemoteAssetEntries(undefined, ws, 'p', 'p/src')).toEqual([]);
    expect(normalizeRemoteAssetEntries([], ws, 'p', 'p/src')).toEqual([]);
  });

  it('rejects inputs outside the workspace', () => {
    expect(() => normalizeRemoteAssetEntries(['../outside'], ws, 'p', 'p/src')).toThrow(
      /must be within the workspace root/
    );
    expect(() =>
      normalizeRemoteAssetEntries([{ glob: '*', input: '../outside' }], ws, 'p', 'p/src')
    ).toThrow(/must be within the workspace root/);
  });

  it('rejects outputs that escape the output path', () => {
    expect(() =>
      normalizeRemoteAssetEntries([{ glob: '*', input: 'shared', output: '../up' }], ws, 'p', 'p/src')
    ).toThrow(/outside of the output path/);
  });
});

describe('copyAllAssets', () => {
  it('copies the same files to the same destinations as @angular/build resolves', async () => {
    const entries = normalizeRemoteAssetEntries(patterns, ws, 'projects/mfe', 'projects/mfe/src');
    const angular = (await resolveAssets(structuredClone(entries), ws)) as {
      destination: string;
    }[];

    await copyAllAssets(entries, out, ws);

    const expected = [...new Set(angular.map(a => a.destination.split(path.sep).join('/')))].sort();
    expect(listFiles(out)).toEqual(expected);
    // Sanity: default ignores applied, dotfiles kept, flatten and custom ignore honoured.
    expect(expected).toContain('assets/.well-known/config');
    expect(expected).toContain('static/a.txt');
    expect(expected).not.toContain('assets/.gitkeep');
    expect(expected).not.toContain('assets/Thumbs.db');
    expect(expected).not.toContain('brand/skip.tmp');
  });
});

describe('copyChangedAssets', () => {
  it('copies only the changed files', async () => {
    const entries = normalizeRemoteAssetEntries(patterns, ws, 'projects/mfe', 'projects/mfe/src');

    await copyChangedAssets(entries, out, ws, ['projects/mfe/src/assets/logo.svg']);

    expect(listFiles(out)).toEqual(['assets/logo.svg']);
  });
});
