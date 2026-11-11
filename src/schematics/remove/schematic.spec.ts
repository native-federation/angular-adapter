import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import remove from './schematic.js';

// Shape of a project right after `init`: the federation builder took over `build` and the
// original application builder (with polyfills) moved to `esbuild`.
function federatedWorkspace() {
  return {
    projects: {
      mfe1: {
        root: 'projects/mfe1',
        sourceRoot: 'projects/mfe1/src',
        architect: {
          build: {
            builder: '@angular-architects/native-federation:build',
            options: { target: 'mfe1:esbuild:production' },
          },
          esbuild: {
            builder: '@angular/build:application',
            options: {
              browser: 'projects/mfe1/src/main.ts',
              polyfills: ['zone.js', 'es-module-shims'],
            },
          },
          serve: {
            builder: '@angular-architects/native-federation:build',
            options: {},
          },
          'serve-original': {
            builder: '@angular/build:dev-server',
            configurations: {
              production: { buildTarget: 'mfe1:esbuild:production' },
              development: { buildTarget: 'mfe1:esbuild:development' },
            },
          },
        },
      },
    },
  };
}

function withPolyfills(polyfills: string[]) {
  const workspace = federatedWorkspace();
  workspace.projects.mfe1.architect.esbuild.options.polyfills = polyfills;
  return JSON.stringify(workspace);
}

async function run(tree: Tree) {
  const rule = remove({ project: 'mfe1' } as never);
  await (rule as (t: Tree) => Promise<unknown>)(tree);
  return JSON.parse(tree.readText('angular.json'));
}

describe('remove', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = new EmptyTree();
    tree.create('angular.json', JSON.stringify(federatedWorkspace()));
  });

  it('restores the original build target without es-module-shims', async () => {
    const { architect } = (await run(tree)).projects.mfe1;

    expect(architect.esbuild).toBeUndefined();
    expect(architect.build.builder).toBe('@angular/build:application');
    expect(architect.build.options.polyfills).toEqual(['zone.js']);
  });

  it('points serve back at the build target', async () => {
    const { architect } = (await run(tree)).projects.mfe1;

    expect(architect.serve.builder).toBe('@angular/build:dev-server');
    expect(architect.serve.configurations.production.buildTarget).toBe(
      'mfe1:build:production',
    );
  });

  // A zoneless app only had es-module-shims, which init added; leave no empty array behind.
  it('drops the polyfills option once es-module-shims was the only entry', async () => {
    tree.overwrite('angular.json', withPolyfills(['es-module-shims']));

    const { architect } = (await run(tree)).projects.mfe1;

    expect(architect.build.options).not.toHaveProperty('polyfills');
  });
});
