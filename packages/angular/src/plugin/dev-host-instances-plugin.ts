import * as fs from 'fs';
import * as path from 'path';
import type { Plugin } from 'esbuild';

/**
 * Injects the dev-only host-instance bootstrap (see
 * `tools/dev-host-instances-entry.ts`) into the `ng serve` SSR server bundle.
 *
 * Gates on `platform === 'node'` — the only reliable SSR signal here, since the
 * serve target carries no `ssr` flag. CSR dev servers are a no-op.
 *
 * `inject` makes the bootstrap run before the app. The orchestrator's Node entry
 * is kept external so its `module.register()` loader hook fires; bundled, the
 * bridge would silently never run.
 *
 * @param bootstrapSource generated bootstrap module source.
 * @param bootstrapFilePath absolute path to write it to (`inject` needs a file).
 */
export function devHostInstancesPlugin(bootstrapSource: string, bootstrapFilePath: string): Plugin {
  return {
    name: 'nf-dev-host-instances',
    setup(build) {
      const options = build.initialOptions;

      if (options.platform !== 'node') {
        return;
      }

      fs.mkdirSync(path.dirname(bootstrapFilePath), { recursive: true });
      fs.writeFileSync(bootstrapFilePath, bootstrapSource, 'utf-8');

      options.inject = [...(options.inject ?? []), bootstrapFilePath];

      options.external = [
        ...(options.external ?? []),
        '@softarc/native-federation-orchestrator/node',
        '@softarc/native-federation-orchestrator',
      ];
    },
  };
}
