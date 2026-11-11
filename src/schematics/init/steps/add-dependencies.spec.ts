import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import { readFileSync } from 'node:fs';

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

  // A lower range than the adapter's own lets an existing lockfile keep an orchestrator that
  // rejects the adapter's core as a peer, installing two copies side by side.
  it('pins the orchestrator to the range the adapter itself depends on', () => {
    const adapterPkg = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
    );
    tree.overwrite(
      'package.json',
      JSON.stringify({ devDependencies: { '@softarc/native-federation-orchestrator': '^4.0.0' } })
    );

    addDependencies(tree, CONTEXT, { ssr: false, webcomponent: false });

    expect(packageJson(tree).devDependencies['@softarc/native-federation-orchestrator']).toBe(
      adapterPkg.dependencies['@softarc/native-federation-orchestrator']
    );
  });
});
