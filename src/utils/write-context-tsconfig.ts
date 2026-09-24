import type { EntryPoint } from '@softarc/native-federation';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import type * as TypeScript from 'typescript';
import { logger } from '@softarc/native-federation/internal';

export interface ContextTsConfigOptions {
  workspaceRoot: string;
  tsConfigPath: string;
  cacheDir: string;
  bundleName: string;
  entryPoints: EntryPoint[];
  fallbackEntryPoints?: string[];
}

const warnedAboutFiles = new Set<string>();

// One tsconfig per build context, so each program holds only its own entry points (#138).
export function writeContextTsConfig(options: ContextTsConfigOptions): string {
  const { workspaceRoot, tsConfigPath, cacheDir, bundleName, entryPoints } = options;
  const federationTsConfig = path.resolve(workspaceRoot, tsConfigPath);

  if (!fs.existsSync(federationTsConfig)) {
    throw new Error(
      `The federation tsconfig "${tsConfigPath}" does not exist, so the exposed modules and ` +
        `shared mappings cannot be added to the TypeScript program.`
    );
  }

  const federation = readFederationTsConfig(workspaceRoot, federationTsConfig);

  if (federation.ownFiles && !warnedAboutFiles.has(federationTsConfig)) {
    warnedAboutFiles.add(federationTsConfig);
    logger.warn(
      `"${tsConfigPath}" lists "files", which the federation build ignores: every build ` +
        `context compiles its own exposes and shared mappings. Remove "files" to silence this.`
    );
  }

  // Core hands exposes over workspace-root-relative and shared mappings absolute.
  const resolved = entryPoints.map(ep => path.resolve(workspaceRoot, ep.fileName));

  // A host without exposes or shared mappings would otherwise get an empty program.
  const files = [
    ...new Set(
      resolved.length > 0
        ? resolved
        : (options.fallbackEntryPoints ?? []).map(file => path.resolve(workspaceRoot, file))
    ),
  ].map(toPosix);

  const contextTsConfig = path.join(
    cacheDir,
    'tsconfig',
    `${hashOf(federationTsConfig)}.${bundleName.replace(/[^A-Za-z0-9._-]/g, '_')}.json`
  );

  const content = JSON.stringify(
    {
      extends: toPosix(federationTsConfig),
      compilerOptions: { typeRoots: federation.typeRoots.map(toPosix) },
      files,
    },
    null,
    2
  );

  if (!fs.existsSync(contextTsConfig) || fs.readFileSync(contextTsConfig, 'utf-8') !== content) {
    fs.mkdirSync(path.dirname(contextTsConfig), { recursive: true });
    fs.writeFileSync(contextTsConfig, content);
  }

  return contextTsConfig;
}

function readFederationTsConfig(
  workspaceRoot: string,
  federationTsConfig: string
): { ownFiles: boolean; typeRoots: string[] } {
  // The workspace's compiler, the one Angular builds with; the adapter ships none.
  const ts: typeof TypeScript = createRequire(path.join(workspaceRoot, 'package.json'))(
    'typescript'
  );
  const { config } = ts.readConfigFile(federationTsConfig, ts.sys.readFile);
  // Before parsing, which copies an inherited `files` into `config`.
  const ownFiles = Array.isArray(config?.files) && config.files.length > 0;
  const { options } = ts.parseJsonConfigFileContent(
    config ?? {},
    ts.sys,
    path.dirname(federationTsConfig),
    undefined,
    federationTsConfig
  );

  return {
    ownFiles,
    // Defaults are resolved from the leaf config's directory, which is now the cache dir.
    typeRoots: ts.getEffectiveTypeRoots(options, ts.sys) ?? [],
  };
}

function hashOf(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
