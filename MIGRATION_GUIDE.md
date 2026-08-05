# Migration guide

The goal of this small guide is to show the major differences between the previous Native Federation major (v3, Angular ≤ 21) and the new ESM-based major (Angular 22+). It expects a (monorepo) setup that contains 1 or multiple Angular micro frontends.

> [!TIP]
> Prefer to let the tooling do the work? Running `ng update` applies most of these changes automatically — its `update22` migration converts your federation config to ESM and updates the builder references for you:
>
> ```bash
> ng update @angular-architects/native-federation
> ```
>
> Already updated to the newest version? Just run the schematics!
>
> ```bash
> ng update @angular-architects/native-federation --migrate-only --name update22
> ```

The migration involves changing 4 files:

```
📁 /
├── 📄 package.json                     // Enabling ESM
├── 📄 angular.json                     // Updating the builder options
└── 📁 projects/
    └── 📁 <your-project>/
        ├── 📄 federation.config.mjs    // Renamed to federation.config.mjs & switch from commonJS to ESM
        └── 📁 src/
            └── 📄 main.ts              // optionally: switching to the orchestrator
```

## 0. Removing cache

Just to be sure, delete these folders to avoid corrupted caches:

```
📁 /
├── 📁 .angular/            // Angular cache
├── 📁 dist/                // Previously bundled artifacts
└── 📁 node_modules/
    └── 📁 .cache/          // Native federation cache
```

## 1. Updating the package.json

The first step is to update the `package.json` to install the new packages:

```json
{
  "name": "mfe-test",
  "version": "1.2.3",
  "scripts": {
    "ng": "ng"
  },
  "private": true,
  "dependencies": {
    // [...] Your dependencies
  },
  "devDependencies": {
    "@angular-architects/native-federation": "~22.1.0",
    "@softarc/native-federation": "~4.4.0",
    "@softarc/native-federation-orchestrator": "^4.6.0"
  }
}
```

## 2. Updating the federation.config.js

The `federation.config.js` contains all native-federation related configuration. The `update22` migration renames it to `federation.config.mjs` and switches it from CommonJS to ESM for consistency. The builder still falls back to `federation.config.js` if no `.mjs` file is present.

**Before:**

```javascript
// Notice the require? we're going to change that for import!
const { withNativeFederation, share, shareAll } = require('@angular-architects/native-federation/config');

module.exports = withNativeFederation({

  name: 'mfe1',

  exposes: {
    './Component': './projects/mfe1/src/bootstrap.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),

    // OLD: This example is only for setups that currently have a share after the shareAll.
    ...share({ "@angular/core": { singleton: true, strictVersion: true, requiredVersion: 'auto' }});
  },

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',
    // Add further packages you don't need at runtime
  ]

  // Please read our FAQ about sharing libs:
  // https://shorturl.at/jmzH0

});
```

**After:**

```javascript
// Our well-known ESM importing types
import {
  withNativeFederation,
  shareAll,
} from "@angular-architects/native-federation/config";

// change this line to the default export.
export default withNativeFederation({
  name: "team/mfe1",

  exposes: {
    "./Component": "./projects/mfe1/src/bootstrap.ts",
  },
  shared: {
    // This still works! But how about overrides?
    // ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),

    // Here's an alternative, you can merge the overrides _into_ the shareAll!
    ...shareAll(
      { singleton: true, strictVersion: true, requiredVersion: "auto" },
      {
        overrides: {
          "@angular/core": {
            singleton: true,
            strictVersion: true,
            requiredVersion: "auto",
            includeSecondaries: { keepAll: true },
          },
        },
      },
    ),
  },

  skip: ["rxjs/ajax", "rxjs/fetch", "rxjs/testing", "rxjs/webSocket"],

  features: {
    ignoreUnusedDeps: true, // Now enabled by default
    denseChunking: true, // Opt-in: groups chunks in remoteEntry.json for smaller file size
    denseExternals: true, // Opt-in: groups entrypoints by dependency for more performance and less crowded remoteEntry files.
    mappingVersion: true, // Now enabled by default
  },
});
```

### Optional: the config builders

Both halves of the config have a builder-style alternative to the `shareAll` + `skip` + `share` stack. `fromPackageJson` starts from your `package.json` dependencies, and `mappingsFromWorkspace` (new in `22.1.x`) starts from the workspace libraries in your root tsconfig's `compilerOptions.paths`. Written with both, the config above becomes:

```javascript
import {
  withNativeFederation,
  fromPackageJson,
  mappingsFromWorkspace,
} from "@angular-architects/native-federation/config";

export default withNativeFederation({
  name: "team/mfe1",

  exposes: {
    "./Component": "./projects/mfe1/src/bootstrap.ts",
  },

  // Same starting point as shareAll, but refined in place instead of spreading
  // a second share() over it. The Angular skip list is pre-seeded, so .skip()
  // only lists what is specific to your app.
  shared: fromPackageJson({
    singleton: true,
    strictVersion: true,
    requiredVersion: "auto",
  })
    .skip(["rxjs/ajax", "rxjs/fetch", "rxjs/testing", "rxjs/webSocket"])
    .patch(["@angular/core"], { includeSecondaries: { keepAll: true } })
    .get(),

  // Your workspace libs (@my-org/*), previously a plain string array.
  // Omit .filter() to share every mapped path — the same default as leaving
  // sharedMappings out entirely.
  sharedMappings: mappingsFromWorkspace({
    singleton: true,
    strictVersion: true,
  })
    .filter(["@my-org/ui/*", "@my-org/auth-lib"])
    .patch(["@my-org/ui/*"], { singleton: false })
    .get(),
});
```

Nothing is lost by not using them: each `.get()` returns exactly the object or array you could have written by hand, so the old forms keep working and the two styles can be mixed per project. See the README for the [shared builder](./README.md#building-the-shared-config-from-packagejson) and the [mappings builder](./README.md#configuring-shared-mappings).

## 3. Updating the angular.json

In the new version we're moving to an opt-in setup where the user (you) can customize and choose whatever features you prefer! All these options will be defined in the angular.json:

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "newProjectRoot": "projects",
  "projects": {
    "mfe1": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "style": "scss"
        }
      },
      "root": "projects/mfe1",
      "sourceRoot": "projects/mfe1/src",
      "prefix": "app",
      "architect": {
        "serve": {
          "builder": "@angular-architects/native-federation:build",
          "options": {
            "target": "mfe1:serve-original:development",
            "cacheExternalArtifacts": true, // Cache and re-use external bundled artifacts that don't change (e.g. RxJs) across builds
            "rebuildDelay": 500, // Allows for a grace period between builds when you develop; within this period it can cancel previous builds to save time (500/1000 is good)
            "integrity": true, // (optional) Adds Subresource Integration
            "dev": true,
            "port": 0
          }
        }
      }
    }
  }
}
```

> **Note:** Code-splitting (`chunks`) and dense chunking (`denseChunking`) are now configured in `federation.config.mjs` instead of the angular.json builder options. See the [README](./README.md#code-splitting-for-shared-dependencies) for details.

And that's it! Your micro frontend is migrated to the new major! We do have some optional improvements that can be nice:

## Optional: using the orchestrator instead

Here's the `projects/<your-project>/src/main.ts` you've been used to for the last couple of years (before v4). It now automatically bootstraps the new orchestrator:

```javascript
import { initFederation } from "@angular-architects/native-federation";

initFederation()
  .catch((err) => console.error(err))
  .then((_) => import("./bootstrap"))
  .catch((err) => console.error(err));
```

However, some projects still use the "legacy runtime" that did the job. But it lacks some modern features like dependency sharing based on a range, shareScopes, in-browser caching etc etc.

```javascript
import { initFederation } from "@softarc/native-federation-runtime"; // Default native-federation runtime

initFederation()
  .catch((err) => console.error(err))
  .then((_) => import("./bootstrap"))
  .catch((err) => console.error(err));
```

For optimal performance, from now on we recommend using the orchestrator directly:

```javascript
import {
  initFederation,
  NativeFederationResult,
} from "@softarc/native-federation-orchestrator";

const manifest = {
  mfe1: "http://localhost:4201/remoteEntry.json",
};

initFederation(manifest)
  .catch((err) => console.error(err))
  .then((_) => import("./bootstrap"))
  .catch((err) => console.error(err));
```

Not a lot of changes right? Sure, now you need to explicitly define the location of the manifest (or the object), but for the rest it's basically the same!

> **Note:** Since v4, the default `initFederation` library is the _orchestrator_, not the previously mentioned _runtime_.

Now, the big difference is that the new orchestrator is a _lot_ more customizable:

```javascript
import {
  initFederation,
  NativeFederationResult,
} from "@softarc/native-federation-orchestrator";
import {
  useShimImportMap,
  consoleLogger,
  globalThisStorageEntry,
} from "@softarc/native-federation-orchestrator/options";

const manifest = {
  mfe1: "http://localhost:4201/remoteEntry.json",
};

initFederation(manifest, {
  ...useShimImportMap({ shimMode: true }),
  logger: consoleLogger,
  storage: globalThisStorageEntry,
  hostRemoteEntry: "./remoteEntry.json",
  logLevel: "debug",
})
  .catch((err) => console.error(err))
  .then((_) => import("./bootstrap"))
  .catch((err) => console.error(err));
```

You see that? Now you can choose which logger you want, and if you want to use the "shimImportMap" instead of the browser-native importmap (spoiler alert: 90% chance you do).

There's a nice list of all the options you can choose from in the docs: https://github.com/native-federation/orchestrator/blob/main/docs/config.md

### We've reworked the loadRemoteModule function

The biggest change is that now, the loadRemoteModule is provided by initFederation. So it's not a global export anymore. That does mean that you now need to pass it around your micro frontends:

**(host) main.ts**

```javascript
import { initFederation, NativeFederationResult } from '@softarc/native-federation-orchestrator';

const manifest = {
  mfe1: 'http://localhost:4201/remoteEntry.json',
};

initFederation(manifest)
  .then(({ loadRemoteModule }: NativeFederationResult) => {
    return import('./bootstrap').then((m: any) => m.bootstrap(loadRemoteModule));
  })
  .catch(err => console.error(err));
```

Now you can set up a bootstrap.ts that exposes a method "bootstrap" that accepts this function.

**(mfe1) bootstrap.ts**

```javascript
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { LoadRemoteModule } from '@softarc/native-federation-orchestrator';

export const bootstrap = (loadRemoteModule: LoadRemoteModule) =>
  bootstrapApplication(AppComponent, appConfig(loadRemoteModule)).catch(err => console.error(err));
```

And ofcourse the **app.config.ts:**

```javascript
import {
  ApplicationConfig,
  InjectionToken,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { LoadRemoteModule, NativeFederationResult } from '@softarc/native-federation-orchestrator';

export const MODULE_LOADER = new InjectionToken<LoadRemoteModule>(
  'loader',
);

const routes = (loadRemoteModule: LoadRemoteModule): Routes => [
  {
    path: 'mfe3',
    loadComponent: () =>
      loadRemoteModule('mfe3', './Component')
        .then((m:any) => m.AppComponent),
  }
];

export const appConfig = (loadRemoteModule: LoadRemoteModule): ApplicationConfig => ({
  providers: [
    { provide: MODULE_LOADER, useValue: loadRemoteModule },
    provideZonelessChangeDetection(),
    provideRouter(routes(loadRemoteModule)),
  ],
});
```

While this does create a bit more boilerplate and complexity, the nice benefit is a controlled flow in which the loadRemoteModule is only available after federation is initialized.

## That's it

We've been scratching the surface here, but these are the essentials to migrate your codebase to the new major!

Feel free to open an issue if you come across any problems or if we've missed anything.
