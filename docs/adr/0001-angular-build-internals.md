# ADR 0001: How we depend on Angular build internals

- **Status:** Accepted
- **Date:** 2026-10-02
- **Related:** #153, #154, #155, #156, #157, #158, #67

## Context

The adapter wraps `@angular/build`'s esbuild pipeline. Public API (`buildApplication` with
`codePlugins`) is not enough for federation: we need the compiler plugin, the JavaScript
transformer, the source file cache and the internal application builder. Over time we also reached
past the exports map:

| Kind | Example | Issue |
| --- | --- | --- |
| Deep imports of small, pure helpers | asset pattern normalization/resolution | #153 |
| Loading an internal module for its shared state | `src/utils/hash.js` singleton behind `JavaScriptTransformer`'s cache | #155 |
| Overwriting an internal module's exports | `environment-options.js` (`useParallelTs`, `optimizeChunksThreshold`) | #156 |
| Patching an installed file on disk | `@angular/core/fesm2022/core.mjs` for `ngServerMode` | #157 |
| Exported but unsupported API | `@angular/build/private`: `buildApplicationInternal`, `createCompilerPlugin`, `JavaScriptTransformer`, `SourceFileCache`, browser target helpers (~10 files) | — |

`@angular/build/private` states its exports are "not supported for external use, do not provide
SemVer guarantees". Deep imports fail outright under the exports map (#153). Path-based loads,
`require.cache` lookups and on-disk patches fail silently or affect other projects (the pnpm store,
#157).

The decision is not "copy everything" versus "couple to everything". Copying gives control but
loses upstream fixes and performance work. Coupling keeps us close to Angular but exposes us to
breaking changes without notice.

### How other tools handle this

Tools that build on a host's build pipeline, in the Angular ecosystem and elsewhere, use these
approaches, often in combination:

- **Importing from the host's semi-private entry point.** This keeps the tool on the host's own
  implementation and its fixes. These APIs can change in minor and patch releases, both in
  signature and in behavior. Some tools declare wide peer ranges and adapt at runtime per host
  version. Others restrict the peer range to versions they've tested, so an untested combination
  shows up as an install warning.
- **Copying self-contained helpers.** The copy is under the tool's control and doesn't break when
  the host changes. It also doesn't receive upstream fixes. Copies usually keep the original license
  and a reference to the upstream commit. Whether drift is noticed depends on whether those
  references are checked.
- **Using the host's running instance for stateful internals.** Copying stateful code produces
  separate state, which the host doesn't see. Tools that need the host's state locate the instance
  the host loaded instead.
- **Bundling the host and exposing a selected subset.** This gives full control over the host
  version. It limits tools built on top to the internals in that subset.
- **Patching installed host code.** This changes host behavior without an upstream change. Patches
  have to be reapplied and checked on each host upgrade, and writing to installed files also
  changes shared package caches. Some projects keep patches as separate, reviewed patch files.
- **Contributing a hook upstream.** This removes the need for a workaround, at the cost of
  depending on the host's review and release schedule. The Angular team has accepted PRs that widen
  `@angular/build/private`.

## Decision

### Principles

1. **One adapter release line per Angular minor.** Adapter `X.Y.*` supports `@angular/build`
   `~X.Y.0` and nothing else (e.g. `22.1.x`, `22.2.x`). Each new Angular minor gets its own adapter
   minor. This is a rule, not a default. Each release line stays tested against the latest Angular
   patch of its minor.
2. **Minimize drift from Angular's build.** Every difference from what `@angular/build` does is code
   we maintain. Where Angular's implementation is reachable through a supported import, we use it
   rather than our own. Where we have to deviate, the deviation is deliberate, small and tested.
3. **We don't depend on Angular changing its builder for us.** Upstream changes take long to land
   and reach users only on Angular's release schedule, so we always solve the problem in our own
   code first. A small, generic upstream change that would remove a workaround can still be worth
   proposing: we discuss it within the team first, case by case, and never let a release wait on
   it.

### Rules per kind of internal

1. **The core pipeline: depend on `@angular/build/private`, don't copy it.** Copying
   `buildApplicationInternal` or the compiler plugin would be a fork of Angular's build, the
   largest possible drift (principle 2). The version range from principle 1 contains the risk of
   an API without SemVer guarantees: signature changes in `/private` surface as type errors when a
   release moves to the new Angular minor.
2. **Small, stateless helpers that aren't exported: copy.** Keep the copy as close to the upstream
   code as possible, so upstream changes can be applied mechanically. Keep Angular's MIT notice and
   tag each ported piece with `// upstream: angular/angular-cli <path> @ <sha>`. On every Angular
   minor bump, the release checklist compares each tag against the new minor's release branch:
   upstream changes are ported or deliberately skipped, then the SHA is bumped. Deliberate
   deviations from upstream each have their own test.
3. **Internals that hold shared state: never copy, never load by path.** A copy gets its own state,
   not Angular's. Redesign so the internal isn't needed. For `hash.js` (#155): construct
   `JavaScriptTransformer` without a `Cache` and cache around `transformData` with our own key.
4. **Changing Angular's own module state: documented exception.** Where there is no other way to
   get the behavior (#156, `environment-options.js`), the workaround stays in one place, carries an
   `// upstream:` tag so it's reviewed on every minor bump, and has a spec in our own test suite
   that checks its assumptions (file path, export names, types, writability) against our
   `@angular/build` devDependency. Nothing extra runs in users' builds. A change in a new minor
   then fails our CI instead of silently doing nothing for users. A runtime warning is not the
   main signal: whether the internal is loaded yet depends on how the builder was started, so a
   missing module doesn't reliably mean a broken one. Whether to propose an upstream change that removes the workaround is discussed in the team
   (principle 3).
5. **Never write to `node_modules`.** Do anything that needs to change installed code at bundle
   time instead, e.g. `onLoad` or a `banner` for `ngServerMode` (#157).

The lint rule from #154 (`no-restricted-imports` on `@angular/*/src/*` and
`@angular-devkit/*/src/*`) stays. Build-time use in our own repo (specs, build scripts) is exempt,
because it runs only against our pinned devDependency: e.g. `src/builders/remote/assets.spec.ts`
uses Angular's helpers as a parity reference.

## Consequences

**Positive**

- No shipped code depends on Angular file paths or `node_modules` contents, except the one
  exception that touches Angular's module state, whose assumptions a spec checks. Failures are
  loud: a type error, a CI failure or a peer dependency conflict at install time.
- We keep getting Angular's compiler, bugfix and performance work on the core pipeline.
- Copied code is small, close to upstream, attributed and reviewed on every minor bump, so drift
  is visible and cheap to resolve.
- Nothing we ship waits on an Angular release.

**Negative**

- Every Angular minor needs an adapter release. Until it's out, users can't upgrade Angular: npm 7+
  fails with `ERESOLVE` on the peer conflict, pnpm and Yarn warn. Releasing promptly after each
  Angular minor keeps that window short.
- `/private`, and the internal behind the module-state exception, can change in a patch within
  the supported minor. We test against the latest patch, so such a change surfaces only after
  Angular has released it.
- Fixes Angular ships in a patch release to code we copied reach users only once we port them, at
  the latest at the next minor bump. We accept this because the copied code is small.
- The upstream-tag review has to happen on every minor bump; it's a manual checklist step.
