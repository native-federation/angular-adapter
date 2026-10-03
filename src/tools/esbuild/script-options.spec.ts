import {
  getConditions,
  getFeatureSupport,
  getScriptBuildOptions,
  isZonelessApp,
  readAllowMangle,
  resolveScriptSettings,
  type ScriptSettings,
} from './script-options.js';

const settings = (overrides: Partial<ScriptSettings> = {}): ScriptSettings => ({
  optimize: true,
  allowMangle: true,
  zoneless: false,
  conditions: ['es2015'],
  sourcesContent: undefined,
  ...overrides,
});

describe('readAllowMangle', () => {
  // Mirrors `allowMangle` in angular-cli utils/environment-options.ts.
  it.each([
    [{}, true],
    [{ NG_BUILD_MANGLE: '0' }, false],
    [{ NG_BUILD_MANGLE: 'false' }, false],
    [{ NG_BUILD_MANGLE: 'TRUE' }, true],
    [{ NG_BUILD_MANGLE: 'nonsense' }, true],
    [{ NG_BUILD_DEBUG_OPTIMIZE: '1' }, false],
    [{ NG_BUILD_DEBUG_OPTIMIZE: 'false' }, true],
    [{ NG_BUILD_DEBUG_OPTIMIZE: 'minify,beautify' }, false],
    [{ NG_BUILD_DEBUG_OPTIMIZE: 'minify, Mangle' }, true],
    // NG_BUILD_MANGLE wins over the debug setting.
    [{ NG_BUILD_DEBUG_OPTIMIZE: '1', NG_BUILD_MANGLE: '1' }, true],
    [{ NG_BUILD_DEBUG_OPTIMIZE: 'mangle', NG_BUILD_MANGLE: '0' }, false],
  ])('reads %j as %s', (env, expected) => {
    expect(readAllowMangle(env)).toBe(expected);
  });
});

describe('getConditions', () => {
  it('adds the default conditions for an optimized build', () => {
    expect(getConditions(true, undefined)).toEqual(['es2015', 'es2020', 'module', 'production']);
  });

  it('adds the development condition for an unoptimized build', () => {
    expect(getConditions(false, undefined).at(-1)).toBe('development');
  });

  it("replaces the defaults with the user's conditions", () => {
    expect(getConditions(true, ['custom'])).toEqual(['es2015', 'es2020', 'custom']);
  });

  // Deliberate deviation from Angular: no package ships pre-linked code yet, and without the
  // condition we link at bundle time to the same output.
  it('leaves out the pre-linked package condition', () => {
    expect(getConditions(true, undefined).some(c => c.startsWith('angular:linked-'))).toBe(false);
  });
});

describe('isZonelessApp', () => {
  it.each([
    [undefined, true],
    [[], true],
    [['zone.js'], false],
    [['src/polyfills.ts'], false],
    [['@angular/localize/init'], true],
  ])('treats polyfills %j as zoneless: %s', (polyfills, expected) => {
    expect(isZonelessApp(polyfills)).toBe(expected);
  });
});

describe('getFeatureSupport', () => {
  // The catch-binding flag works around an esbuild minification bug with lowered for-await.
  it('lowers async/await and keeps catch bindings with Zone.js', () => {
    expect(getFeatureSupport(false)).toEqual({
      'async-await': false,
      'optional-catch-binding': false,
      'object-rest-spread': false,
    });
  });

  it('keeps native async/await when zoneless', () => {
    expect(getFeatureSupport(true)).toEqual({
      'async-await': true,
      'object-rest-spread': false,
    });
  });
});

describe('getScriptBuildOptions', () => {
  it('minifies and disables dev mode for an optimized build', () => {
    const options = getScriptBuildOptions(settings(), 'browser');

    expect(options).toMatchObject({
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      legalComments: 'eof',
      define: { ngDevMode: 'false' },
    });
  });

  // ngDevMode must stay undefined (never 'true'), so Angular can turn it into its debug object.
  it('keeps dev mode and skips minification for an unoptimized build', () => {
    const options = getScriptBuildOptions(settings({ optimize: false }), 'browser');

    expect(options).toMatchObject({
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: false,
      legalComments: 'inline',
      define: {},
    });
  });

  it('only skips mangling when mangling is disallowed', () => {
    const options = getScriptBuildOptions(settings({ allowMangle: false }), 'browser');

    expect(options).toMatchObject({
      minifyIdentifiers: false,
      minifySyntax: true,
      minifyWhitespace: true,
    });
  });

  // Deliberate deviation: Angular's 'none' under extractLicenses relies on its license
  // extraction, which never sees our bundles.
  it('never drops legal comments', () => {
    expect(getScriptBuildOptions(settings(), 'browser').legalComments).not.toBe('none');
  });

  it("uses Angular's browser and server main fields", () => {
    expect(getScriptBuildOptions(settings(), 'browser').mainFields).toEqual([
      'es2020',
      'es2015',
      'browser',
      'module',
      'main',
    ]);
    expect(getScriptBuildOptions(settings(), 'node').mainFields).toEqual([
      'es2020',
      'es2015',
      'module',
      'main',
    ]);
  });

  it('passes conditions, sourcesContent and the pure annotations through', () => {
    const options = getScriptBuildOptions(
      settings({ conditions: ['es2015', 'custom'], sourcesContent: false }),
      'browser'
    );

    expect(options).toMatchObject({
      conditions: ['es2015', 'custom'],
      sourcesContent: false,
      pure: ['forwardRef'],
    });
  });
});

describe('resolveScriptSettings', () => {
  it.each([
    [undefined, true],
    [true, true],
    [false, false],
    [{ scripts: false, styles: true }, false],
    [{ scripts: true }, true],
  ])('reads optimization %j as optimize: %s', (optimization, expected) => {
    const resolved = resolveScriptSettings({ optimization } as never, {});

    expect(resolved.optimize).toBe(expected);
  });

  it("honours the user's conditions", () => {
    const resolved = resolveScriptSettings({ conditions: ['custom'] } as never, {});

    expect(resolved.conditions.at(-1)).toBe('custom');
  });

  it('reads mangling from the given environment', () => {
    const resolved = resolveScriptSettings({} as never, {
      NG_BUILD_MANGLE: '0',
    });

    expect(resolved.allowMangle).toBe(false);
  });

  // Angular normalizes a single polyfill string into an array before isZonelessApp.
  it.each([
    [undefined, true],
    [['zone.js'], false],
    ['zone.js', false],
  ])('reads polyfills %j as zoneless: %s', (polyfills, expected) => {
    const resolved = resolveScriptSettings({ polyfills } as never, {});

    expect(resolved.zoneless).toBe(expected);
  });

  it.each([
    [undefined, false],
    [true, true],
    [{ scripts: true }, undefined],
    [{ scripts: true, sourcesContent: false }, false],
  ])('reads sourceMap %j as sourcesContent: %s', (sourceMap, expected) => {
    const resolved = resolveScriptSettings({ sourceMap } as never, {});

    expect(resolved.sourcesContent).toBe(expected);
  });
});
