import { fileURLToPath } from 'node:url';
import type { Plugin } from 'esbuild';

/**
 * Injects the dev-only host-instance bridge (`tools/dev-host-instances-entry.ts`)
 * into the `ng serve` SSR server bundle.
 *
 * Gates on `platform === 'node'` — the only reliable SSR signal here, since the
 * serve target carries no `ssr` flag. CSR dev servers are a no-op.
 *
 * `inject` makes the bridge run before the app. The orchestrator's Node entry is
 * kept external so its `module.register()` loader hook fires; bundled, the bridge
 * would silently never run. The bridge is a real, compiled module (not generated
 * source) and reads its two per-build values from `process.env`, set by the
 * builder — so there is nothing to keep correct across a string template.
 */
const BRIDGE_MODULE = fileURLToPath(
  new URL('../tools/dev-host-instances-entry.js', import.meta.url)
);

export function devHostInstancesPlugin(): Plugin {
  return {
    name: 'nf-dev-host-instances',
    setup(build) {
      const options = build.initialOptions;

      if (options.platform !== 'node') {
        return;
      }

      options.inject = [...(options.inject ?? []), BRIDGE_MODULE];

      options.external = [
        ...(options.external ?? []),
        '@softarc/native-federation-orchestrator/node',
        '@softarc/native-federation-orchestrator',
      ];
    },
  };
}
