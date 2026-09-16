import { EmptyTree, type Tree } from '@angular-devkit/schematics';

import { makeMainAsync } from './make-main-async.js';
import type { NormalizedOptions } from './normalize-options.js';
import type { NfSchematicSchema } from '../schema.js';

const MAIN = 'projects/mfe1/src/main.ts';
const BOOTSTRAP = 'projects/mfe1/src/bootstrap.ts';

// Verbatim `ng new` output on Angular 22 (see src/app/app.ts, src/main.ts of a fresh workspace).
const SCAFFOLD_MAIN = `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
`;

const SCAFFOLD_APP = `import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('test-app');
}
`;

const SCAFFOLD_CONFIG = `import { ApplicationConfig } from '@angular/core';

export const appConfig: ApplicationConfig = { providers: [] };
`;

function makeOptions(overrides: Partial<NormalizedOptions> = {}): NormalizedOptions {
  return {
    polyfills: [] as unknown as string,
    projectName: 'mfe1',
    projectRoot: 'projects/mfe1',
    projectSourceRoot: 'projects/mfe1/src',
    manifestPath: 'projects/mfe1/public/federation.manifest.json',
    manifestRelPath: 'federation.manifest.json',
    main: MAIN,
    port: 4200,
    projectConfig: {},
    ...overrides,
  };
}

function scaffold(tree: Tree) {
  tree.create(MAIN, SCAFFOLD_MAIN);
  tree.create('projects/mfe1/src/app/app.ts', SCAFFOLD_APP);
  tree.create('projects/mfe1/src/app/app.config.ts', SCAFFOLD_CONFIG);
}

function run(
  tree: Tree,
  schema: Partial<NfSchematicSchema> = {},
  normalized: Partial<NormalizedOptions> = {}
) {
  const options = { project: 'mfe1', port: '4200', type: 'remote', ...schema } as NfSchematicSchema;
  const remoteMap = { mfe2: 'http://x/remoteEntry.json' };
  const rule = makeMainAsync(makeOptions(normalized), options, remoteMap);
  return (rule as (t: Tree) => Promise<void>)(tree);
}

describe('makeMainAsync', () => {
  let tree: Tree;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tree = new EmptyTree();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it('moves an unfederated main.ts into bootstrap.ts and stubs main.ts', async () => {
    tree.create(MAIN, SCAFFOLD_MAIN);

    await run(tree);

    expect(tree.readText(BOOTSTRAP)).toBe(SCAFFOLD_MAIN);
    expect(tree.readText(MAIN)).toContain('initFederation');
    expect(tree.readText(MAIN)).toContain(`import('./bootstrap')`);
    expect(warn).not.toHaveBeenCalled();
  });

  // The old guard keyed on bootstrap.ts existing and returned early, leaving main.ts
  // unfederated while every other init step had already been applied.
  it('still stubs main.ts when bootstrap.ts already exists', async () => {
    tree.create(MAIN, SCAFFOLD_MAIN);
    tree.create(BOOTSTRAP, `console.log('hand written');\n`);

    await run(tree);

    expect(tree.readText(BOOTSTRAP)).toBe(`console.log('hand written');\n`);
    expect(tree.readText(MAIN)).toContain('initFederation');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('were discarded'));
  });

  // Previously this copied the stub into bootstrap.ts, so bootstrap.ts imported itself.
  it('regenerates a bootstrap.ts when main.ts is already federated', async () => {
    scaffold(tree);
    await run(tree);
    tree.delete(BOOTSTRAP);

    await run(tree);

    const bootstrap = tree.readText(BOOTSTRAP);
    expect(bootstrap).not.toContain('initFederation');
    expect(bootstrap).toContain(`import { App } from './app/app';`);
    expect(bootstrap).toContain(`import { appConfig } from './app/app.config';`);
    expect(bootstrap).toContain('bootstrapApplication(App, appConfig)');
  });

  it('resolves the pre-v20 app.component.ts naming', async () => {
    tree.create(MAIN, SCAFFOLD_MAIN);
    tree.create(
      'projects/mfe1/src/app/app.component.ts',
      SCAFFOLD_APP.replace('export class App ', 'export class AppComponent ')
    );
    tree.create('projects/mfe1/src/app/app.config.ts', SCAFFOLD_CONFIG);

    await run(tree);
    tree.delete(BOOTSTRAP);
    await run(tree);

    expect(tree.readText(BOOTSTRAP)).toContain(
      `import { AppComponent } from './app/app.component';`
    );
    expect(tree.readText(BOOTSTRAP)).toContain('bootstrapApplication(AppComponent, appConfig)');
  });

  it('is idempotent across re-runs', async () => {
    scaffold(tree);
    await run(tree);

    const bootstrap = tree.readText(BOOTSTRAP);
    const main = tree.readText(MAIN);

    await run(tree);

    expect(tree.readText(BOOTSTRAP)).toBe(bootstrap);
    expect(tree.readText(MAIN)).toBe(main);
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws when the build entry point is not in the workspace', async () => {
    await expect(run(tree)).rejects.toThrow(/does not exist/);
  });

  describe('the federation argument', () => {
    it.each([
      ['remote', '{}'],
      ['host', `'mfe2': 'http://x/remoteEntry.json'`],
      ['dynamic-host', `'federation.manifest.json'`],
    ])('%s', async (type, expected) => {
      tree.create(MAIN, SCAFFOLD_MAIN);

      await run(tree, { type: type as NfSchematicSchema['type'] });

      expect(tree.readText(MAIN)).toContain(expected);
    });
  });
});
