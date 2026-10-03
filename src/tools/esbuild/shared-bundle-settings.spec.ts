import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createExternalsCacheKey, type KeyedVersions } from './externals-cache-key.js';
import { resolveSharedBundleSettings } from './shared-bundle-settings.js';

const versions: KeyedVersions = {
  adapter: '@angular-architects/native-federation@22.2.1',
  esbuild: '0.28.0',
  angularBuild: '22.2.0',
};

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
    // Resolved from the project root for the `angular:linked-<version>` condition.
    const corePkg = path.join(workspaceRoot, 'node_modules', '@angular', 'core');
    fs.mkdirSync(corePkg, { recursive: true });
    fs.writeFileSync(
      path.join(corePkg, 'package.json'),
      JSON.stringify({ name: '@angular/core', version: '22.2.0' })
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
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

  // #163: shared bundles follow optimization.scripts like Angular's app build, not NF's `dev`.
  it('reads the script settings from the builder options', async () => {
    writeBrowserslist('Chrome 120\n');

    const resolved = await resolveSharedBundleSettings(
      { optimization: false, polyfills: ['zone.js'], conditions: ['custom'] } as never,
      contextFor()
    );

    expect(resolved.script).toEqual({
      optimize: false,
      allowMangle: true,
      zoneless: false,
      conditions: ['es2015', 'es2020', 'angular:linked-22.2.0', 'custom'],
      sourcesContent: false,
    });
  });

  // The repro from #163: only flipping `optimization` reused the cached prod-compiled core.
  it('changes the key when script optimization changes', async () => {
    writeBrowserslist('Chrome 120\n');
    const keyFor = async (optimization: unknown) =>
      createExternalsCacheKey(
        await resolveSharedBundleSettings({ optimization } as never, contextFor()),
        versions
      );

    expect(await keyFor(false)).not.toEqual(await keyFor(true));
    expect(await keyFor({ scripts: true, styles: false })).toEqual(await keyFor(true));
  });

  it('changes the key when NG_BUILD_MANGLE changes', async () => {
    writeBrowserslist('Chrome 120\n');
    const key = async () =>
      createExternalsCacheKey(
        await resolveSharedBundleSettings({} as never, contextFor()),
        versions
      );

    const mangled = await key();
    vi.stubEnv('NG_BUILD_MANGLE', '0');

    expect(await key()).not.toEqual(mangled);
  });

  it('passes the custom plugins through', async () => {
    writeBrowserslist('Chrome 120\n');
    const plugin = { name: 'custom', setup: () => undefined };

    const resolved = await resolveSharedBundleSettings(
      { plugins: [plugin] } as never,
      contextFor()
    );

    expect(resolved.plugins).toEqual([plugin]);
  });

  it('defaults to no custom plugins', async () => {
    writeBrowserslist('Chrome 120\n');

    const resolved = await resolveSharedBundleSettings({} as never, contextFor());

    expect(resolved.plugins).toEqual([]);
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
