import type { BuilderContext } from '@angular-devkit/architect';
import {
  logger,
  type NormalizedExternalConfig,
  type NormalizedFederationConfig,
} from '@softarc/native-federation/internal';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { FederationInfo } from '@softarc/native-federation';

type WorkspaceConfig = {
  i18n?: I18nConfig;
};

type LocaleTranslation = string | string[];

type LocaleObject = {
  translation: LocaleTranslation;
  baseHref?: string;
  subPath?: string;
};

export type I18nConfig = {
  sourceLocale: string | SourceLocaleObject;
  locales: Record<string, LocaleTranslation | LocaleObject>;
};

type SourceLocaleObject = {
  code: string;
  baseHref?: string;
  subPath?: string;
};

export async function getI18nConfig(context: BuilderContext): Promise<I18nConfig | undefined> {
  const workspaceConfig = (await context.getProjectMetadata(
    context.target?.project || ''
  )) as WorkspaceConfig;

  const i18nConfig = workspaceConfig?.i18n;
  return i18nConfig;
}

export async function translateFederationArtifacts(
  i18n: I18nConfig,
  localize: boolean | string[],
  outputPath: string,
  federationResult: FederationInfo
) {
  const neededLocales = Array.isArray(localize) ? localize : Object.keys(i18n.locales);

  const locales = Object.keys(i18n.locales).filter(locale => neededLocales.includes(locale));

  if (locales.length === 0) {
    return;
  }

  logger.info('Writing Translations');

  const translationFiles = locales
    .map(loc => i18n.locales[loc])
    .map(config =>
      typeof config === 'string' || Array.isArray(config) ? config : config!.translation!
    )
    .map(files => JSON.stringify(files))
    .join(' ');

  const targetLocales = locales.join(' ');

  const sourceLocale =
    typeof i18n.sourceLocale === 'string' ? i18n.sourceLocale : i18n.sourceLocale.code;

  const translationOutPath = path.join(outputPath, 'browser', '{{LOCALE}}');

  const federationFiles = [
    ...federationResult.shared.flatMap(s =>
      'entries' in s ? Object.values(s.entries) : [s.outFileName]
    ),
    ...federationResult.exposes.map(e => e.outFileName),
    ...Object.values(federationResult.chunks ?? {}).flat(),
  ];

  // Here, we use a glob with an exhaustive list i/o `"*.js"`
  // to improve performance
  const sourcePattern = '{' + federationFiles.join(',') + '}';

  const sourceLocalePath = path.join(outputPath, 'browser', sourceLocale);

  const localizeTranslate = path.resolve('node_modules/.bin/localize-translate');

  const cmd = `"${localizeTranslate}" -r "${sourceLocalePath}" -s "${sourcePattern}" -t ${translationFiles} -o "${translationOutPath}" --target-locales ${targetLocales} -l ${sourceLocale}`;

  ensureDistFolders(locales, outputPath);
  copyRemoteEntry(locales, outputPath, sourceLocalePath);

  logger.debug('Running: ' + cmd);

  execCommand(cmd, 'Successfully translated');
}

function execCommand(cmd: string, defaultSuccessInfo: string) {
  try {
    const output = execSync(cmd);
    logger.info(output.toString() || defaultSuccessInfo);
  } catch (error) {
    logger.error((error as Error).message!);
  }
}

function copyRemoteEntry(locales: string[], outputPath: string, sourceLocalePath: string) {
  const remoteEntry = path.join(sourceLocalePath, 'remoteEntry.json');

  for (const locale of locales) {
    const localePath = path.join(outputPath, 'browser', locale, 'remoteEntry.json');
    fs.copyFileSync(remoteEntry, localePath);
  }
}

function ensureDistFolders(locales: string[], outputPath: string) {
  for (const locale of locales) {
    const localePath = path.join(outputPath, 'browser', locale);
    fs.mkdirSync(localePath, { recursive: true });
  }
}

const LOCALE_DATA_BASE_MODULE = '@angular/common/locales/global';

// `en`/`en-US` data is inlined by Angular and never emitted as a bare specifier.
function isBuiltInEnglishLocale(code: string): boolean {
  return code === 'en' || code === 'en-US';
}

export type ResolvedLocaleData = {
  /** Bare specifier emitted by Angular, e.g. "@angular/common/locales/global/de-CH" */
  packageName: string;
  /** Path to the locale data file, relative to the workspace root */
  entryPoint: string;
  /** The locale tag that matched on disk (may be a prefix of the request) */
  matchedCode: string;
  /** Version of @angular/common */
  version: string;
};

/**
 * Resolves the `@angular/common/locales/global/<code>` file on disk, mirroring
 * Angular's progressive locale-tag fallback (de-CH → de).
 */
export function resolveAngularLocaleData(
  code: string,
  workspaceRoot: string
): ResolvedLocaleData | null {
  if (!code || isBuiltInEnglishLocale(code)) {
    return null;
  }

  const angularCommonRoot = path.join(workspaceRoot, 'node_modules', '@angular', 'common');
  let version = '0.0.0';
  const pkgJsonPath = path.join(angularCommonRoot, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      version = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).version ?? version;
    } catch {
      // fall back to the placeholder version
    }
  }

  let partial = code;
  while (partial) {
    for (const ext of ['.js', '.mjs']) {
      const rel = path.posix.join(
        'node_modules',
        '@angular',
        'common',
        'locales',
        'global',
        `${partial}${ext}`
      );
      const abs = path.join(workspaceRoot, rel);
      if (fs.existsSync(abs)) {
        return {
          packageName: `${LOCALE_DATA_BASE_MODULE}/${partial}`,
          entryPoint: rel,
          matchedCode: partial,
          version,
        };
      }
    }

    const parts = partial.split('-');
    if (parts.length <= 1) {
      break;
    }
    partial = parts.slice(0, -1).join('-');
  }

  return null;
}

/**
 * With a non-English `i18n.sourceLocale` (or an inline dev-server locale),
 * Angular emits bare `@angular/common/locales/global/<code>` imports that rely
 * on vite's dep-prebundling. Native Federation's importmap replaces that layer,
 * leaving the specifier unresolved in the browser. This injects the locale data
 * as shared entries so the bundler emits them and the importmap lists them.
 *
 * Returns the registered package names, for diagnostics and tests.
 */
export function registerAngularLocaleDataInFederationConfig(
  config: NormalizedFederationConfig,
  i18n: I18nConfig | undefined,
  workspaceRoot: string,
  inlineLocales: readonly string[] = []
): string[] {
  if (!i18n) {
    return [];
  }

  const sourceCode =
    typeof i18n.sourceLocale === 'string' ? i18n.sourceLocale : i18n.sourceLocale?.code;

  const candidates = new Set<string>();
  if (sourceCode) {
    candidates.add(sourceCode);
  }
  for (const loc of inlineLocales) {
    candidates.add(loc);
  }

  const registered: string[] = [];

  for (const code of candidates) {
    if (isBuiltInEnglishLocale(code)) {
      continue;
    }

    const resolved = resolveAngularLocaleData(code, workspaceRoot);
    if (!resolved) {
      logger.warn(
        `Could not locate '${LOCALE_DATA_BASE_MODULE}/${code}' in node_modules. ` +
          `The browser will not be able to resolve this bare specifier at runtime. ` +
          `Verify that @angular/common is installed, or share the locale data manually via federation.config.js.`
      );
      continue;
    }

    if (config.shared[resolved.packageName]) {
      // Already shared explicitly by the user – leave it alone.
      continue;
    }

    const entry: NormalizedExternalConfig = {
      singleton: true,
      strictVersion: false,
      requiredVersion: resolved.version,
      version: resolved.version,
      chunks: false,
      platform: 'browser',
      build: 'default',
      packageInfo: {
        entryPoint: resolved.entryPoint,
        version: resolved.version,
        esm: true,
      },
    };
    config.shared[resolved.packageName] = entry;
    registered.push(resolved.packageName);
  }

  return registered;
}
