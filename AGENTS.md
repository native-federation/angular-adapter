# General Guidelines

This is a single-package repository for `@angular-architects/native-federation`.
The source lives in `src/`, and the library is built with plain TypeScript.

- Build: `pnpm build` (runs `tsc -p tsconfig.build.json` then `node post-build.mjs`,
  emitting the publishable package into `dist/`)
- Test: `pnpm test` (Vitest)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
