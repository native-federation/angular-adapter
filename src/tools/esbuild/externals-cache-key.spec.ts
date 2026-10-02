import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createExternalsCacheKey,
  readKeyedVersions,
  resolveSharedBundleSettings,
  type KeyedVersions,
  type SharedBundleSettings,
} from './externals-cache-key.js';

const versions: KeyedVersions = {
  adapter: '@angular-architects/native-federation@22.2.1',
  esbuild: '0.28.0',
  angularBuild: '22.2.0',
};

const settings: SharedBundleSettings = {
  target: ['chrome120', 'firefox120', 'safari17'],
  sourcemap: false,
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

describe('resolveSharedBundleSettings', () => {
  let workspaceRoot: string;

  const contextFor = (root = 'apps/example') =>
    ({
      workspaceRoot,
      target: { project: 'example' },
      getProjectMetadata: async () => ({ root }),
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }) as never;

  const writeBrowserslist = (query: string, root = 'apps/example') => {
    fs.mkdirSync(path.join(workspaceRoot, root), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, root, '.browserslistrc'), query);
  };

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-externals-key-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reads the target from the project's .browserslistrc", async () => {
    writeBrowserslist('Chrome 120\n');

    const resolved = await resolveSharedBundleSettings({} as never, contextFor());

    expect(resolved.target).toEqual(['chrome120.0']);
  });

  // The scenario from #148: editing .browserslistrc must not reuse the old shared bundles.
  // browserslist caches the config it finds per path within a process (a real rebuild is a new
  // process), so the edited config lives in a second project instead of overwriting the first.
  it('yields a different cache key for a different .browserslistrc', async () => {
    writeBrowserslist('Chrome 120\n', 'apps/before');
    const before = createExternalsCacheKey(
      await resolveSharedBundleSettings({} as never, contextFor('apps/before')),
      versions
    );

    writeBrowserslist('Chrome 120\nFirefox 120\n', 'apps/after');
    const after = createExternalsCacheKey(
      await resolveSharedBundleSettings({} as never, contextFor('apps/after')),
      versions
    );

    expect(after).not.toEqual(before);
  });

  it.each([
    [undefined, false],
    [false, false],
    [true, true],
    [{ scripts: true }, true],
    [{ scripts: false, styles: true }, false],
    [{ scripts: true, hidden: true }, 'external'],
    [{ scripts: false, hidden: true }, false],
  ])('normalizes sourceMap %j to %j', async (sourceMap, expected) => {
    writeBrowserslist('Chrome 120\n');

    const resolved = await resolveSharedBundleSettings({ sourceMap } as never, contextFor());

    expect(resolved.sourcemap).toBe(expected);
  });

  // Style source maps never touch shared externals, so they must not miss the cache.
  it('keeps the key when only style source maps change', async () => {
    writeBrowserslist('Chrome 120\n');
    const keyFor = async (sourceMap: unknown) =>
      createExternalsCacheKey(
        await resolveSharedBundleSettings({ sourceMap } as never, contextFor()),
        versions
      );

    const base = await keyFor({ scripts: true });

    expect(await keyFor({ scripts: true, styles: true })).toEqual(base);
  });

  // Hidden maps drop the sourceMappingURL comment from shared externals, so the bytes differ.
  it('changes the key when script source maps become hidden', async () => {
    writeBrowserslist('Chrome 120\n');
    const keyFor = async (sourceMap: unknown) =>
      createExternalsCacheKey(
        await resolveSharedBundleSettings({ sourceMap } as never, contextFor()),
        versions
      );

    expect(await keyFor({ scripts: true, hidden: true })).not.toEqual(
      await keyFor({ scripts: true })
    );
  });

  it('passes the loader option through', async () => {
    writeBrowserslist('Chrome 120\n');

    const resolved = await resolveSharedBundleSettings(
      { loader: { '.svg': 'text' } } as never,
      contextFor()
    );

    expect(resolved.loader).toEqual({ '.svg': 'text' });
  });
});
