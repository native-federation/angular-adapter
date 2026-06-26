export * from '@softarc/native-federation/domain';
import {
  initFederation as internalInitFederation,
  type NativeFederationResult,
} from '@softarc/native-federation-orchestrator';
import {
  useShimImportMap,
  consoleLogger,
  globalThisStorageEntry,
  type LogType,
} from '@softarc/native-federation-orchestrator/options';

export type Imports = Record<string, string>;
export type Scopes = Record<string, Imports>;
export type ImportMap = {
  imports: Imports;
  scopes: Scopes;
};

/**
 * Options for {@link loadRemoteModule}. Mirrors the shape in
 * `@softarc/native-federation-runtime`.
 *
 * @property remoteEntry - URL to the remote's `remoteEntry.json`. Enables
 *   lazy-loading remotes not registered during `initFederation`.
 * @property remoteName - Name of the remote. If omitted, derived from
 *   `remoteEntry` (its manifest's `name`).
 * @property exposedModule - Key exposed by the remote (e.g. `'./Component'`).
 * @property fallback - Value returned on failure. Truthy-only — `null`/`0`/`''`
 *   count as "no fallback".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoadRemoteModuleOptions<T = any> = {
  remoteEntry?: string;
  remoteName?: string;
  exposedModule: string;
  fallback?: T;
};

export interface InitFederationOptions {
  cacheTag?: string;
  logging?: LogType;
  sse?: boolean;
}

let resolveFirstInit!: (
  value: NativeFederationResult | PromiseLike<NativeFederationResult>
) => void;
let rejectFirstInit!: (reason?: unknown) => void;
let firstInitCaptured = false;
let federationPromise: Promise<NativeFederationResult> = new Promise(
  (resolve, reject) => {
    resolveFirstInit = resolve;
    rejectFirstInit = reject;
  }
);

export function initFederation(
  remotesOrManifestUrl?: Record<string, string> | string,
  options?: InitFederationOptions
) {
  const p = internalInitFederation(remotesOrManifestUrl ?? {}, {
    ...useShimImportMap({ shimMode: true }),
    logger: consoleLogger,
    storage: globalThisStorageEntry,
    hostRemoteEntry: { url: './remoteEntry.json', cacheTag: options?.cacheTag },
    logLevel: options?.logging ?? 'debug',
    sse: options?.sse,
  });
  if (!firstInitCaptured) {
    firstInitCaptured = true;
    p.then(resolveFirstInit, rejectFirstInit);
  }
  federationPromise = p;
  return p;
}

function normalizeOptions<T>(
  optionsOrRemoteName: LoadRemoteModuleOptions<T> | string,
  exposedModule?: string
): LoadRemoteModuleOptions<T> {
  if (typeof optionsOrRemoteName === 'string' && exposedModule) {
    return { remoteName: optionsOrRemoteName, exposedModule };
  }
  if (typeof optionsOrRemoteName === 'object' && !exposedModule) {
    return optionsOrRemoteName;
  }
  throw new Error(
    'unexpected arguments: please pass options or a remoteName/exposedModule-pair'
  );
}

function logClientError(error: string): void {
  if (typeof window !== 'undefined') {
    console.error(error);
  }
}

async function resolveRemoteNameFromEntry(remoteEntry: string): Promise<string> {
  const res = await fetch(remoteEntry);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch remoteEntry at ${remoteEntry}: ${res.status} ${res.statusText}`
    );
  }
  const info = (await res.json()) as { name?: string };
  if (!info.name) {
    throw new Error(`remoteEntry at ${remoteEntry} does not declare a 'name'`);
  }
  return info.name;
}

/**
 * Dynamically loads a remote module. Spec-compatible with `loadRemoteModule`
 * from `@softarc/native-federation-runtime`; bridges to the orchestrator
 * (`@softarc/native-federation-orchestrator`) under the hood.
 *
 * ```ts
 * await loadRemoteModule({ remoteName: 'mfe1', exposedModule: './Component' });
 * await loadRemoteModule('mfe1', './Component');
 * ```
 *
 * Flow: normalize args → await `federationPromise` (may be called before
 * `initFederation`, then waits) → if only `remoteEntry` was given, fetch its
 * manifest for the name → if `remoteEntry` set, `initRemoteEntry(...)` first →
 * delegate to the orchestrator's `loadRemoteModule(remoteName, exposedModule)`.
 * On error, return truthy `fallback` (logging `console.error` in browsers) or
 * rethrow.
 *
 * @throws on bad arg combos, unresolvable `remoteName`, or load failure when
 *   no truthy `fallback` is set.
 *
 * @deprecated Prefer the `loadRemoteModule` returned by the `initFederation`
 *   promise. This top-level helper relies on a module-scoped federation
 *   instance and only resolves against the most recent `initFederation` call,
 *   which is brittle in tests and multi-host setups. Example:
 *   ```ts
 *   const { loadRemoteModule } = await initFederation(...);
 *   await loadRemoteModule('mfe1', './Component');
 *   ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRemoteModule<T = any>(
  options: LoadRemoteModuleOptions<T>
): Promise<T>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRemoteModule<T = any>(
  remoteName: string,
  exposedModule: string
): Promise<T>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRemoteModule<T = any>(
  optionsOrRemoteName: LoadRemoteModuleOptions<T> | string,
  exposedModule?: string
): Promise<T> {
  const options = normalizeOptions<T>(optionsOrRemoteName, exposedModule);
  const { fallback } = options;

  try {
    let federation = await federationPromise;

    if (!options.remoteName && options.remoteEntry) {
      options.remoteName = await resolveRemoteNameFromEntry(options.remoteEntry);
    }

    if (options.remoteEntry) {
      federation = await federation.initRemoteEntry(
        options.remoteEntry,
        options.remoteName
      );
    }

    if (!options.remoteName) {
      const err = 'unexpected arguments: Please pass remoteName or remoteEntry';
      if (!fallback) throw new Error(err);
      logClientError(err);
      return fallback;
    }

    return await federation.loadRemoteModule<T>(
      options.remoteName,
      options.exposedModule
    );
  } catch (err) {
    if (fallback) {
      logClientError(
        'error loading remote module: ' +
          (err instanceof Error ? err.message : String(err))
      );
      return fallback;
    }
    throw err;
  }
}

export { type NativeFederationResult } from '@softarc/native-federation-orchestrator';
