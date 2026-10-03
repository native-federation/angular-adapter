# Rationale

Why the rules in SKILL.md are what they are.

## Which internals we reach

The public API (`buildApplication` with `codePlugins`) isn't enough for federation: we need the
compiler plugin, the JavaScript transformer, the source file cache and the internal application
builder. Each way we have reached past it, and how it failed:

| Kind | Example | Failure |
| --- | --- | --- |
| `@angular/build/private` | `buildApplicationInternal`, `createCompilerPlugin`, `JavaScriptTransformer`, `SourceFileCache` | No SemVer guarantees; can break in a minor or patch |
| Deep import of a pure helper | asset pattern normalization (#153) | Blocked by the exports map: the builder doesn't load |
| Loading a module for its shared state | `src/utils/hash.js` behind the transformer cache (#155) | Path-based; breaks silently when the file moves |
| Overwriting a module's exports | `environment-options.js` (#156) | Only works if we run before Angular reads it |
| Patching an installed file | `@angular/core` for `ngServerMode` (#157) | Leaks into the shared pnpm store, other projects included |

Copying everything would lose Angular's fixes and performance work; coupling to everything exposes
us to breaking changes without notice. Hence the per-kind rules.

## What other tools do

Checked against the latest tarballs and issue trackers on 2026-10-02:

- Analog (peer `^18`…`^22`) and Nx (`>=20 <23`) import the heavy pieces from
  `@angular/build/private`, port small leaf utils, and gate on `VERSION` at runtime. Analog 2.8
  still deep-requires `src/utils/hash.js`.
- `/private` does break outside majors. 22.2.0 changed the `JavaScriptTransformer` constructor and
  made `initializeHash` required: Analog fixed it within a day (analog#2574), Nx's fix (nx#37234)
  was still a draft a week later. The 21.2.14 patch changed the `BundlerContext` lifecycle and
  caused an Nx hang (nx#35927). Wide peer ranges mean users hit these first; our `~minor` pin
  (principle 1) turns them into type errors on our side.
- `@angular-builders/custom-esbuild` stays on the public API, which is why it can do far less.
- Angular merges outside PRs that widen `/private` (angular-cli#31728, #31759, #31912, backported)
  and fixes regressions for private consumers (angular-cli#32110), so proposing a small hook
  upstream is realistic (principle 3).

## Costs we accept

- Every Angular minor needs an adapter release. Until it's out, users can't upgrade Angular (npm
  fails with `ERESOLVE`; pnpm and Yarn warn), so release promptly.
- `/private` and the module-state exception can still change in a patch within the supported
  minor; we only notice after Angular releases it.
- Upstream patch fixes to copied code reach users only once we port them, at the latest on the
  next minor bump. Acceptable because the copies are small.
- Reviewing the `// upstream:` tags is a manual step on every minor bump.
