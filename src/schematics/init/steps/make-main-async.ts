import { SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import type { NormalizedOptions } from './normalize-options.js';
import { importSpecifier, resolveAppComponent } from './resolve-app-component.js';
import * as path from 'path';

// The adapter's `initFederation` wrapper hides shimMode/logger/storage, so
// generated apps don't ship internal orchestrator options or `logLevel: 'debug'`.
const FEDERATION_IMPORT = `import { initFederation } from '@angular-architects/native-federation-v4';`;

// Set once makeMainAsync has actually written a custom element bootstrap, so
// addDependencies can skip @angular/elements when the flag turned out to be a no-op.
export type WebComponentOutcome = { generated: boolean };

function getFederationArg(
  options: NfSchematicSchema,
  remoteMap: unknown,
  manifestRelPath: string
): string {
  switch (options.type) {
    case 'dynamic-host':
      return `'${manifestRelPath}'`;
    case 'host':
      return JSON.stringify(remoteMap, null, 2).replace(/"/g, "'");
    default:
      return `{}`;
  }
}

function mainStub(options: NfSchematicSchema, remoteMap: unknown, manifestRelPath: string): string {
  return `${FEDERATION_IMPORT}

initFederation(${getFederationArg(options, remoteMap, manifestRelPath)}, {
  hostRemoteEntry: { url: "./remoteEntry.json" }
})
  .catch(err => console.error(err))
  .then(_ => import('./bootstrap'))
  .catch(err => console.error(err));
`;
}

type AppRefs = {
  className: string;
  component: string;
  config: string;
};

function resolveAppRefs(tree: Tree, normalized: NormalizedOptions, reason: string): AppRefs {
  const { projectSourceRoot, main } = normalized;

  const appComponent = resolveAppComponent(tree, projectSourceRoot);
  const configPath = path.join(projectSourceRoot, 'app', 'app.config.ts').replace(/\\/g, '/');

  if (!appComponent || !tree.exists(configPath)) {
    throw new SchematicsException(
      `${reason}, but its root component or app.config.ts could not be found under ` +
        `${projectSourceRoot}/app. Create bootstrap.ts by hand and re-run.`
    );
  }

  if (!appComponent.className) {
    throw new SchematicsException(
      `${reason}, but no exported component class could be read from ${appComponent.path}. ` +
        `Create bootstrap.ts by hand and re-run.`
    );
  }

  const mainDir = path.dirname(main);

  return {
    className: appComponent.className,
    component: importSpecifier(mainDir, appComponent.path),
    config: importSpecifier(mainDir, configPath),
  };
}

function defaultBootstrap({ className, component, config }: AppRefs): string {
  return `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from '${config}';
import { ${className} } from '${component}';

(() => {
  bootstrapApplication(${className}, appConfig).catch((err) =>
    console.error(err),
  );
})();
`;
}

function webComponentBootstrap({ className, component, config }: AppRefs, tag: string): string {
  return `import { createApplication } from '@angular/platform-browser';
import { appConfig } from '${config}';
import { ${className} } from '${component}';
import { createCustomElement } from '@angular/elements';

(() => {
  createApplication(appConfig)
    .then(({ injector }) => {
      customElements.define(
        '${tag}', // your componentname
        createCustomElement(${className}, { injector }),
      );
    })
    .catch((err) => console.error(err));
})();
`;
}

// Custom element names must contain a hyphen, which a one-word project name does not.
export function customElementTag(projectName: string): string {
  const slug = projectName
    .replace(/^@/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');

  return `mfe-${slug || 'remote'}`;
}

export function makeMainAsync(
  normalized: NormalizedOptions,
  options: NfSchematicSchema,
  remoteMap: unknown,
  webComponent: WebComponentOutcome = { generated: false }
): Rule {
  return async function (tree: Tree) {
    const { main, manifestRelPath, projectName } = normalized;

    if (!tree.exists(main)) {
      throw new SchematicsException(
        `${main} does not exist. The build target of '${projectName}' points its entry point ` +
          `(options.browser or options.main) at a file that is not in the workspace.`
      );
    }

    const mainContent = tree.readText(main);

    // What belongs in bootstrap.ts follows from main.ts's own content, not from whether
    // bootstrap.ts happens to exist: keying on the latter copied the stub into bootstrap.ts
    // whenever it had gone missing, leaving bootstrap.ts importing itself.
    const alreadyFederated = mainContent.includes('initFederation');
    const bootstrapPath = path.join(path.dirname(main), 'bootstrap.ts').replace(/\\/g, '/');
    const bootstrapExists = tree.exists(bootstrapPath);

    function createBootstrap(reason: string): void {
      const refs = resolveAppRefs(tree, normalized, reason);

      if (options.webcomponent) {
        tree.create(bootstrapPath, webComponentBootstrap(refs, customElementTag(projectName)));
        webComponent.generated = true;
      } else {
        tree.create(bootstrapPath, defaultBootstrap(refs));
      }
    }

    if (alreadyFederated) {
      // main.ts is already the stub. Rewriting it would revert hand edits to the
      // initFederation call (extra remotes, `shimMode: false` for #70), so it stays as is.
      if (!bootstrapExists) {
        createBootstrap(
          `${main} is already federated but ${bootstrapPath} is missing, so it has to be regenerated`
        );
      } else if (options.webcomponent) {
        console.warn(`${bootstrapPath} already exists; --webcomponent left it untouched.`);
      }

      if (options.type === 'host') {
        console.warn(
          `${main} already calls initFederation and was left as is; its remote map was not ` +
            `refreshed, so add new remotes to it by hand.`
        );
      }
      return;
    }

    // Past here main.ts is replaced by the stub, so whatever it holds now has to end up
    // in bootstrap.ts — and there is only one bootstrap.ts to put it in.
    if (bootstrapExists) {
      throw new SchematicsException(
        `${bootstrapPath} already exists and ${main} does not call initFederation, so there is ` +
          `nowhere to move the contents of ${main}. Merge them into ${bootstrapPath} by hand ` +
          `(or delete ${bootstrapPath}) and re-run.`
      );
    }

    if (options.webcomponent) {
      createBootstrap(`--webcomponent needs to generate ${bootstrapPath}`);
      console.warn(
        `${main} was replaced by the generated custom element bootstrap in ${bootstrapPath}; ` +
          `its previous contents were not kept.`
      );
    } else {
      tree.create(bootstrapPath, mainContent);
    }

    tree.overwrite(main, mainStub(options, remoteMap, manifestRelPath));
  };
}
