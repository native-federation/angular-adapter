import { logger, type NormalizedFederationConfig } from '@softarc/native-federation/internal';

const DISCUSSION = 'https://github.com/orgs/native-federation/discussions/176';

// Orchestrator >= 4.8 no longer stitches a package from several builds, so builds that
// publish different entrypoint sets of a package make remotes fall back to their own copy.
export function warnFlatExternals(config: NormalizedFederationConfig): void {
  // Without pruning every build publishes all entrypoints, so builds can't disagree.
  if (!config.features.ignoreUnusedDeps || Object.keys(config.shared).length === 0) {
    return;
  }

  if (!config.features.denseExternals) {
    logger.warn(
      'Shared externals are published flat. Since orchestrator 4.8.0 this can make remotes ' +
        'load their own copy of a shared package (e.g. a second Angular instance). ' +
        "Set 'features.denseExternals: true' in federation.config.mjs. " +
        `See ${DISCUSSION}`,
    );
  }

  // Secondaries have their own keys, so only check the packages themselves. share-utils
  // resolves `includeSecondaries: { keepAll: true }` to `true`; any other value is dropped.
  const pruned = Object.entries(config.shared)
    .filter(([key, shared]) => /^@angular\/[^/]+$/.test(key) && shared.includeSecondaries !== true)
    .map(([key]) => key);

  if (pruned.length > 0) {
    logger.warn(
      `${pruned.join(', ')} ${pruned.length === 1 ? 'is' : 'are'} shared without ` +
        "'includeSecondaries: { keepAll: true }', so this build only publishes the entrypoints " +
        'it imports. Remotes that import others load their own Angular instead. ' +
        "Add .patch(['@angular/*'], { includeSecondaries: { keepAll: true } }) " +
        `to 'shared' in federation.config.mjs. See ${DISCUSSION}`,
    );
  }
}
