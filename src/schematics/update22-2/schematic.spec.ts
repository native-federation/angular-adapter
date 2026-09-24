import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import update22_2 from './schematic.js';

const NF_BUILDER = '@angular-architects/native-federation:build';

function seed(tree: Tree, projects: Record<string, { root: string }>) {
  const workspace = { projects: {} as Record<string, unknown> };
  for (const [name, { root }] of Object.entries(projects)) {
    workspace.projects[name] = { root, architect: { build: { builder: NF_BUILDER } } };
  }
  tree.create('angular.json', JSON.stringify(workspace));
}

function read(tree: Tree, path: string) {
  return tree.read(path)!.toString('utf8');
}

describe('update22-2 — drop files from tsconfig.federation.json', () => {
  let tree: Tree;
  let context: { logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    tree = new EmptyTree();
    context = { logger: { info: vi.fn(), warn: vi.fn() } };
  });

  // The shape the init/update22 schematics wrote before 22.2.
  it('removes files and keeps the rest', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    tree.create(
      'projects/mfe1/tsconfig.federation.json',
      JSON.stringify(
        {
          extends: './tsconfig.app.json',
          files: ['src/main.ts'],
          include: ['src/**/*.d.ts'],
        },
        null,
        2
      )
    );

    await update22_2()(tree, context as never);

    expect(JSON.parse(read(tree, 'projects/mfe1/tsconfig.federation.json'))).toEqual({
      extends: './tsconfig.app.json',
      include: ['src/**/*.d.ts'],
    });
  });

  // tsconfigs are JSONC; a JSON.parse/stringify round trip would drop the user's comments.
  it('keeps comments in place', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    tree.create(
      'projects/mfe1/tsconfig.federation.json',
      [
        '{',
        '  // compiled by the federation build',
        '  "extends": "./tsconfig.app.json",',
        '  "files": [',
        '    "src/main.ts"',
        '  ],',
        '  "include": ["src/**/*.d.ts"],',
        '}',
      ].join('\n')
    );

    await update22_2()(tree, context as never);

    const text = read(tree, 'projects/mfe1/tsconfig.federation.json');
    expect(text).toContain('// compiled by the federation build');
    expect(text).not.toContain('"files"');
    expect(text).toContain('"include": ["src/**/*.d.ts"]');
  });

  it('covers every project, including one at the workspace root', async () => {
    seed(tree, { host: { root: '' }, mfe1: { root: 'projects/mfe1' } });
    tree.create('tsconfig.federation.json', '{ "files": ["src/main.ts"] }');
    tree.create('projects/mfe1/tsconfig.federation.json', '{ "files": ["src/main.ts"] }');

    await update22_2()(tree, context as never);

    expect(JSON.parse(read(tree, 'tsconfig.federation.json'))).toEqual({});
    expect(JSON.parse(read(tree, 'projects/mfe1/tsconfig.federation.json'))).toEqual({});
  });

  it('leaves a federation tsconfig without files byte-for-byte alone', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    const original = '{\n  "extends": "./tsconfig.app.json" // unchanged\n}\n';
    tree.create('projects/mfe1/tsconfig.federation.json', original);

    await update22_2()(tree, context as never);

    expect(read(tree, 'projects/mfe1/tsconfig.federation.json')).toBe(original);
  });

  // Only the file the schematics generate is ours; tsconfig.app.json's `files` is Angular's.
  it('never touches other tsconfigs', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    const app = '{ "files": ["src/main.ts"] }';
    tree.create('projects/mfe1/tsconfig.app.json', app);

    await update22_2()(tree, context as never);

    expect(read(tree, 'projects/mfe1/tsconfig.app.json')).toBe(app);
  });

  it('skips a tsconfig it cannot parse, with a warning', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    const broken = '{ "files": ["src/main.ts" ';
    tree.create('projects/mfe1/tsconfig.federation.json', broken);

    await update22_2()(tree, context as never);

    expect(read(tree, 'projects/mfe1/tsconfig.federation.json')).toBe(broken);
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Remove its "files" by hand/)
    );
  });

  it('is idempotent', async () => {
    seed(tree, { mfe1: { root: 'projects/mfe1' } });
    tree.create('projects/mfe1/tsconfig.federation.json', '{ "files": [], "include": [] }');

    await update22_2()(tree, context as never);
    const afterFirst = read(tree, 'projects/mfe1/tsconfig.federation.json');
    await update22_2()(tree, context as never);

    expect(read(tree, 'projects/mfe1/tsconfig.federation.json')).toBe(afterFirst);
  });
});
