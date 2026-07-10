import type {
  ShareAllExternalsOptions,
  ShareExternalsOptions,
  SkipList,
  FederationConfig,
} from "@softarc/native-federation/domain";
import {
  share as coreShare,
  shareAll as coreShareAll,
  fromPackageJson as coreFromPackageJson,
  withNativeFederation as coreWithNativeFederation,
} from "@softarc/native-federation/config";
import { NG_SKIP_LIST } from "./angular-skip-list.js";
import type { NormalizedSharedExternalsConfig } from "@softarc/native-federation/internal";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { cwd } from "node:process";

export function shareAll(
  config: ShareAllExternalsOptions,
  opts: {
    skipList?: SkipList;
    projectPath?: string;
    overrides?: ShareExternalsOptions;
  } = {},
) {
  if (!opts.skipList) opts.skipList = NG_SKIP_LIST;
  return coreShareAll(config, opts);
}

export function share(
  configuredShareObjects: ShareExternalsOptions,
  projectPath = "",
  skipList = NG_SKIP_LIST,
) {
  return coreShare(configuredShareObjects, projectPath, skipList);
}

/**
 * Angular-flavored {@link coreFromPackageJson}: builds a shared-externals config
 * from `package.json` and pre-seeds the Angular skip list, so the returned
 * fluent builder (`.skip()`, `.override()`, `.patch()`, `.get()`) starts from
 * {@link NG_SKIP_LIST} instead of core's `DEFAULT_SKIP_LIST`.
 */
export function fromPackageJson(
  baseCfg: ShareAllExternalsOptions,
  projectPath = "",
) {
  return coreFromPackageJson(baseCfg, projectPath).skip(NG_SKIP_LIST);
}

export function withNativeFederation(cfg: FederationConfig) {
  if (!cfg.platform)
    cfg.platform = getDefaultPlatform(Object.keys(cfg.shared ?? {}));

  const normalized = coreWithNativeFederation(cfg);

  // This is for being backwards compatible
  if (!normalized.features.ignoreUnusedDeps) {
    normalized.shared = removeNgLocales(normalized.shared);
  }

  return normalized;
}

function getDefaultPlatform(deps: string[]): 'browser' | 'node' {
  const server = deps.find(e =>
    ['@angular/platform-server', '@angular/ssr'].find(f => e.startsWith(f))
  );
  return server ? 'node' : 'browser';
}

export interface PackageShareScopeOptions {
  level?: "major" | "minor" | "patch";
  /** Package whose version drives the scope. Defaults to `@angular/core`. */
  dependency?: string;
  /** Directory to start resolving `package.json` from. Defaults to `cwd()`. */
  projectPath?: string;
  prefix?: string;
}

/**
 * Builds a version-pinned share scope (e.g. `"ng21.1"`) from a dependency's
 * declared version, so internals are only shared between remotes on the same
 * version line.
 *
 * ```ts
 * withNativeFederation({
 *   shareScope: autoShareScope({ level: 'patch' }), // e.g. "ng21.1.4"
 *   shared: { '@angular/core': { shareScope: autoShareScope() } }, // "ng21.1"
 * });
 * ```
 *
 * @throws when the version can't be resolved or lacks the requested `level`.
 */
export function autoShareScope(opts: PackageShareScopeOptions = {}): string {
  const {
    level = "minor",
    projectPath = cwd(),
    dependency = "@angular/core",
    prefix = "ng",
  } = opts;

  let dir = projectPath;
  while (
    !existsSync(path.join(dir, "package.json")) &&
    path.dirname(dir) !== dir
  )
    dir = path.dirname(dir);

  const pkgPath = path.join(dir, "package.json");
  const pkg = existsSync(pkgPath)
    ? JSON.parse(readFileSync(pkgPath, "utf-8"))
    : {};
  const version =
    pkg.dependencies?.[dependency] ??
    pkg.devDependencies?.[dependency] ??
    pkg.peerDependencies?.[dependency];
  const match = version ? /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version) : null;
  if (!match)
    throw new Error(
      `autoShareScope() could not resolve an '${dependency}' version from ${pkgPath}`,
    );

  const [, major, minor, patch] = match;
  if (level === "major") return `${prefix}${major}`;
  if (level === "minor") {
    if (minor === undefined)
      throw new Error(
        `autoShareScope({ level: 'minor' }) could not resolve a minor version from '${version}' in ${pkgPath}`,
      );
    return `${prefix}${major}.${minor}`;
  }
  if (minor === undefined || patch === undefined)
    throw new Error(
      `autoShareScope({ level: 'patch' }) could not resolve a patch version from '${version}' in ${pkgPath}`,
    );
  return `${prefix}${major}.${minor}.${patch}`;
}

function removeNgLocales(
  shared: NormalizedSharedExternalsConfig,
): NormalizedSharedExternalsConfig {
  const keys = Object.keys(shared).filter(
    (k) => !k.startsWith("@angular/common/locales"),
  );

  const filtered = keys.reduce(
    (acc, curr) => ({
      ...acc,
      [curr]: shared[curr],
    }),
    {},
  );

  return filtered;
}
