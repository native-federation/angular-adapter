import { logger } from '@softarc/native-federation/internal';

import { checkForInvalidImports } from './check-for-invalid-imports.js';

describe('checkForInvalidImports', () => {
  const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

  afterEach(() => {
    warnSpy.mockClear();
    debugSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('allows common import paths without throwing', () => {
    const imports = [
      'rxjs',
      '@angular/core',
      '@angular/common/http',
      // plain package with a dot in its name
      'chart.js',
      // secondary entry points of packages whose name contains a dot
      'chart.js/auto',
      'chart.js/helpers',
      'd3-scale/src/index.js',
      './polyfills.ts',
      './data.json',
      'my-lib/runtime.mjs',
      'my-lib/chunk.js?v=1',
      'my-lib/chunk.ts#fragment',
    ];

    expect(() => checkForInvalidImports(imports, 'externals')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('throws for invalid dot imports and logs warnings', () => {
    const imports = ['lodash.merge', '@scope/lib.v2'];

    expect(() => checkForInvalidImports(imports, 'shared mappings')).toThrow(
      "Invalid 'shared mappings' config. Invalid imports paths detected, consider using a barrel import instead. "
    );
    expect(warnSpy).toHaveBeenCalledTimes(imports.length);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Import 'lodash.merge' contains a bad dot (.) import."
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Import '@scope/lib.v2' contains a bad dot (.) import."
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Bad import issue: https://github.com/vitejs/vite/issues/21036'
    );
  });
});
