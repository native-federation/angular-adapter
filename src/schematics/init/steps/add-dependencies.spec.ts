import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import { addDependencies } from './add-dependencies.js';

const CONTEXT = { addTask: () => undefined } as never;

function packageJson(tree: Tree) {
  return JSON.parse(tree.readText('package.json'));
}

describe('addDependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = new EmptyTree();
    tree.create(
      'package.json',
      JSON.stringify({ dependencies: { '@angular/core': '^22.1.0' } }, null, 2)
    );
  });

  it('leaves @angular/elements out unless --webcomponent was passed', () => {
    addDependencies(tree, CONTEXT, { ssr: false, webcomponent: false });

    expect(packageJson(tree).dependencies['@angular/elements']).toBeUndefined();
  });

  // @angular/elements is versioned in lockstep with the framework, so a floating
  // range would pull a major that does not match the workspace.
  it('pins @angular/elements to the installed @angular/core range', () => {
    addDependencies(tree, CONTEXT, { ssr: false, webcomponent: true });

    expect(packageJson(tree).dependencies['@angular/elements']).toBe('^22.1.0');
  });

  it('falls back to a devDependency on @angular/core', () => {
    tree.overwrite(
      'package.json',
      JSON.stringify({ devDependencies: { '@angular/core': '^21.0.0' } })
    );

    addDependencies(tree, CONTEXT, { ssr: false, webcomponent: true });

    expect(packageJson(tree).dependencies['@angular/elements']).toBe('^21.0.0');
  });

  it('throws when the workspace has no @angular/core to match', () => {
    tree.overwrite('package.json', JSON.stringify({ dependencies: {} }));

    expect(() => addDependencies(tree, CONTEXT, { ssr: false, webcomponent: true })).toThrow(
      /@angular\/core is not a dependency/
    );
  });
});
