import * as path from 'path';

import { resolveBrowserOutputPath } from './output-path.js';

describe('resolveBrowserOutputPath', () => {
  it('defaults to dist/<project>/browser', () => {
    expect(resolveBrowserOutputPath(undefined, 'mfe1')).toBe(path.join('dist/mfe1/browser'));
  });

  // Existing string configs must not move their output (#188).
  it('appends browser to a string outputPath', () => {
    expect(resolveBrowserOutputPath('dist/apps/mfe1', 'mfe1')).toBe(
      path.join('dist/apps/mfe1/browser')
    );
  });

  it('defaults browser to "browser" in the object form, as Angular does', () => {
    expect(resolveBrowserOutputPath({ base: 'dist/apps/mfe1' }, 'mfe1')).toBe(
      path.join('dist/apps/mfe1/browser')
    );
  });

  // `browser: ''` must not be treated as missing: it writes straight into base, like
  // the build builder does for Angular's `outputPath: { base, browser: '' }` (#188).
  it('writes directly into base when browser is empty', () => {
    expect(resolveBrowserOutputPath({ base: 'dist/apps/mfe1', browser: '' }, 'mfe1')).toBe(
      path.join('dist/apps/mfe1')
    );
  });
});
