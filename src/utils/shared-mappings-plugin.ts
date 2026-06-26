import type { Plugin, PluginBuild } from 'esbuild';
import * as path from 'path';
import type { PathToImport } from '@softarc/native-federation/internal';

export function createSharedMappingsPlugin(mappedPaths: PathToImport): Plugin {
  return {
    name: 'custom',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^[.]/ }, async args => {
        let mappedPath: string | undefined = undefined;
        let isSelf = false;

        if (args.kind === 'import-statement') {
          const importPath = path.join(args.resolveDir, args.path);
          if (mappedPaths) {
            mappedPath = Object.keys(mappedPaths).find(p => importPath.startsWith(path.dirname(p)));
          }
        }

        if (mappedPath) {
          isSelf = args.importer.startsWith(path.dirname(mappedPath));
        }

        if (mappedPath && !isSelf) {
          return {
            path: mappedPaths[mappedPath],
            external: true,
          };
        }

        return {};
      });
    },
  };
}
