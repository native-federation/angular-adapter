import type { Plugin, PluginBuild } from 'esbuild';
import * as path from 'path';
import { isUnderDir, type PathToImport } from '@softarc/native-federation/internal';

// esbuild's `external` matches the unresolved specifier, so it only catches imports spelled
// `@myorg/ui`. Angular emits a deep relative path for any reference it has to synthesize —
// a template dependency reached through an imported NgModule, say — and those would be
// inlined alongside the federated copy, giving the lib two module instances.
export function createSharedMappingsPlugin(mappedPaths: PathToImport): Plugin {
  // Longest first, so a secondary entry point wins over the barrel it sits under.
  const mappings = Object.entries(mappedPaths)
    .map(([entryPoint, importName]) => ({ dir: path.dirname(entryPoint), importName }))
    .sort((a, b) => b.dir.length - a.dir.length);

  return {
    name: 'nf-shared-mappings',
    setup(build: PluginBuild) {
      // Angular applies code plugins to the server bundle too, which resolves externals itself.
      if (build.initialOptions.platform === 'node') {
        return;
      }

      build.onResolve({ filter: /^[.]/ }, args => {
        if (args.kind !== 'import-statement') {
          return {};
        }

        const importPath = path.join(args.resolveDir, args.path);
        const mapping = mappings.find(m => isUnderDir(importPath, m.dir));

        // A mapped lib reaching into itself stays internal, or its own bundle imports itself.
        if (!mapping || isUnderDir(args.importer, mapping.dir)) {
          return {};
        }

        return { path: mapping.importName, external: true };
      });
    },
  };
}
