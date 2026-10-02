# Contributing

Thanks for being interested in contributing! We welcome all meaningful contributions that help improve the ecosystem.

## Getting Started

We love seeing fresh ideas and improvements! Before diving into major architectural changes or large refactors, it's usually helpful to chat with us first in an issue - we're always happy to discuss the best approach and can save you time.

For the smoothest experience, we find that contributions focusing on functionality, bug fixes, and meaningful improvements tend to have the quickest path to merge. Style tweaks are great, but if that's the main focus, consider bundling them with a feature or fix to maximize impact.

## Quick Start

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Build the library: `pnpm build`
4. Create a branch: `git checkout -b my-feature`
5. Make your changes
6. Lint your code: `pnpm lint`
7. Test your code: `pnpm test`
8. Push your branch and open a PR

## Pull Request Guidelines

- `// todo:` Include tests for any new features
- Update documentation if needed
- Follow our coding style (eslint)
- Keep PRs focused - one feature or bug fix per PR

## Commit Messages

Please use clear commit messages:

```
feat: add new feature
fix: resolve issue
docs: update readme
```

> You can read more about conventional commits [here](https://www.conventionalcommits.org/en/v1.0.0/).

## Angular Releases

Each adapter release line supports exactly one Angular minor (`@angular/build` `~X.Y.0`). See
[ADR 0001](docs/adr/0001-angular-build-internals.md) for why.

When Angular releases a new minor:

1. Move `@angular/build` (peer and dev dependency) and the `@angular-devkit/*` dependencies to
   the new minor, e.g. `~22.2.0` and `^0.2202.0`.
2. Fix what breaks in `pnpm typecheck` and `pnpm test`. Changes to `@angular/build/private` usually
   show up there first.
3. Review every `// upstream: angular/angular-cli <path> @ <sha>` tag against the new minor's
   release branch in angular-cli. Port each upstream change or deliberately skip it, then bump the
   SHA in the tag.
4. Release the new adapter minor as soon as possible: until it's out, npm users can't upgrade
   Angular because of the peer conflict.

When Angular releases a patch within a supported minor, update the dev dependency to it and run
`pnpm typecheck` and `pnpm test`, so each release line stays tested against the latest patch.

## Need Help?

Open an issue if you:

- Find a bug
- Want to suggest a feature
- Have questions about the code

Thanks for contributing! 🎉
