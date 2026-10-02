import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

import {
  createExternalsCacheKey,
  readKeyedVersions,
  type KeyedVersions,
} from './externals-cache-key.js';
import type { SharedBundleSettings } from './shared-bundle-settings.js';

const versions: KeyedVersions = {
  adapter: '@angular-architects/native-federation@22.2.1',
  esbuild: '0.28.0',
  angularBuild: '22.2.0',
};

const settings: SharedBundleSettings = {
  target: ['chrome120', 'firefox120', 'safari17'],
  sourcemap: false,
  plugins: [],
};

const keyOf = (s: Partial<SharedBundleSettings> = {}, v: Partial<KeyedVersions> = {}) =>
  JSON.stringify(createExternalsCacheKey({ ...settings, ...s }, { ...versions, ...v }));

describe('createExternalsCacheKey', () => {
  const baseline = keyOf();

  it('is stable for identical inputs', () => {
    expect(keyOf()).toBe(baseline);
  });

  it('changes with the adapter version', () => {
    expect(keyOf({}, { adapter: '@angular-architects/native-federation@22.2.2' })).not.toBe(
      baseline
    );
  });

  it('changes with the esbuild version', () => {
    expect(keyOf({}, { esbuild: '0.28.1' })).not.toBe(baseline);
  });

  // The linker and JavaScriptTransformer that process shared externals come from @angular/build.
  it('changes with the @angular/build version', () => {
    expect(keyOf({}, { angularBuild: '22.2.1' })).not.toBe(baseline);
  });

  it('changes with the target list', () => {
    expect(keyOf({ target: ['chrome120', 'firefox120'] })).not.toBe(baseline);
  });

  it('ignores the order of the target list', () => {
    expect(keyOf({ target: ['safari17', 'chrome120', 'firefox120'] })).toBe(baseline);
  });

  it('changes with script source maps', () => {
    expect(keyOf({ sourcemap: true })).not.toBe(baseline);
    expect(keyOf({ sourcemap: 'external' })).not.toBe(keyOf({ sourcemap: true }));
  });

  it('changes with the loader option', () => {
    expect(keyOf({ loader: { '.svg': 'text' } })).not.toBe(baseline);
    expect(keyOf({ loader: { '.svg': 'text' } })).not.toBe(keyOf({ loader: { '.svg': 'file' } }));
  });

  it('ignores the order of loader entries', () => {
    expect(keyOf({ loader: { '.svg': 'text', '.txt': 'text' } })).toBe(
      keyOf({ loader: { '.txt': 'text', '.svg': 'text' } })
    );
  });

  it('treats a missing loader like an empty one', () => {
    expect(keyOf({ loader: {} })).toBe(baseline);
  });

  // Plugins are opaque objects; see the known gap in #148.
  it('ignores plugins', () => {
    expect(keyOf({ plugins: [{ name: 'custom', setup: () => undefined }] })).toBe(baseline);
  });
});

describe('readKeyedVersions', () => {
  it('reads the adapter, esbuild and @angular/build versions', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8')
    );

    const read = readKeyedVersions();

    expect(read.adapter).toBe(`${pkg.name}@${pkg.version}`);
    expect(read.esbuild).toBe(esbuild.version);
    expect(read.angularBuild).toMatch(/^\d+\.\d+\.\d+/);
  });
});
