/**
 * Node `--import` preload that registers Native Federation's server-side loader
 * before the Angular SSR bundle's module graph is evaluated. Launch with:
 *
 *   node --import @angular-architects/native-federation-v4/node-preload dist/<app>/server/server.mjs
 *
 * The CLI prepends `@angular/ssr` into the emitted entry, so its static graph
 * pulls in `@angular/*` before the entry body runs. Since `module.register()`
 * only intercepts modules loaded after it, registration must happen in an earlier
 * graph — and a `--import` module is fully evaluated (top-level await included)
 * before Node loads the entry, giving exactly that.
 *
 * Startup outcome is published on `globalThis.__NF_FEDERATION_STATUS__` so a
 * health route can fail readiness when a remote was unreachable at boot.
 */
import { initNodeFederation } from '@softarc/native-federation-orchestrator/node';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Startup status of the server-side federation loader, published on the global. */
export interface FederationStatus {
  /** true if every *required* remote registered (see NF_REQUIRE_REMOTES). */
  ok: boolean;
  /** Remotes that registered successfully at startup. */
  initialized: string[];
  /** Remotes the manifest expected but that did not register. */
  missing: string[];
  /** Init-level failure message, if `initNodeFederation` rejected outright. */
  error?: string;
}

/** Global slot the app's SSR config reads to resolve federated remotes. */
export const SERVER_LOADER_GLOBAL_KEY = '__NF_HOST_SERVER_LOADER__';
/** Global slot holding the {@link FederationStatus} for health/readiness checks. */
export const FEDERATION_STATUS_GLOBAL_KEY = '__NF_FEDERATION_STATUS__';

/**
 * Resolve the `browser` output dir holding the federation artifacts
 * (`federation.manifest.json`, `remoteEntry.json`). Prefers `NF_BROWSER_DIR`
 * (absolute or cwd-relative) for custom layouts; otherwise `../browser` relative
 * to the launched entry, so one preload serves the host and every remote.
 */
export function resolveBrowserDir(): string {
  const fromEnv = process.env['NF_BROWSER_DIR'];
  if (fromEnv) {
    return isAbsolute(fromEnv) ? fromEnv : resolve(process.cwd(), fromEnv);
  }
  const entry = process.argv[1];
  if (!entry) {
    throw new Error(
      '[native-federation] cannot derive the browser output dir: process.argv[1] ' +
        "is empty. Set NF_BROWSER_DIR to the app's browser output directory."
    );
  }
  return join(dirname(resolve(entry)), '../browser');
}

/**
 * Remotes the host expects, read from its manifest. Empty for a remote or a
 * standalone app (no manifest) — those require no other remotes.
 */
function readExpectedRemotes(manifestPath: string): string[] {
  if (!existsSync(manifestPath)) {
    return [];
  }
  try {
    const json = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    return Object.keys(json ?? {});
  } catch {
    return [];
  }
}

/**
 * Which remotes the federation runtime actually registered. Reaches into the
 * orchestrator's remote-info repository, so it is guarded against shape drift:
 * any failure degrades to "none registered" rather than crashing the preload.
 */
function readRegisteredRemotes(result: unknown): string[] {
  try {
    const repo = (
      result as { adapters?: { remoteInfoRepo?: { getAll?: () => Record<string, unknown> } } }
    )?.adapters?.remoteInfoRepo;
    return Object.keys(repo?.getAll?.() ?? {});
  } catch {
    return [];
  }
}

const browserDir = resolveBrowserDir();
// Static hosts have no manifest; an empty one still registers shared externals
// via `hostRemoteEntry`, which dedupes `@angular/*`.
const manifestPath = join(browserDir, 'federation.manifest.json');
const hostRemoteEntry = pathToFileURL(join(browserDir, 'remoteEntry.json')).href;
const expectedRemotes = readExpectedRemotes(manifestPath);

const globalSlot = globalThis as Record<string, unknown>;
let status: FederationStatus;

try {
  const result = await initNodeFederation(existsSync(manifestPath) ? manifestPath : {}, {
    hostRemoteEntry,
    // Bridge the host's shared singletons (`@angular/*`, rxjs, zone.js, …) to
    // remotes during SSR: each is resolved through the import map and published
    // on globalThis.__NF_HOST_INSTANCES__. Without it a remote's
    // `@angular/core/rxjs-interop` loads a private chunk → NG0203.
    hostInstances: 'all',
  });

  // Bridge the loader to the app (read by the host's SSR render code).
  globalSlot[SERVER_LOADER_GLOBAL_KEY] = result.loadRemoteModule;

  // An unreachable remote may resolve with that remote simply absent (rather than
  // rejecting init, handled in `catch`) — reconcile expected against registered.
  const registered = readRegisteredRemotes(result);
  const missing = expectedRemotes.filter(remote => !registered.includes(remote));
  status = { ok: missing.length === 0, initialized: registered, missing };

  if (missing.length > 0) {
    console.warn(
      `[native-federation] ${missing.length} remote(s) not registered at startup: ` +
        `${missing.join(', ')} — their federated regions will render empty.`
    );
  }
} catch (err) {
  // Init rejected outright (e.g. a remote was unreachable and the flow threw):
  // the loader was never published, so all federation is unavailable.
  const message = err instanceof Error ? err.message : String(err);
  status = { ok: false, initialized: [], missing: expectedRemotes, error: message };
  console.warn(
    '[native-federation] initNodeFederation failed; SSR will render without federated remotes:',
    message
  );
}

globalSlot[FEDERATION_STATUS_GLOBAL_KEY] = status;

// Optional strict gate (off by default): exit non-zero if required remotes are
// missing, so a mis-sequenced restart fails readiness instead of serving blank
// pages.
//   NF_REQUIRE_REMOTES=all        → every manifest remote is required
//   NF_REQUIRE_REMOTES=mfe1,mfe2  → only the listed remotes are required
const requireSpec = process.env['NF_REQUIRE_REMOTES'];
if (requireSpec) {
  const required =
    requireSpec === 'all'
      ? expectedRemotes
      : requireSpec
          .split(',')
          .map(name => name.trim())
          .filter(Boolean);
  const unmet = required.filter(remote => status.missing.includes(remote));
  if (unmet.length > 0) {
    console.error(
      `[native-federation] required remote(s) unavailable at startup: ${unmet.join(', ')}. ` +
        `Exiting (NF_REQUIRE_REMOTES=${requireSpec}).`
    );
    process.exit(1);
  }
}
