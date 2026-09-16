import { SchematicsException, type Rule, type Tree } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';
import type { NormalizedOptions } from './normalize-options.js';
import { importSpecifier, resolveAppComponent } from './resolve-app-component.js';
import * as path from 'path';

// The adapter's `initFederation` wrapper hides shimMode/logger/storage, so
// generated apps don't ship internal orchestrator options or `logLevel: 'debug'`.
const FEDERATION_IMPORT = `import { initFederation } from '@angular-architects/native-federation';`;

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
  createApplication(appConfig).then(({ injector }) => {
    customElements.define(
      '${tag}', // your componentname
      createCustomElement(${className}, { injector }),
    );
  });
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
  remoteMap: unknown
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

    if (tree.exists(bootstrapPath)) {
      if (options.webcomponent) {
        console.warn(`${bootstrapPath} already exists; --webcomponent left it untouched.`);
      }
      if (!alreadyFederated) {
        console.warn(
          `${bootstrapPath} already exists; the previous contents of ${main} were discarded.`
        );
      }
    } else if (options.webcomponent) {
      const refs = resolveAppRefs(
        tree,
        normalized,
        `--webcomponent needs to generate ${bootstrapPath}`
      );
      tree.create(bootstrapPath, webComponentBootstrap(refs, customElementTag(projectName)));
    } else if (alreadyFederated) {
      const refs = resolveAppRefs(
        tree,
        normalized,
        `${main} is already federated but ${bootstrapPath} is missing, so it has to be regenerated`
      );
      tree.create(bootstrapPath, defaultBootstrap(refs));
    } else {
      tree.create(bootstrapPath, mainContent);
    }

    tree.overwrite(main, mainStub(options, remoteMap, manifestRelPath));
  };
}
