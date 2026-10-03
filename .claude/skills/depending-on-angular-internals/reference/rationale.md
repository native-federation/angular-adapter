# Rationale

Why the rules in SKILL.md are what they are. Originally ADR 0001 (related: #153–#158, #67).

## Contents
- Context: which internals we reach
- How other tools handle this
- Consequences we accept

## Context: which internals we reach

Public API (`buildApplication` with `codePlugins`) is not enough for federation: we need the
compiler plugin, the JavaScript transformer, the source file cache and the internal application
builder. Over time we also reached past the exports map:

| Kind | Example | Issue |
| --- | --- | --- |
| Deep imports of small, pure helpers | asset pattern normalization/resolution | #153 |
| Loading an internal module for its shared state | `src/utils/hash.js` singleton behind `JavaScriptTransformer`'s cache | #155 |
| Overwriting an internal module's exports | `environment-options.js` (`useParallelTs`, `optimizeChunksThreshold`) | #156 |
| Patching an installed file on disk | `@angular/core/fesm2022/core.mjs` for `ngServerMode` | #157 |
| Exported but unsupported API | `@angular/build/private`: `buildApplicationInternal`, `createCompilerPlugin`, `JavaScriptTransformer`, `SourceFileCache`, browser target helpers | — |

`@angular/build/private` states its exports are "not supported for external use, do not provide
SemVer guarantees". Deep imports fail outright under the exports map (#153). Path-based loads,
`require.cache` lookups and on-disk patches fail silently or affect other projects (the pnpm store,
#157).

The choice is not "copy everything" versus "couple to everything". Copying gives control but loses
upstream fixes and performance work. Coupling keeps us close to Angular but exposes us to breaking
changes without notice.

## How other tools handle this

Tools that build on a host's build pipeline combine these approaches:

- **Importing from the host's semi-private entry point.** Stays on the host's implementation and
  fixes, but the API can change in minors and patches. Some tools declare wide peer ranges and adapt
  at runtime; others restrict the range to tested versions so an untested combination warns at
  install.
- **Copying self-contained helpers.** Under the tool's control, but no upstream fixes. Copies
  usually keep the license and a reference to the upstream commit; drift is noticed only if those
  references are checked.
- **Using the host's running instance for stateful internals.** Copied stateful code has separate
  state the host doesn't see.
- **Bundling the host and exposing a subset.** Full version control; limits downstream tools to that
  subset.
- **Patching installed host code.** Must be reapplied and checked on each upgrade and changes shared
  package caches.
- **Contributing a hook upstream.** Removes the workaround, at the cost of the host's review and
  release schedule. The Angular team has accepted PRs that widen `@angular/build/private`.

## Consequences we accept

Positive:

- No shipped code depends on Angular file paths or `node_modules` contents, except the module-state
  exception, whose assumptions a spec checks. Failures are loud: a type error, a CI failure or a
  peer conflict at install time.
- We keep getting Angular's compiler, bugfix and performance work on the core pipeline.
- Copied code is small, close to upstream, attributed and reviewed on every minor bump.
- Nothing we ship waits on an Angular release.

Negative:

- Every Angular minor needs an adapter release. Until it's out, users can't upgrade Angular: npm 7+
  fails with `ERESOLVE`, pnpm and Yarn warn. Release promptly after each Angular minor.
- `/private`, and the internal behind the module-state exception, can change in a patch within the
  supported minor; we only see it after Angular releases it.
- Angular patch fixes to copied code reach users only once we port them, at the latest at the next
  minor bump. Acceptable because the copied code is small.
- The upstream-tag review is a manual step on every minor bump.
