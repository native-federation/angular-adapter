import type { Plugin, PluginBuild } from 'esbuild';
import * as path from 'path';
import type { MappedPath } from '@softarc/native-federation/internal';

export function createSharedMappingsPlugin(mappedPaths: MappedPath[]): Plugin {
  return {
    name: 'custom',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^[.]/ }, async args => {
        let mappedPath: MappedPath | null = null;
        let isSelf = false;

        if (args.kind === 'import-statement') {
          const importPath = path.join(args.resolveDir, args.path);
          if (mappedPaths) {
            mappedPath = mappedPaths.find(p => importPath.startsWith(path.dirname(p.path))) ?? null;
          }
        }

        if (mappedPath) {
          isSelf = args.importer.startsWith(path.dirname(mappedPath.path));
        }

        if (mappedPath && !isSelf) {
          return {
            path: mappedPath.key,
            external: true,
          };
        }

        return {};
      });
    },
  };
}
