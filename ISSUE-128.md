# #128 / #119 — `sharedMappings` libs evaluated twice (NG0201)

Working notes for branch `issues/128`. Not intended to ship — delete before merge, or move
what is worth keeping into the PR description.

## The bug

A workspace lib shared via `sharedMappings` ends up in the output twice: once in its federated
chunk, once inlined into the app. Two evaluations, two `InjectionToken` identities, `NG0201:
No provider found`. Same mechanism duplicates `providedIn: 'root'` services and pipes.

The cause is not a bad import. The app author writes only a barrel import; **ngtsc synthesizes
a second, deep one**. Confirmed with `ngc` on Angular 22.1:

```ts
// source
import { UiModule } from '@myorg/ui';
@Component({ selector: 'app-root', imports: [UiModule], template: '<ui-badge/>' })
export class AppComponent {}
```

```js
// emitted
import { UiModule } from '@myorg/ui';                        // bare -> matches externals
import * as i1 from "../../../libs/ui/src/badge.component";  // synthesized -> inlined
dependencies: [UiModule, i1.BadgeComponent]
```

`getExternals` (core) returns bare specifiers, and esbuild's `external` matches the
*unresolved* specifier. The synthesized path never went through the `paths` mapping, so it is
never externalized.

### Blast radius

Only references ngtsc has to *synthesize* are affected — which is why it looks intermittent:

| shape | emitted import | result |
| --- | --- | --- |
| standalone component named in `imports: []` | bare `@myorg/ui` | fine |
| service / `InjectionToken` injected | bare `@myorg/ui` | fine |
| template dep reached through an NgModule | deep relative | **broken** |

NgModule-based shared UI libs in Nx workspaces get hit hardest.

## Where the regression came from

Not a v22 regression, despite how both issues are written. `createSharedMappingsPlugin` covered
this until commit `73f5c69` ("feat: Added full support for wildcards in shared mappings",
2026-03-20) commented out both call sites; `a6aa619` then deleted the commented lines. The
plugin was left orphaned with a TODO.

**Shipped disabled since v20.3.8 / v21.1.8 (2026-03-22)** — which is why #128 reproduces on
21.2.9. Backport to `21.x.x` and `20.3.x` is still outstanding.

## What was fixed

Two commits on this branch.

**`cc1012e`** — plugin rewritten and wired into the app build (`builders/build/builder.ts`).
Beyond un-orphaning it:

- directory boundary via core's `isUnderDir`, so `libs/foo` no longer swallows `libs/foobar`
- longest-prefix wins, so a `resolveGlob`-expanded secondary beats the barrel above it
- skips `platform === 'node'` — Angular applies code plugins to the server bundle too
- `name: 'custom'` -> `'nf-shared-mappings'`

**`a22614e`** — the barrel guard (see below), plus `typescript` as a peer dependency.

### `angular-bundler.ts` was deliberately left alone

Both issue reporters patched it too. They did not need to. Core builds every mapping and expose
as entry points of **one** esbuild context with `splitting: config.chunks`, and `chunks`
defaults to `true`, so cross-mapping relative imports already collapse onto a shared chunk.
Verified with two mapped libs where one reaches into the other:

```js
// _internal_ui-*.js and _internal_feature-*.js both:
import { ... } from "@nf-internal/chunk-3NVGK2BB";
// and new l("BADGE_LABEL") appears exactly once, in that chunk
```

Adding the plugin there would convert shared chunks into importmap externals — a chunk-graph
change touching the ground of #12/#73 — for no benefit. This also explains the workaround in
issue #119 ("add every app lib to `sharedMappings`"): it moves those libs into that shared
context.

## The barrel guard, and why it is not optional

ngtsc emits the same deep import when the entry point does **not** re-export the target.
Verified by reducing the probe's `index.ts` to `export * from './ui.module'` with `UiModule`
still exporting the component publicly — a legitimate library shape. Identical output.

So a blind rewrite points at a specifier the federated chunk never exports, `i1.X` is
`undefined`, and the app fails at runtime — strictly worse than the duplication it replaces,
and invisible at build time because externals are not validated.

`src/utils/reexported-files.ts` walks the entry point's `export ... from` chain; the plugin
rewrites only files that surface there and leaves the rest inlined.

Note core's `getExternalImportsCore` is **not** usable for this: it follows imports as well as
re-exports, so `index -> ui.module -> imports badge.component` would report the hidden file as
reachable and wave the crash through. Export-only reachability is the point.

## Reproducing / re-verifying

Neither the unit tests nor the checked-in examples cover the NgModule shape, so verification is
manual. In `angular-examples/angular/nx` (its `libs/internal` is services-only — add UI):

1. `npm run build` here, then overlay `dist/` onto the example's
   `node_modules/@angular-architects/native-federation` (back up the pristine copy first).
2. Add to `libs/internal/src/ui/`: a `standalone: false` component holding an `InjectionToken`,
   a second one likewise, and an NgModule declaring and exporting both. Have `index.ts`
   re-export only the first — that covers the fix and the guard in one build.
3. Use the NgModule in `apps/host/src/app/app.component.ts` (`imports: [InternalUiModule]`) and
   put both selectors in the template.
4. `npx nx build host --skip-nx-cache`, then grep `dist/host/browser/` for each token name.

Expected with both commits applied:

- published component's token appears in `_internal_ui-*.js` only
- hidden component's token appears in the host chunk only (fell back to inlining)
- host chunk reads `dependencies:[...,c.BadgeComponent,p]` — `c` the `@internal/ui` namespace,
  `p` a local class with `selectors:[["internal-hidden"]]`

Before `cc1012e`, the published token appears in *both* files — that is the bug.

## Open threads

- Branch is local only. Not pushed, no PR.
- Backport to `21.x.x` and `20.3.x` (deferred deliberately).
- Core issue filed: native-federation/native-federation-core#122 — asks core for a
  containment-based mapping lookup and an export-surface query, so adapters keep a thin
  bundler hook and no rule of their own. Both pieces here are meant to be replaced by those.
- `angular-examples/angular/nx/node_modules/@angular-architects/native-federation.dirty-issues128`
  is a leftover build overlay and needs removing by hand.
- `typescript` added to `peerDependencies` (`>=6.0 <6.1`, matching `@angular/build`). Chosen
  over core's undeclared `import * as ts from 'typescript'`, which only resolves under a
  hoisted linker. A comment-stripped regex over re-export statements would avoid the peer
  entirely if that is preferred.
