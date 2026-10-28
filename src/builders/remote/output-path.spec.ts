import * as path from 'path';

import { deleteOutputDir } from '@angular/build/private';

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

  // The object form makes the workspace root reachable as an output folder; the builder
  // relies on Angular's deleteOutputDir to refuse clearing it.
  it('cannot clear the workspace root through deleteOutputDir', async () => {
    const root = path.resolve('/workspace');
    const output = resolveBrowserOutputPath({ base: '.', browser: '' }, 'mfe1');

    await expect(deleteOutputDir(root, output)).rejects.toThrow(
      'Output path MUST not be project root directory!'
    );
  });
});
