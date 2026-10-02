import { logger } from '@softarc/native-federation/internal';

import { replayNgBuildEnv } from '../../utils/ng-build-env-snapshot.js';

/**
 * Disables Angular's parallel caching and allows for
 * a shared cache between the compilation steps which
 * improves performance dramatically.
 */
if (!process.env['NG_BUILD_PARALLEL_TS']) {
  process.env['NG_BUILD_PARALLEL_TS'] = '0';
}

// Angular's chunk optimizer: off unless set explicitly, see #73 for the trade-offs.
if (!process.env['NG_BUILD_OPTIMIZE_CHUNKS']) {
  process.env['NG_BUILD_OPTIMIZE_CHUNKS'] = '0';
}

// The writes above are too late once @angular/build is loaded, as under Nx.
for (const { level, message } of replayNgBuildEnv([
  'NG_BUILD_PARALLEL_TS',
  'NG_BUILD_OPTIMIZE_CHUNKS',
])) {
  logger[level](message);
}
