import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { BuildOptions, OnResolveArgs, OnResolveOptions, PluginBuild } from 'esbuild';

type ResolveHandler = (args: OnResolveArgs) => Promise<{ path?: string; external?: boolean }>;

/**
 * Core's resolver reads the barrels off disk and compares declarations, so the mappings have to
 * point at real files holding real exports — an empty file publishes nothing and is declined as
 * a side-effect import.
 *
 * - `foo` is a plain lib whose entry point is a non-index barrel.
 * - `foo-utils` only exists to share a path prefix with `foo`.
 * - `ui` re-exports its module and its component, and deliberately hides a third file.
 * - `ui/lib/testing` is a secondary entry point nested under `ui`'s barrel.
 * - `modonly` is the NgModule shape whose barrel publishes only the module.
 * - `renamed` re-exports under a different name than the class is declared with.
 * - `facade` mixes a re-export of another package with a relative one, which leaves its export
 *   surface incomplete — core cannot read through the package specifier.
 */
let ws: string;

function write(relative: string, contents = ''): void {
  const file = path.join(ws, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

beforeAll(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-shared-mappings-'));

  write('libs/foo/src/public-api.ts', "export * from './lib/thing';\n");
  write('libs/foo/src/lib/thing.ts', 'export class Thing {}\n');
  write('libs/foo-utils/src/helper.ts', 'export class Helper {}\n');

  write(
    'libs/ui/src/index.ts',
    "export * from './lib/ui.module';\nexport * from './lib/badge.component';\n"
  );
  write('libs/ui/src/lib/ui.module.ts', 'export class UiModule {}\n');
  write('libs/ui/src/lib/badge.component.ts', 'export class BadgeComponent {}\n');
  write('libs/ui/src/lib/hidden.component.ts', 'export class HiddenComponent {}\n');
  write('libs/ui/src/lib/testing/index.ts', "export * from './harness';\n");
  write('libs/ui/src/lib/testing/harness.ts', 'export class Harness {}\n');

  write('libs/modonly/src/index.ts', "export * from './lib/ui.module';\n");
  write('libs/modonly/src/lib/ui.module.ts', 'export class UiModule {}\n');
  write('libs/modonly/src/lib/badge.component.ts', 'export class BadgeComponent {}\n');

  write(
    'libs/renamed/src/index.ts',
    "export { BadgeComponent as Badge } from './lib/badge.component';\n"
  );
  write('libs/renamed/src/lib/badge.component.ts', 'export class BadgeComponent {}\n');

  write(
    'libs/facade/src/index.ts',
    "export * from '@angular/core';\nexport * from './lib/badge.component';\n"
  );
  write('libs/facade/src/lib/badge.component.ts', 'export class BadgeComponent {}\n');

  write('apps/app/src/main.ts');
});

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

function setupPlugin(
  mappedPaths: PathToImport,
  initialOptions: BuildOptions = { platform: 'browser', define: { ngServerMode: 'false' } }
): { options?: OnResolveOptions; handler?: ResolveHandler; start?: () => void } {
  const plugin = createSharedMappingsPlugin(mappedPaths);

  let options: OnResolveOptions | undefined;
  let handler: ResolveHandler | undefined;
  let start: (() => void) | undefined;
  const build = {
    initialOptions,
    onStart(cb: () => void) {
      start = cb;
    },
    onResolve(opts: OnResolveOptions, cb: ResolveHandler) {
      options = opts;
      handler = cb;
    },
  } as unknown as PluginBuild;

  plugin.setup(build);
  return { options, handler, start };
}

const foo = (): PathToImport => ({ [path.join(ws, 'libs/foo/src/public-api.ts')]: 'foo-remote' });

const ui = (): PathToImport => ({
  [path.join(ws, 'libs/ui/src/index.ts')]: '@myorg/ui',
  [path.join(ws, 'libs/ui/src/lib/testing/index.ts')]: '@myorg/ui/testing',
});

function resolve(
  handler: ResolveHandler,
  args: {
    from: string;
    import: string;
    kind?: OnResolveArgs['kind'];
    namespace?: string;
    resolveDir?: string;
  }
) {
  const importer = path.join(ws, args.from);

  return handler({
    kind: args.kind ?? 'import-statement',
    namespace: args.namespace ?? 'file',
    resolveDir: args.resolveDir ?? path.dirname(importer),
    path: args.import,
    importer,
  } as OnResolveArgs);
}

describe('createSharedMappingsPlugin', () => {
  it('registers an onResolve handler for relative imports', () => {
    const { options } = setupPlugin(foo());
    expect(options?.filter).toEqual(/^[.]/);
  });

  it('maps a relative import pointing into a shared lib to an external path', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/lib/thing',
    });

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('maps a relative import of the mapped entry point itself', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/public-api',
    });

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('does not externalize imports originating from within the same lib (self-import)', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'libs/foo/src/lib/other.ts',
      import: './thing',
    });

    expect(result).toEqual({});
  });

  it('ignores non-import-statement kinds', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo/src/lib/thing',
      kind: 'require-call',
    });

    expect(result).toEqual({});
  });

  it('returns an empty result for unmapped relative imports', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: './local-file',
    });

    expect(result).toEqual({});
  });

  it('leaves a sibling lib whose path merely shares a prefix alone', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/foo-utils/src/helper',
    });

    expect(result).toEqual({});
  });

  it('maps a component the barrel re-exports alongside its module', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/badge.component',
    });

    expect(result).toEqual({ path: '@myorg/ui', external: true });
  });

  it('leaves a file the barrel does not re-export inlined', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/hidden.component',
    });

    expect(result).toEqual({});
  });

  // The known decline: ngtsc emits the deep import whether or not the barrel publishes the
  // component, so an NgModule lib exporting only its module stays duplicated. Rewriting anyway
  // would point `i1.BadgeComponent` at a namespace that has no such name.
  it('declines an NgModule lib whose barrel publishes only the module', async () => {
    const { handler } = setupPlugin({
      [path.join(ws, 'libs/modonly/src/index.ts')]: '@myorg/modonly',
    });

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/modonly/src/lib/badge.component',
    });

    expect(result).toEqual({});
  });

  // The rewrite swaps the specifier but keeps the property access, so a renamed re-export
  // leaves the file reachable while `ns.BadgeComponent` is undefined.
  it('declines a file the barrel re-exports under a different name', async () => {
    const { handler } = setupPlugin({
      [path.join(ws, 'libs/renamed/src/index.ts')]: '@myorg/renamed',
    });

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/renamed/src/lib/badge.component',
    });

    expect(result).toEqual({});
  });

  it('prefers the closest mapping when a secondary entry point sits under a barrel', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/testing/harness',
    });

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  it('externalizes a barrel file reaching into a secondary of the same lib', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'libs/ui/src/lib/badge.component.ts',
      import: './testing/harness',
    });

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  it('registers nothing for the server bundle', () => {
    const { options, handler, start } = setupPlugin(foo(), {
      platform: 'node',
      define: { ngServerMode: 'true' },
    });

    expect(options).toBeUndefined();
    expect(handler).toBeUndefined();
    expect(start).toBeUndefined();
  });

  // SSR targeting an edge runtime (`ssr.platform: "neutral"`) builds the server bundle with
  // `platform: 'neutral'`, and a rewrite there emits a bare specifier no import map resolves.
  it('registers nothing for a server bundle built for a non-node runtime', () => {
    const { options, handler, start } = setupPlugin(foo(), {
      platform: 'neutral',
      define: { ngServerMode: 'true' },
    });

    expect(options).toBeUndefined();
    expect(handler).toBeUndefined();
    expect(start).toBeUndefined();
  });

  // Angular's virtual modules resolve against the workspace root, so the joined path would name
  // a file the importer never asked for — here one that does sit under a mapping.
  it('declines an import from a virtual module', async () => {
    const { handler } = setupPlugin(foo());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: './libs/foo/src/lib/thing',
      namespace: 'angular:polyfills',
      resolveDir: ws,
    });

    expect(result).toEqual({});
  });

  // A barrel re-exporting another package cannot be read through, so its surface is incomplete.
  // The entry point still publishes itself, and a file it re-exports relatively is still
  // reachable, so neither shape depends on reading past the package specifier.
  it('maps an entry point whose barrel also re-exports another package', async () => {
    const { handler } = setupPlugin({
      [path.join(ws, 'libs/facade/src/index.ts')]: '@myorg/facade',
    });

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/facade/src/index',
    });

    expect(result).toEqual({ path: '@myorg/facade', external: true });
  });

  it('maps a deep import through a barrel that also re-exports another package', async () => {
    const { handler } = setupPlugin({
      [path.join(ws, 'libs/facade/src/index.ts')]: '@myorg/facade',
    });

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/facade/src/lib/badge.component',
    });

    expect(result).toEqual({ path: '@myorg/facade', external: true });
  });

  // Export surfaces are cached for the resolver's lifetime and an esbuild context outlives any
  // one rebuild, so without the onStart reset a barrel edited under `ng serve` would keep
  // answering from the first build until restart.
  it('picks up a barrel edited between rebuilds', async () => {
    write('libs/watched/src/index.ts', "export * from './lib/ui.module';\n");
    write('libs/watched/src/lib/ui.module.ts', 'export class UiModule {}\n');
    write('libs/watched/src/lib/badge.component.ts', 'export class BadgeComponent {}\n');

    const { handler, start } = setupPlugin({
      [path.join(ws, 'libs/watched/src/index.ts')]: '@myorg/watched',
    });

    const deepImport = {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/watched/src/lib/badge.component',
    };

    expect(await resolve(handler!, deepImport)).toEqual({});

    write(
      'libs/watched/src/index.ts',
      "export * from './lib/ui.module';\nexport * from './lib/badge.component';\n"
    );
    start!();

    expect(await resolve(handler!, deepImport)).toEqual({
      path: '@myorg/watched',
      external: true,
    });
  });
});
