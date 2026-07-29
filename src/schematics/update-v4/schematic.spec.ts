import { HostTree, type SchematicContext } from '@angular-devkit/schematics';

import updateV4 from './schematic.js';

const V4_CONFIG_IMPORT =
  "import { withNativeFederation, shareAll } from '@angular-architects/native-federation-v4/config';";

describe('update-v4 schematic', () => {
  let tree: HostTree;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    tree = new HostTree();
    tree.create(
      'angular.json',
      JSON.stringify({
        projects: {
          shell: { root: '', sourceRoot: 'src', architect: {} },
        },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runSchematic(): Promise<void> {
    await updateV4({ project: 'shell' })(tree, {} as SchematicContext);
  }

  it('migrates a CJS federation.config.js to ESM with a single -v4 suffix', async () => {
    tree.create(
      'federation.config.js',
      [
        "const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');",
        '',
        'module.exports = withNativeFederation({',
        "  name: 'shell',",
        '  shared: {',
        '    ...shareAll({ singleton: true }),',
        '  },',
        '});',
        '',
      ].join('\n')
    );

    await runSchematic();

    expect(tree.exists('federation.config.mjs')).toBe(true);
    const content = tree.readText('federation.config.mjs');
    expect(content).toContain(V4_CONFIG_IMPORT);
    expect(content).not.toContain('native-federation-v4-v4');
    expect(content).toContain('export default withNativeFederation({');
  });

  it('leaves an already-updated v4 require path untouched', async () => {
    tree.create(
      'federation.config.js',
      [
        "const { withNativeFederation, shareAll } = require('@angular-architects/native-federation-v4/config');",
        '',
        'module.exports = withNativeFederation({});',
        '',
      ].join('\n')
    );

    await runSchematic();

    expect(tree.exists('federation.config.mjs')).toBe(true);
    const content = tree.readText('federation.config.mjs');
    expect(content).toContain(V4_CONFIG_IMPORT);
    expect(content).not.toContain('native-federation-v4-v4');
  });
});
