import type { Plugin, PluginBuild } from 'esbuild';
import * as path from 'path';
import {
  createMappingImportResolver,
  type PathToImport,
} from '@softarc/native-federation/internal';

// esbuild's `external` only matches the unresolved specifier, so it misses the deep relative
// paths Angular emits for references it synthesizes — a template dependency reached through an
// imported NgModule, say — which would then be inlined alongside the federated copy.
export function createSharedMappingsPlugin(sharedMappings: PathToImport): Plugin {
  const resolveMapping = createMappingImportResolver(sharedMappings);
  return {
    name: 'nf-shared-mappings',
    setup(build: PluginBuild) {
      // Angular applies code plugins to the server bundle too, which resolves externals itself.
      // `platform` does not identify it — SSR on an edge runtime builds as 'neutral', and
      // Angular uses that for browser-side global scripts as well. `ngServerMode` is defined
      // 'true' on the server bundles and 'false' on the browser one.
      if (build.initialOptions.define?.['ngServerMode'] === 'true') {
        return;
      }

      // The context outlives every rebuild it serves, so a barrel edited under `ng serve` would
      // otherwise keep answering from the surface cached on the first build.
      build.onStart(() => {
        resolveMapping.reset();
      });

      build.onResolve({ filter: /^[.]/ }, args => {
        // Angular's virtual modules ('angular:polyfills' and friends) resolve against the
        // workspace root, so the path joined below would not be the one the importer meant.
        if (args.kind !== 'import-statement' || args.namespace !== 'file') {
          return {};
        }

        // Unresolved: the resolver does its own extension and index resolution.
        const importName = resolveMapping(path.join(args.resolveDir, args.path), args.importer);

        return importName ? { path: importName, external: true } : {};
      });
    },
  };
}
