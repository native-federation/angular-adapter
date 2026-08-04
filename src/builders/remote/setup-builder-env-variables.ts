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

// The write above is too late once @angular/build is loaded, as under Nx.
for (const { level, message } of replayNgBuildEnv(['NG_BUILD_PARALLEL_TS'])) {
  logger[level](message);
}
