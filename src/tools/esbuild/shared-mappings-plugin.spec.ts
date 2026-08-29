import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { BuildOptions, OnResolveArgs, OnResolveOptions, PluginBuild } from 'esbuild';

type ResolveHandler = (args: OnResolveArgs) => Promise<{ path?: string; external?: boolean }>;

/**
 * The guard reads the barrels off disk, so the mappings have to point at real files.
 *
 * - `foo` is a plain lib whose entry point is a non-index barrel.
 * - `ui` re-exports one component and deliberately hides another, the shape where Angular
 *   emits a deep import to a file the entry point does not publish.
 * - `ui/lib/testing` is a secondary entry point nested under `ui`'s barrel.
 * - `foo-utils` only exists to share a path prefix with `foo`.
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
  write('libs/foo/src/lib/thing.ts');
  write('libs/foo-utils/src/helper.ts');

  write('libs/ui/src/index.ts', "export * from './lib/badge.component';\n");
  write('libs/ui/src/lib/badge.component.ts');
  write('libs/ui/src/lib/hidden.component.ts');
  write('libs/ui/src/lib/testing/index.ts', "export * from './harness';\n");
  write('libs/ui/src/lib/testing/harness.ts');

  write('apps/app/src/main.ts');
});

afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

function setupPlugin(
  mappedPaths: PathToImport,
  initialOptions: BuildOptions = { platform: 'browser' }
): { options?: OnResolveOptions; handler?: ResolveHandler } {
  const plugin = createSharedMappingsPlugin(mappedPaths);

  let options: OnResolveOptions | undefined;
  let handler: ResolveHandler | undefined;
  const build = {
    initialOptions,
    onResolve(opts: OnResolveOptions, cb: ResolveHandler) {
      options = opts;
      handler = cb;
    },
  } as unknown as PluginBuild;

  plugin.setup(build);
  return { options, handler };
}

const foo = (): PathToImport => ({ [path.join(ws, 'libs/foo/src/public-api.ts')]: 'foo-remote' });

const ui = (): PathToImport => ({
  [path.join(ws, 'libs/ui/src/index.ts')]: '@myorg/ui',
  [path.join(ws, 'libs/ui/src/lib/testing/index.ts')]: '@myorg/ui/testing',
});

function resolve(
  handler: ResolveHandler,
  args: { from: string; import: string; kind?: OnResolveArgs['kind'] }
) {
  const importer = path.join(ws, args.from);

  return handler({
    kind: args.kind ?? 'import-statement',
    resolveDir: path.dirname(importer),
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

  it('leaves a file the barrel does not re-export inlined', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/hidden.component',
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

  it('still maps files of the barrel that fall outside the secondary', async () => {
    const { handler } = setupPlugin(ui());

    const result = await resolve(handler!, {
      from: 'apps/app/src/main.ts',
      import: '../../../libs/ui/src/lib/badge.component',
    });

    expect(result).toEqual({ path: '@myorg/ui', external: true });
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
    const { options, handler } = setupPlugin(foo(), { platform: 'node' });

    expect(options).toBeUndefined();
    expect(handler).toBeUndefined();
  });
});
