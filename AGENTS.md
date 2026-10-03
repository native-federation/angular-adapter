# General Guidelines

This is a single-package repository for `@angular-architects/native-federation`.
The source lives in `src/`, and the library is built with plain TypeScript.

- Build: `pnpm build` (runs `tsc -p tsconfig.build.json` then `node post-build.mjs`,
  emitting the publishable package into `dist/`)
- Test: `pnpm test` (Vitest)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`

Before analysing an issue or proposing a fix, load the `depending-on-angular-internals` skill and
check whether it already decides the case.

## GitHub CLI

`gh issue view N` and `gh pr edit N` fail on this repo with a "Projects (classic) is being
deprecated" GraphQL error. Use `gh issue view N --json title,body,comments` to read, and
`gh api -X PATCH repos/native-federation/angular-adapter/pulls/N -F body=@file.md` to edit a PR
body. `gh pr create` works. Leave `git push` to the maintainer.
