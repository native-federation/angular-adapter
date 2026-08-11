import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import { generateFederationTsConfig } from './generate-federation-tsconfig.js';
import type { NormalizedOptions } from './normalize-options.js';

const EXPOSED = ['projects/mfe1/src/app/app.ts'];

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
    const result = generateFederationTsConfig(tree, makeOptions(), EXPOSED);

    expect(result).toBe('projects/mfe1/tsconfig.federation.json');
    expect(read(tree, result)).toEqual({
      extends: './tsconfig.app.json',
      files: ['src/app/app.ts'],
      include: ['src/**/*.d.ts'],
    });
  });

  // An empty `files` list is a TypeScript error (TS18002) unless the config also extends
  // another one, so neither key may be dropped from the generated shape.
  it('always emits both extends and a non-empty files list', () => {
    const result = generateFederationTsConfig(tree, makeOptions(), [
      'projects/mfe1/src/main.ts',
    ]);

    const tsconfig = read(tree, result);
    expect(tsconfig.extends).toBeTruthy();
    expect(tsconfig.files).toEqual(['src/main.ts']);
  });

  it('derives the include glob from the project source root', () => {
    const result = generateFederationTsConfig(
      tree,
      makeOptions({ projectSourceRoot: 'projects/mfe1/app-src' }),
      EXPOSED
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
      }),
      EXPOSED
    );

    expect(read(tree, result).extends).toBe('../../tsconfig.app.json');
  });

  it('leaves an existing federation tsconfig untouched', () => {
    tree.create('projects/mfe1/tsconfig.federation.json', '{ "files": ["src/bootstrap.ts"] }');

    const result = generateFederationTsConfig(tree, makeOptions(), EXPOSED);

    expect(read(tree, result)).toEqual({ files: ['src/bootstrap.ts'] });
  });

  it('does nothing when the project is already on the federation builder', () => {
    const options = makeOptions();
    options.projectConfig.architect.build.builder = '@angular-architects/native-federation:build';

    const result = generateFederationTsConfig(tree, options, EXPOSED);

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
      }),
      EXPOSED
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
        }),
        EXPOSED
      )
    ).toThrow('has no tsConfig');
  });
});
