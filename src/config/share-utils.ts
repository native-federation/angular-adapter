import type {
  ShareAllExternalsOptions,
  ShareExternalsOptions,
  SkipList,
  FederationConfig,
} from "@softarc/native-federation/domain";
import {
  share as coreShare,
  shareAll as coreShareAll,
  withNativeFederation as coreWithNativeFederation,
} from "@softarc/native-federation/config";
import { NG_SKIP_LIST } from "./angular-skip-list.js";
import type { NormalizedSharedExternalsConfig } from "@softarc/native-federation/internal";

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

/**
 * Package name prefixes that imply a server (Node) build. Matched with
 * `startsWith`, so secondary entry points (e.g. `@angular/ssr/node`) match too.
 */
export const SERVER_DEPENDENCIES = ["@angular/platform-server", "@angular/ssr"];

/**
 * Infers the default federation platform from the shared dependency keys:
 * `'node'` if any of them is an Angular server package, otherwise `'browser'`.
 */
export function getDefaultPlatform(deps: string[]): "browser" | "node" {
  const hasServerDep = deps.some((dep) =>
    SERVER_DEPENDENCIES.some((server) => dep.startsWith(server)),
  );
  return hasServerDep ? "node" : "browser";
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
