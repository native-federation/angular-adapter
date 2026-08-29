import { createSharedMappingsPlugin } from './shared-mappings-plugin.js';
import type { PathToImport } from '@softarc/native-federation/internal';
import type { BuildOptions, OnResolveArgs, OnResolveOptions, PluginBuild } from 'esbuild';

type ResolveHandler = (args: OnResolveArgs) => Promise<{ path?: string; external?: boolean }>;

function setupPlugin(
  mappedPaths: PathToImport,
  initialOptions: BuildOptions = { platform: 'browser' }
): {
  options?: OnResolveOptions;
  handler?: ResolveHandler;
} {
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

const MAPPED: PathToImport = {
  '/ws/libs/foo/src/public-api.ts': 'foo-remote',
};

// `resolveGlob` expands secondaries into their own entry points, so the barrel and a
// directory nested under it are both mappings.
const WITH_SECONDARY: PathToImport = {
  '/ws/libs/ui/src/index.ts': '@myorg/ui',
  '/ws/libs/ui/src/lib/testing/index.ts': '@myorg/ui/testing',
};

describe('createSharedMappingsPlugin', () => {
  it('registers an onResolve handler for relative imports', () => {
    const { options } = setupPlugin(MAPPED);
    expect(options?.filter).toEqual(/^[.]/);
  });

  it('maps a relative import pointing into a shared lib to an external path', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/foo/src/public-api',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('does not externalize imports originating from within the same lib (self-import)', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/libs/foo/src',
      path: './public-api',
      importer: '/ws/libs/foo/src/internal.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('ignores non-import-statement kinds', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'require-call',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/foo/src/public-api',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('returns an empty result for unmapped relative imports', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: './local-file',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('leaves a sibling lib whose path merely shares a prefix alone', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/foo-utils/src/helper',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({});
  });

  it('maps a relative import of the mapped entry point itself', async () => {
    const { handler } = setupPlugin(MAPPED);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app',
      path: '../../libs/foo/src',
      importer: '/ws/apps/app/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: 'foo-remote', external: true });
  });

  it('prefers the closest mapping when a secondary entry point sits under a barrel', async () => {
    const { handler } = setupPlugin(WITH_SECONDARY);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/ui/src/lib/testing/harness',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  it('still maps files of the barrel that fall outside the secondary', async () => {
    const { handler } = setupPlugin(WITH_SECONDARY);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/apps/app/src',
      path: '../../../libs/ui/src/lib/badge.component',
      importer: '/ws/apps/app/src/main.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: '@myorg/ui', external: true });
  });

  it('externalizes a barrel file reaching into a secondary of the same lib', async () => {
    const { handler } = setupPlugin(WITH_SECONDARY);

    const result = await handler!({
      kind: 'import-statement',
      resolveDir: '/ws/libs/ui/src/lib',
      path: './testing/harness',
      importer: '/ws/libs/ui/src/lib/badge.component.ts',
    } as OnResolveArgs);

    expect(result).toEqual({ path: '@myorg/ui/testing', external: true });
  });

  it('registers nothing for the server bundle', () => {
    const { options, handler } = setupPlugin(MAPPED, { platform: 'node' });

    expect(options).toBeUndefined();
    expect(handler).toBeUndefined();
  });
});
