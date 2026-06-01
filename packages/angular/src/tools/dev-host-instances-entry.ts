/**
 * Dev-only SSR host-instance bridge for `ng serve`.
 *
 * Under `ng serve` Angular renders the host through Vite's SSR module runner,
 * which loads `@angular/*` in a different module realm than the orchestrator's
 * Node loader uses for remotes — two `@angular/core` instances → NG0203. This
 * module publishes the host's singletons on `globalThis.__NF_HOST_INSTANCES__`
 * (captured in the host's realm via our own `load`) so remotes re-use them.
 *
 * Unlike prod — which runs `node --import .../node-preload` (see
 * `src/node-preload.ts`) — `ng serve` exposes no user-authored SSR entry and no
 * `--import` hook, and Angular owns the dev SSR pipeline in Vite's realm. So the
 * build plugin (`plugin/dev-host-instances-plugin.ts`) injects this module into
 * the server bundle via esbuild `inject`, ahead of the app. It is real, compiled,
 * type-checked code — NOT generated source; its two per-build values arrive
 * through `process.env` (set by `builders/build/builder.ts`), the same channel
 * prod's preload uses.
 *
 * Init runs lazily, on the first remote load — never at module evaluation — and
 * is bounded by a timeout, so a wedged or slow init degrades to a clear, logged
 * error instead of deadlocking every SSR request (including non-federated
 * routes, which was the original failure mode).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NativeFederationResult } from '@softarc/native-federation-orchestrator';

type LoadRemoteModule = NativeFederationResult['loadRemoteModule'];

// Per-build values, set by the builder before the dev server serves a request.
// `process.env` is process-global, so it crosses the Vite SSR realm boundary
// that `globalThis` would not.
const relBrowserPath = process.env['NF_DEV_SSR_BROWSER_PATH'] ?? '';
const devServerOrigin = process.env['NF_DEV_SSR_ORIGIN'] || null;

// Bound init so a wedged or slow orchestrator init can never hang a render
// forever. Override for genuinely slow remotes via NF_DEV_SSR_INIT_TIMEOUT_MS.
const INIT_TIMEOUT_MS = Number(process.env['NF_DEV_SSR_INIT_TIMEOUT_MS']) || 10_000;

const browserDir = join(process.cwd(), relBrowserPath);
const manifestPath = join(browserDir, 'federation.manifest.json');

// Vite serves the manifest and remote entries from memory under `ng serve`, so
// prefer the dev server's origin over the never-present on-disk path.
const hostRemoteEntry = devServerOrigin
  ? devServerOrigin + '/remoteEntry.json'
  : join(browserDir, 'remoteEntry.json');

// A static host returns 404 for the manifest — treat that as an empty manifest
// (which still bridges host singletons) instead of failing init. With no known
// origin, fall back to the on-disk path.
async function resolveManifest(): Promise<string | object> {
  if (devServerOrigin) {
    try {
      const res = await fetch(devServerOrigin + '/federation.manifest.json');
      if (res.ok) return (await res.json()) as object;
      return {};
    } catch {
      // Origin unreachable — fall through to the on-disk path.
    }
  }
  return existsSync(manifestPath) ? manifestPath : {};
}

const g = globalThis as Record<string, unknown>;

if (!g['__NF_HOST_SERVER_LOADER__']) {
  let initPromise: Promise<LoadRemoteModule | null> | undefined;

  async function initFederation(): Promise<LoadRemoteModule> {
    const { initNodeFederation } = await import(
      '@softarc/native-federation-orchestrator/node'
    );
    const { loadRemoteModule } = await initNodeFederation(
      (await resolveManifest()) as Parameters<typeof initNodeFederation>[0],
      {
        hostRemoteEntry,
        // load through THIS module's graph so we capture the host's instances,
        // not the orchestrator realm's (which differs under Vite SSR).
        hostInstances: { load: (s: string) => import(/* @vite-ignore */ s) },
      }
    );

    // Published iff the bridge actually ran. If not, fail loudly — a missing
    // bridge otherwise surfaces as an intermittent, hard-to-trace NG0203.
    const published = g['__NF_HOST_INSTANCES__'] as Record<string, unknown> | undefined;
    if (!published || Object.keys(published).length === 0) {
      throw new Error(
        '[native-federation] dev SSR host-instance bridge did not engage — ' +
          'globalThis.__NF_HOST_INSTANCES__ was not published. Usually ' +
          "'@softarc/native-federation-orchestrator/node' was bundled by Vite " +
          'instead of externalized (so its module.register() loader never ran), ' +
          'or the installed orchestrator predates the hostInstances bridge.'
      );
    }
    return loadRemoteModule;
  }

  // One-shot init, kicked off (and memoised) by the first remote load. Bounded
  // so a never-resolving init degrades to "render without remotes" instead of an
  // indefinite, log-silent hang.
  function ensureInit(): Promise<LoadRemoteModule | null> {
    if (!initPromise) {
      const timeout = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `[native-federation] dev SSR federation init timed out after ` +
                  `${INIT_TIMEOUT_MS}ms. A required remote may be unreachable; ` +
                  `raise NF_DEV_SSR_INIT_TIMEOUT_MS to wait longer.`
              )
            ),
          INIT_TIMEOUT_MS
        );
        // Don't keep the dev server's event loop alive just for this timer.
        (timer as { unref?: () => void }).unref?.();
      });

      initPromise = Promise.race([initFederation(), timeout]).catch((err: unknown) => {
        // Memoise the failure (matches the original "init once" semantics — no
        // retry until the next dev-server restart); a remote load then throws.
        console.warn(
          '[native-federation] dev SSR: federation init failed; remotes are ' +
            'unavailable until restart:',
          err instanceof Error ? err.message : err
        );
        return null;
      });
    }
    return initPromise;
  }

  // Published synchronously so the SSR entry sees a loader at module-eval time,
  // but evaluating this module never blocks: the first call runs init and waits
  // for it, later calls reuse it, and an app that loads no remotes (a pure
  // remote) never runs init at all.
  g['__NF_HOST_SERVER_LOADER__'] = async (
    ...args: Parameters<LoadRemoteModule>
  ): Promise<unknown> => {
    const loadRemoteModule = await ensureInit();
    if (!loadRemoteModule) {
      throw new Error(
        '[native-federation] dev SSR: federation unavailable (init failed or ' +
          'timed out); cannot load remote module.'
      );
    }
    return loadRemoteModule(...args);
  };
}
