export {
  share,
  shareAll,
  fromPackageJson,
  withNativeFederation,
  autoShareScope,
  type PackageShareScopeOptions,
} from './config/share-utils.js';
// Nothing Angular-specific to add: the skip list NG_SKIP_LIST seeds applies to npm
// packages, not to workspace path mappings.
export { mappingsFromWorkspace } from '@softarc/native-federation/config';
export { NG_SKIP_LIST } from './config/angular-skip-list.js';

export { shareAngularLocales } from './utils/angular-locales.js';
