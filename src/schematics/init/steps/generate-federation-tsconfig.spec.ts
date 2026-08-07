import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import { generateFederationTsConfig } from './generate-federation-tsconfig.js';
import type { NormalizedOptions } from './normalize-options.js';

function makeOptions(overrides: Partial<NormalizedOptions> = {}): NormalizedOptions {
  return {
    polyfills: [] as unknown as string,
    projectName: 'mfe1',
    projectRoot: 'projects/mfe1',
    projectSourceRoot: 'projects/mfe1/src',
    manifestPath: '',
    manifestRelPath: '',
    main: 'projects/mfe1/src/main.ts',
    port: 4200,
    projectConfig: {
      architect: {
        build: {
          builder: '@angular/build:application',
          options: { tsConfig: 'projects/mfe1/tsconfig.app.json' },
        },
      },
    },
    ...overrides,
  };
}

function read(tree: Tree, path: string) {
  return JSON.parse(tree.read(path)!.toString('utf8'));
}

describe('generateFederationTsConfig', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = new EmptyTree();
  });

  it('creates a federation tsconfig extending the app tsconfig', () => {
    const result = generateFederationTsConfig(tree, makeOptions());

    expect(result).toBe('projects/mfe1/tsconfig.federation.json');
    expect(read(tree, result)).toEqual({
      extends: './tsconfig.app.json',
      files: [],
      include: ['src/**/*.d.ts'],
    });
  });

  it('derives the include glob from the project source root', () => {
    const result = generateFederationTsConfig(
      tree,
      makeOptions({ projectSourceRoot: 'projects/mfe1/app-src' })
    );

    expect(read(tree, result).include).toEqual(['app-src/**/*.d.ts']);
  });

  it('points extends at a tsconfig that lives outside the project root', () => {
    const result = generateFederationTsConfig(
      tree,
      makeOptions({
        projectConfig: {
          architect: {
            build: {
              builder: '@angular/build:application',
              options: { tsConfig: 'tsconfig.app.json' },
            },
          },
        },
      })
    );

    expect(read(tree, result).extends).toBe('../../tsconfig.app.json');
  });

  it('leaves an existing federation tsconfig untouched', () => {
    tree.create('projects/mfe1/tsconfig.federation.json', '{ "files": ["src/bootstrap.ts"] }');

    const result = generateFederationTsConfig(tree, makeOptions());

    expect(read(tree, result)).toEqual({ files: ['src/bootstrap.ts'] });
  });

  it('does nothing when the project is already on the federation builder', () => {
    const options = makeOptions();
    options.projectConfig.architect.build.builder = '@angular-architects/native-federation:build';

    const result = generateFederationTsConfig(tree, options);

    expect(tree.exists(result)).toBe(false);
  });

  // esbuild is where a previous run parked the original build target.
  it('falls back to the esbuild target tsConfig', () => {
    const result = generateFederationTsConfig(
      tree,
      makeOptions({
        projectConfig: {
          architect: {
            build: { builder: '@angular/build:application', options: {} },
            esbuild: { options: { tsConfig: 'projects/mfe1/tsconfig.app.json' } },
          },
        },
      })
    );

    expect(read(tree, result).extends).toBe('./tsconfig.app.json');
  });

  it('throws when no tsConfig can be found', () => {
    expect(() =>
      generateFederationTsConfig(
        tree,
        makeOptions({
          projectConfig: {
            architect: { build: { builder: '@angular/build:application', options: {} } },
          },
        })
      )
    ).toThrow('has no tsConfig');
  });
});
