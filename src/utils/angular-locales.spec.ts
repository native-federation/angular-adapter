import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type * as ShareUtils from '../config/share-utils.js';
import { shareAngularLocales } from './angular-locales.js';

const mockShare = vi.fn((config: unknown, _projectPath?: string) => config);

vi.mock('../config/share-utils.js', () => ({
  share: (config: unknown, projectPath?: string) => mockShare(config, projectPath),
}));

type Entries = Record<string, Record<string, unknown>>;

describe('shareAngularLocales', () => {
  afterEach(() => {
    mockShare.mockClear();
  });

  // No packageInfo: the core resolves locales/<key>.js and the installed
  // @angular/common version itself (native-federation-core#234).
  it('builds a share entry per locale key with the default config', () => {
    const result = shareAngularLocales(['de', 'fr']) as Entries;

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual([
      '@angular/common/locales/de',
      '@angular/common/locales/fr',
    ]);
    expect(result['@angular/common/locales/de']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: 'auto',
    });
  });

  it('spells out the .mjs entry point in legacy mode, without a version', () => {
    const result = shareAngularLocales(['de'], { legacy: true }) as Entries;

    expect(result['@angular/common/locales/de'].packageInfo).toEqual({
      esm: true,
      entryPoint: 'node_modules/@angular/common/locales/de.mjs',
    });
  });

  it('merges a custom config and its packageInfo overrides', () => {
    const result = shareAngularLocales(['de'], {
      config: {
        singleton: false,
        strictVersion: false,
        requiredVersion: '1.2.3',
        packageInfo: { esm: false, version: '1.2.3' } as never,
      },
    }) as Entries;

    const entry = result['@angular/common/locales/de'];
    expect(entry).toMatchObject({
      singleton: false,
      strictVersion: false,
      requiredVersion: '1.2.3',
    });
    // A user's version is kept as a pin.
    expect(entry.packageInfo).toEqual({
      esm: false,
      entryPoint: 'node_modules/@angular/common/locales/de.js',
      version: '1.2.3',
    });
  });

  it('applies top-level pool and build options', () => {
    const result = shareAngularLocales(['de'], { pool: 'ng-core', build: 'package' }) as Entries;

    expect(result['@angular/common/locales/de']).toMatchObject({
      pool: 'ng-core',
      build: 'package',
    });
  });

  it('keeps pool and build set inside config', () => {
    const result = shareAngularLocales(['de'], {
      config: { singleton: true, pool: 'ng-core', build: 'package' },
    }) as Entries;

    expect(result['@angular/common/locales/de']).toMatchObject({
      pool: 'ng-core',
      build: 'package',
    });
  });

  it('lets top-level pool and build win over config', () => {
    const result = shareAngularLocales(['de'], {
      config: { singleton: true, pool: 'a', build: 'separate' },
      pool: 'b',
      build: 'package',
    }) as Entries;

    expect(result['@angular/common/locales/de']).toMatchObject({ pool: 'b', build: 'package' });
  });

  it('forwards projectPath to share', () => {
    shareAngularLocales(['de'], { projectPath: '/workspace' });
    expect(mockShare).toHaveBeenCalledWith(expect.anything(), '/workspace');
  });

  it('returns an empty map for no keys', () => {
    expect(shareAngularLocales([])).toEqual({});
  });
});

describe('shareAngularLocales with the real core share', () => {
  let workspace: string;

  // A minimal workspace with an installed @angular/common that has secondaries, so an
  // expansion under the locale key (`locales/de/http`) would show up.
  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'nf-locales-'));
    const common = path.join(workspace, 'node_modules/@angular/common');
    mkdirSync(path.join(common, 'locales'), { recursive: true });
    writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'app', dependencies: { '@angular/common': '^22.2.0' } })
    );
    writeFileSync(
      path.join(common, 'package.json'),
      JSON.stringify({
        name: '@angular/common',
        version: '22.2.3',
        type: 'module',
        exports: {
          '.': { default: './fesm2022/common.mjs' },
          './http': { default: './fesm2022/http.mjs' },
          './locales/*': { default: './locales/*.js' },
        },
      })
    );
    writeFileSync(path.join(common, 'locales/de.js'), 'export default [];');
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  // Guards the core#234 behaviour this adapter relies on: a sub-path key is not
  // expanded into secondaries and carries no packageInfo. share() only records the
  // declared range's floor; the installed version is resolved at bundle time
  // (installedVersions in core's bundle-shared.js), which core's own specs cover.
  it('shares a locale as a single key without packageInfo', async () => {
    const actual = await vi.importActual<typeof ShareUtils>('../config/share-utils.js');
    mockShare.mockImplementationOnce((config, projectPath) =>
      actual.share(config as never, projectPath)
    );

    const result = shareAngularLocales(['de'], { projectPath: workspace }) as Entries;

    expect(result).toEqual({
      '@angular/common/locales/de': {
        singleton: true,
        strictVersion: true,
        requiredVersion: '^22.2.0',
        version: '22.2.0',
      },
    });
  });
});
