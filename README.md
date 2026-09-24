# @angular-architects/native-federation-v4

[![npm version](https://img.shields.io/npm/v/@angular-architects/native-federation-v4)](https://www.npmjs.com/package/@angular-architects/native-federation-v4)
[![npm downloads](https://img.shields.io/npm/dm/@angular-architects/native-federation-v4)](https://www.npmjs.com/package/@angular-architects/native-federation-v4)
[![license](https://img.shields.io/npm/l/@angular-architects/native-federation-v4)](https://github.com/native-federation/angular-adapter/blob/main/LICENSE)

The Angular adapter for **Native Federation**: the mental model of Module Federation, implemented on browser standards (ES modules and import maps) for Micro Frontends and plugin-based architectures.

📖 **[Documentation](https://native-federation.com/docs/v4/angular-adapter/)**

> [!NOTE]
> This is the **v4 bridge package** for Angular 20 and 21. Upgrading from v3? See the [migration guide](https://native-federation.com/docs/v4/angular-adapter/migration-v4/), or run `ng update @angular-architects/native-federation-v4`. The v3 source lives in the [module-federation-plugin repository](https://github.com/angular-architects/module-federation-plugin/tree/21.x.x/libs/native-federation).

## Features

- **Stays on the Angular CLI** — delegates to Angular's esbuild-based ApplicationBuilder and dev server, so you keep every CLI optimisation.
- **Web standards** — remotes are plain ES modules wired together by an import map.
- **Shared dependencies** — load a library once across host and remotes, with semver-aware version negotiation.
- **Schematics** — `ng add` turns a project into a host or remote; `ng update` migrates it.
- **SSR, Incremental Hydration and I18N** — supported out of the box.

## Versions

The adapter follows Angular's version numbers: use the adapter release that matches your Angular major and minor (e.g. `21.2.x` for Angular 21.2.x).

| Your Angular | Install                                    |
| ------------ | ------------------------------------------ |
| 22+          | `@angular-architects/native-federation`    |
| 20 – 21      | `@angular-architects/native-federation-v4` |

`@angular-architects/native-federation-v4` is a bridge package: it brings Native Federation v4 to projects still on Angular 20 or 21. Starting with Angular 22, v4 ships in the main `@angular-architects/native-federation` package again, so drop the `-v4` suffix when you upgrade (`ng update @angular-architects/native-federation` does this for you).

## Quick start

Install the adapter, then make one project a remote and another a host:

```bash
npm i @angular-architects/native-federation-v4 -D

ng g @angular-architects/native-federation-v4:init --project mfe1 --port 4201 --type remote
ng g @angular-architects/native-federation-v4:init --project shell --port 4200 --type dynamic-host
```

The schematic points `angular.json` at the federation builder, moves your bootstrap into `bootstrap.ts` and generates a `federation.config.mjs`:

```js
import {
  withNativeFederation,
  fromPackageJson,
} from "@angular-architects/native-federation-v4/config";

export default withNativeFederation({
  name: "mfe1",
  exposes: {
    "./Component": "./projects/mfe1/src/app/app.component.ts",
  },
  shared: fromPackageJson({
    singleton: true,
    strictVersion: true,
    requiredVersion: "auto",
    build: "package",
  })
    // includeSecondaries is an opt-out of ignoreUnusedDeps, so all of
    // @angular/core is shared to prevent mismatches.
    .patch(["@angular/core"], { includeSecondaries: { keepAll: true } }),
  skip: ["rxjs/ajax", "rxjs/fetch", "rxjs/testing", "rxjs/webSocket"],
  features: {
    denseChunking: true,
  },
});
```

Load the exposed component in the shell like any lazy route, then run `ng serve mfe1` and `ng serve shell`. The [Getting Started](https://native-federation.com/docs/v4/angular-adapter/getting-started/) guide walks through every step, and the [playground](https://github.com/native-federation/playground) has runnable hosts, remotes and SSR examples.

## Documentation

- [Builder](https://native-federation.com/docs/v4/angular-adapter/builder/) — the build/serve target and every option it accepts
- [Schematics](https://native-federation.com/docs/v4/angular-adapter/schematics/) — `init`, `appbuilder`, `remove` and the Nx generator
- [Angular config](https://native-federation.com/docs/v4/angular-adapter/configuration/) — `withNativeFederation`, `fromPackageJson`, `shareAngularLocales`, `autoShareScope`
- [Runtime](https://native-federation.com/docs/v4/angular-adapter/runtime/) — `initFederation`, `loadRemoteModule` and dynamic remotes
- [SSR & Hydration](https://native-federation.com/docs/v4/angular-adapter/ssr/), [I18N](https://native-federation.com/docs/v4/angular-adapter/i18n/) and [Localization](https://native-federation.com/docs/v4/angular-adapter/localization/)
- [Custom builder](https://native-federation.com/docs/v4/angular-adapter/custom-builder/) — inject your own esbuild plugins
- [Mental model](https://native-federation.com/docs/v4/mental-model/) and [Native & Module Federation](https://native-federation.com/docs/v4/native-and-module-federation/)
- [FAQ](https://native-federation.com/docs/v4/faq/)

Using an AI coding assistant? Point it at [`llms.txt`](https://native-federation.com/llms.txt).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](https://github.com/native-federation/angular-adapter/blob/main/CONTRIBUTING.md).

## Credits

Big thanks to [Zack Jackson](https://twitter.com/ScriptedAlchemy) for originally coming up with Module Federation and its mental model, to the Angular CLI team, esp. [Alan Agius](https://twitter.com/AlanAgius4) and Charles Lyding, for the esbuild-based builder this adapter builds on, and to [Florian Rappl](https://twitter.com/FlorianRappl) and the [Angular Architects team](https://www.angulararchitects.io/en/) for their feedback and contributions. Find the current team behind native-federation on our [documentation website](https://native-federation.com/team/).

## License

[MIT](https://github.com/native-federation/angular-adapter/blob/main/LICENSE)
