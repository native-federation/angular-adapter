import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import update22 from './schematic.js';

const NF_BUILDER = '@angular-architects/native-federation:build';

// A project as the init schematic left it before v22.1.1: NF build/serve targets with no
// tsConfig, and the original application builder parked under `esbuild`.
function makeWorkspace(overrides: Record<string, any> = {}) {
  return {
    projects: {
      mfe1: {
        root: 'projects/mfe1',
        sourceRoot: 'projects/mfe1/src',
        architect: {
          build: { builder: NF_BUILDER, options: { cacheExternalArtifacts: true } },
          esbuild: {
            builder: '@angular/build:application',
            options: {
              browser: 'projects/mfe1/src/main.ts',
              tsConfig: 'projects/mfe1/tsconfig.app.json',
            },
          },
          serve: { builder: NF_BUILDER, options: { target: 'mfe1:serve-original:development' } },
        },
        ...overrides,
      },
    },
  };
}

function seed(tree: Tree, workspace: unknown) {
  tree.create('angular.json', JSON.stringify(workspace));
  return tree;
}

function readJson(tree: Tree, path: string) {
  return JSON.parse(tree.read(path)!.toString('utf8'));
}

function architect(tree: Tree, project = 'mfe1') {
  return readJson(tree, 'angular.json').projects[project].architect;
}

describe('update22 — federation tsconfig', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = new EmptyTree();
  });

  it('generates the federation tsconfig and wires every NF target to it', async () => {
    seed(tree, makeWorkspace());

    await update22()(tree, {} as never);

    expect(readJson(tree, 'projects/mfe1/tsconfig.federation.json')).toEqual({
      extends: './tsconfig.app.json',
      files: ['src/main.ts'],
      include: ['src/**/*.d.ts'],
    });

    const targets = architect(tree);
    expect(targets.build.options.tsConfig).toBe('projects/mfe1/tsconfig.federation.json');
    expect(targets.serve.options.tsConfig).toBe('projects/mfe1/tsconfig.federation.json');
    // Untouched: the app build keeps compiling against its own tsconfig.
    expect(targets.esbuild.options.tsConfig).toBe('projects/mfe1/tsconfig.app.json');
  });

  it('is idempotent', async () => {
    seed(tree, makeWorkspace());

    await update22()(tree, {} as never);
    const afterFirst = readJson(tree, 'angular.json');

    // The second run must not throw on the tsconfig it already created.
    await update22()(tree, {} as never);

    expect(readJson(tree, 'angular.json')).toEqual(afterFirst);
  });

  it('keeps a tsConfig the target already declares', async () => {
    const workspace = makeWorkspace();
    workspace.projects.mfe1.architect.build.options.tsConfig = 'projects/mfe1/custom.json';
    seed(tree, workspace);

    await update22()(tree, {} as never);

    expect(architect(tree).build.options.tsConfig).toBe('projects/mfe1/custom.json');
  });

  it('leaves an existing federation tsconfig alone but still wires it up', async () => {
    seed(tree, makeWorkspace());
    tree.create('projects/mfe1/tsconfig.federation.json', '{ "files": ["src/bootstrap.ts"] }');

    await update22()(tree, {} as never);

    expect(readJson(tree, 'projects/mfe1/tsconfig.federation.json')).toEqual({
      files: ['src/bootstrap.ts'],
    });
    expect(architect(tree).build.options.tsConfig).toBe('projects/mfe1/tsconfig.federation.json');
  });

  it('skips projects that are not federated', async () => {
    seed(tree, {
      projects: {
        app: {
          root: 'projects/app',
          sourceRoot: 'projects/app/src',
          architect: {
            build: {
              builder: '@angular/build:application',
              options: { tsConfig: 'projects/app/tsconfig.app.json' },
            },
          },
        },
      },
    });

    await update22()(tree, {} as never);

    expect(tree.exists('projects/app/tsconfig.federation.json')).toBe(false);
  });
});
