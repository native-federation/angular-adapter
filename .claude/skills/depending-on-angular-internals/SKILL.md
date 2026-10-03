---
name: depending-on-angular-internals
description: Rules for how this adapter may depend on @angular/build internals (@angular/build/private, copied angular-cli helpers, Angular module state, node_modules). Use when importing from @angular/build or @angular-devkit, porting or copying angular-cli code, touching `// upstream:` tags, working around a builder limitation, bumping the supported Angular version, or analysing an issue caused by Angular internals.
---

# Depending on Angular build internals

The adapter wraps `@angular/build`'s esbuild pipeline and needs more than its public API. These
rules decide *how* we reach past it. For the context, the ecosystem survey and the accepted
trade-offs, see [reference/rationale.md](reference/rationale.md).

## Principles

1. **One adapter release line per Angular minor.** Adapter `X.Y.*` supports `@angular/build`
   `~X.Y.0` and nothing else. Never widen the peer range. Each line is tested against the latest
   patch of its minor.
2. **Minimize drift from Angular's build.** Every difference from `@angular/build` is code we
   maintain. Use Angular's implementation when it's reachable through a supported import; any
   deviation is deliberate, small and tested.
3. **Don't depend on Angular changing its builder for us.** Always solve the problem in our own
   code first. A small, generic upstream change that removes a workaround may be proposed after a
   team discussion, but no release waits on it.

## Rules per kind of internal

Classify the internal first, then apply its rule:

| Kind | Rule |
| --- | --- |
| Core pipeline (`buildApplicationInternal`, `createCompilerPlugin`, `JavaScriptTransformer`, `SourceFileCache`, …) | 1. Import from `@angular/build/private` |
| Small, stateless helper not exported | 2. Copy with an `// upstream:` tag |
| Internal holding shared state (e.g. `src/utils/hash.js`) | 3. Redesign; never copy, never load by path |
| Angular's own module state, no other way (e.g. `environment-options.js`, #156) | 4. Documented exception |
| Changing installed code | 5. Never write to `node_modules` |

1. **Core pipeline: depend on `@angular/build/private`, don't copy it.** Copying it would fork
   Angular's build. Principle 1 contains the missing SemVer guarantees: signature changes surface
   as type errors on the next minor bump.
2. **Stateless helpers: copy, as close to upstream as possible**, so upstream changes apply
   mechanically. Keep Angular's MIT notice and tag each ported piece:
   ```ts
   // upstream: angular/angular-cli packages/angular/build/src/utils/path.ts @ 6c6bb21485
   ```
   Each deliberate deviation from upstream gets its own test.
3. **Shared-state internals: never copy, never load by path.** A copy has its own state, not
   Angular's. Redesign so the internal isn't needed. Example (#155): construct
   `JavaScriptTransformer` without a `Cache` and cache around `transformData` with our own key.
4. **Module-state exception.** Keep the workaround in one place, give it an `// upstream:` tag,
   and add a spec in our suite that checks its assumptions (file path, export names, types,
   writability) against the `@angular/build` devDependency. Nothing extra runs in users' builds;
   don't rely on a runtime warning, because whether the internal is loaded yet depends on how the
   builder was started.
5. **Never write to `node_modules`.** Do it at bundle time instead, e.g. an esbuild `onLoad` or a
   `banner` (as for `ngServerMode`, #157). On-disk patches leak into the shared pnpm store.

Deep imports (`@angular/*/src/*`, `@angular-devkit/*/src/*`) are blocked by `no-restricted-imports`
and fail under the exports map anyway (#153). Our specs and build scripts are exempt because they
run only against the pinned devDependency (e.g. `src/builders/remote/assets.spec.ts` uses Angular's
helpers as a parity reference).

## Checklist for a change that touches internals

```
- [ ] Classified the internal (table above) and applied its rule
- [ ] No deep import, path-based load, require.cache lookup or node_modules write in shipped code
- [ ] Copied code: MIT notice + `// upstream:` tag with path and SHA; deviations tested
- [ ] Module-state exception: single location, `// upstream:` tag, assumption spec
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
```

## Angular version bumps

Follow "Angular Releases" in [CONTRIBUTING.md](../../../CONTRIBUTING.md). On a minor bump, find
every tag with `grep -rn "// upstream: angular/angular-cli" src` and compare each against the new
minor's release branch: port or deliberately skip each upstream change, then bump the SHA.
