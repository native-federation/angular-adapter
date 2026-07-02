import {
  share,
  shareAll,
  withNativeFederation,
  getDefaultPlatform,
  getAngularShareScope,
  SERVER_DEPENDENCIES,
} from './share-utils.js';
import { NG_SKIP_LIST } from './angular-skip-list.js';

const mockCoreShare = vi.fn((cfg: unknown) => cfg);
const mockCoreShareAll = vi.fn((cfg: unknown) => cfg);
const mockCoreWithNativeFederation = vi.fn();

vi.mock('@softarc/native-federation/config', () => ({
  DEFAULT_SKIP_LIST: [],
  share: (...args: unknown[]) => mockCoreShare(...args),
  shareAll: (...args: unknown[]) => mockCoreShareAll(...args),
  withNativeFederation: (...args: unknown[]) => mockCoreWithNativeFederation(...args),
}));

const mockExistsSync = vi.fn((p: string) => p.endsWith('package.json'));
const mockReadFileSync = vi.fn(() =>
  JSON.stringify({ dependencies: { '@angular/core': '^21.1.4' } }),
);

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [string])),
  readFileSync: () => mockReadFileSync(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('shareAll', () => {
  it('defaults the skipList to NG_SKIP_LIST and delegates to the core implementation', () => {
    const config = { singleton: true } as never;

    shareAll(config);

    expect(mockCoreShareAll).toHaveBeenCalledTimes(1);
    const [passedConfig, passedOpts] = mockCoreShareAll.mock.calls[0]!;
    expect(passedConfig).toBe(config);
    expect(passedOpts.skipList).toBe(NG_SKIP_LIST);
  });

  it('keeps a caller-provided skipList', () => {
    const skipList = ['my-pkg'] as never;

    shareAll({} as never, { skipList, projectPath: '/p' });

    const [, passedOpts] = mockCoreShareAll.mock.calls[0]!;
    expect(passedOpts.skipList).toBe(skipList);
    expect(passedOpts.projectPath).toBe('/p');
  });

  it('returns whatever the core implementation returns', () => {
    const expected = { foo: 'bar' } as never;
    mockCoreShareAll.mockReturnValueOnce(expected);

    expect(shareAll({} as never)).toBe(expected);
  });
});

describe('share', () => {
  it('delegates with default projectPath and NG_SKIP_LIST', () => {
    const config = { rxjs: { singleton: true } } as never;

    share(config);

    expect(mockCoreShare).toHaveBeenCalledWith(config, '', NG_SKIP_LIST);
  });

  it('passes through an explicit projectPath and skipList', () => {
    const skipList = ['x'] as never;

    share({} as never, '/project', skipList);

    expect(mockCoreShare).toHaveBeenCalledWith({}, '/project', skipList);
  });
});

describe('withNativeFederation', () => {
  beforeEach(() => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: true },
      shared: {},
    });
  });

  it('infers the "node" platform when a server dependency is shared', () => {
    withNativeFederation({ shared: { '@angular/ssr': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('infers "node" for secondary entry points of server packages', () => {
    withNativeFederation({ shared: { '@angular/platform-server/init': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('infers the "browser" platform when no server dependency is shared', () => {
    withNativeFederation({ shared: { '@angular/core': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('browser');
  });

  it('does not override an explicitly configured platform', () => {
    withNativeFederation({ platform: 'node', shared: { '@angular/core': {} } } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('node');
  });

  it('handles a missing shared config without throwing', () => {
    expect(() => withNativeFederation({} as never)).not.toThrow();
    expect(mockCoreWithNativeFederation.mock.calls[0]![0].platform).toBe('browser');
  });

  it('removes @angular/common/locales entries when ignoreUnusedDeps is disabled', () => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: false },
      shared: {
        '@angular/core': { singleton: true },
        '@angular/common/locales/de': { singleton: true },
        '@angular/common/locales/fr': { singleton: true },
      },
    });

    const result = withNativeFederation({ shared: {} } as never);

    expect(Object.keys(result.shared)).toEqual(['@angular/core']);
  });

  it('keeps locale entries when ignoreUnusedDeps is enabled', () => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: true },
      shared: {
        '@angular/core': { singleton: true },
        '@angular/common/locales/de': { singleton: true },
      },
    });

    const result = withNativeFederation({ shared: {} } as never);

    expect(Object.keys(result.shared)).toEqual([
      '@angular/core',
      '@angular/common/locales/de',
    ]);
  });
});

describe('getAngularShareScope', () => {
  it('derives ng<major>.<minor> from the declared @angular/core version', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ dependencies: { '@angular/core': '^21.1.4' } }),
    );

    expect(getAngularShareScope('/project')).toBe('ng21.1');
  });

  it('strips range prefixes and prerelease suffixes', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ dependencies: { '@angular/core': '~22.0.0-next.3' } }),
    );

    expect(getAngularShareScope('/project')).toBe('ng22.0');
  });

  it('falls back to devDependencies and peerDependencies', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ devDependencies: { '@angular/core': '20.2.1' } }),
    );
    expect(getAngularShareScope('/project')).toBe('ng20.2');

    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ peerDependencies: { '@angular/core': '19.0.0' } }),
    );
    expect(getAngularShareScope('/project')).toBe('ng19.0');
  });

  it('throws when @angular/core is not a declared dependency', () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ dependencies: { rxjs: '7.0.0' } }),
    );

    expect(() => getAngularShareScope('/project')).toThrow(/@angular\/core/);
  });
});

describe('withNativeFederation shareScope: "auto"', () => {
  beforeEach(() => {
    mockCoreWithNativeFederation.mockReturnValue({
      features: { ignoreUnusedDeps: true },
      shared: {},
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { '@angular/core': '^21.1.4' } }),
    );
  });

  it('resolves the top-level shareScope', () => {
    withNativeFederation({ shareScope: 'auto', shared: {} } as never);

    expect(mockCoreWithNativeFederation.mock.calls[0]![0].shareScope).toBe('ng21.1');
  });

  it('resolves per-external shareScope entries', () => {
    withNativeFederation({
      shared: {
        '@angular/core': { shareScope: 'auto' },
        rxjs: { shareScope: 'auto' },
      },
    } as never);

    const passed = mockCoreWithNativeFederation.mock.calls[0]![0];
    expect(passed.shared['@angular/core'].shareScope).toBe('ng21.1');
    expect(passed.shared['rxjs'].shareScope).toBe('ng21.1');
  });

  it('leaves an explicitly configured shareScope untouched', () => {
    withNativeFederation({
      shareScope: 'custom',
      shared: { rxjs: { shareScope: 'other' } },
    } as never);

    const passed = mockCoreWithNativeFederation.mock.calls[0]![0];
    expect(passed.shareScope).toBe('custom');
    expect(passed.shared['rxjs'].shareScope).toBe('other');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('reads package.json at most once regardless of how many entries use "auto"', () => {
    withNativeFederation({
      shareScope: 'auto',
      shared: {
        '@angular/core': { shareScope: 'auto' },
        '@angular/common': { shareScope: 'auto' },
      },
    } as never);

    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('getDefaultPlatform', () => {
  it.each(SERVER_DEPENDENCIES)('returns "node" when a server dep (%s) is shared', dep => {
    expect(getDefaultPlatform([dep])).toBe('node');
  });

  it('returns "node" for secondary entry points of server deps', () => {
    expect(getDefaultPlatform(['@angular/ssr/node'])).toBe('node');
    expect(getDefaultPlatform(['@angular/platform-server/init'])).toBe('node');
  });

  it('returns "node" when at least one of several deps is a server dep', () => {
    expect(getDefaultPlatform(['@angular/core', 'rxjs', '@angular/ssr'])).toBe('node');
  });

  it('returns "browser" for non-server deps', () => {
    expect(getDefaultPlatform(['@angular/core', 'rxjs', '@angular/common'])).toBe('browser');
  });

  it('returns "browser" for an empty dep list', () => {
    expect(getDefaultPlatform([])).toBe('browser');
  });

  it('returns "browser" for packages that merely contain a server dep name mid-string', () => {
    // matching is prefix-based (startsWith), so this must not match
    expect(getDefaultPlatform(['my-@angular/ssr-wrapper'])).toBe('browser');
  });
});
