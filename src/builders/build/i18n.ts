import type { BuilderContext } from '@angular-devkit/architect';
import { logger } from '@softarc/native-federation/internal';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import os from 'os';
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
  sourceLocale?: string | SourceLocaleObject;
  locales: Record<string, LocaleTranslation | LocaleObject>;
};

type SourceLocaleObject = {
  code?: string;
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

// @angular/build defaults a missing sourceLocale (or sourceLocale.code) to en-US
export function getSourceLocaleCode(i18n: I18nConfig): string {
  const sourceLocale = i18n.sourceLocale;
  return (typeof sourceLocale === 'string' ? sourceLocale : sourceLocale?.code) ?? 'en-US';
}

// Mirrors @angular/build's i18n-options: a locale's output folder is its subPath, defaulting to the code
export function getLocaleSubPath(i18n: I18nConfig, locale: string): string {
  if (locale === getSourceLocaleCode(i18n)) {
    return typeof i18n.sourceLocale === 'string' ? locale : (i18n.sourceLocale?.subPath ?? locale);
  }
  const config = i18n.locales[locale];
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    return config.subPath ?? locale;
  }
  return locale;
}

export function translateFederationArtifacts(
  i18n: I18nConfig,
  localize: boolean | string[],
  outputPath: string,
  federationResult: FederationInfo,
  workspaceRoot: string
) {
  outputPath = path.resolve(workspaceRoot, outputPath);
  const sourceLocale = getSourceLocaleCode(i18n);
  const neededLocales = Array.isArray(localize) ? localize : Object.keys(i18n.locales);

  const locales = Object.keys(i18n.locales).filter(locale => neededLocales.includes(locale));

  // Angular inlines $localize in the source locale whenever it builds it, but the federation output is
  // not built by Angular. `-l` below makes localize-translate write that copy, so the source locale only
  // needs a run of its own when there is no other locale to translate.
  const inlineSourceLocale =
    localize === true || (Array.isArray(localize) && localize.includes(sourceLocale));

  if (locales.length === 0 && !inlineSourceLocale) {
    return;
  }

  logger.info('Writing Translations');

  // localize-translate expects a list of files for one locale as `[a,b]`
  const translationFiles = locales
    .map(loc => i18n.locales[loc])
    .map(config =>
      typeof config === 'string' || Array.isArray(config) ? config : config!.translation!
    )
    .map(files => (Array.isArray(files) ? `[${files.join(',')}]` : files));

  // {{LOCALE}} expands to the locale code, not its subPath, so translate into a staging folder first
  const stagingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-i18n-'));
  const translationOutPath = path.join(stagingPath, '{{LOCALE}}');

  const federationFiles = [
    ...federationResult.shared.flatMap(s =>
      'entries' in s ? Object.values(s.entries) : [s.outFileName]
    ),
    ...federationResult.exposes.map(e => e.outFileName),
    ...Object.values(federationResult.chunks ?? {}).flat(),
  ];

  const localePath = (locale: string) =>
    path.join(outputPath, 'browser', getLocaleSubPath(i18n, locale));
  const sourceLocalePath = localePath(sourceLocale);

  const localizeTranslate = resolveLocalizeTranslate(workspaceRoot);

  const inputPath = path.join(stagingPath, '.input');

  const args = [
    localizeTranslate,
    '-r',
    inputPath,
    '-s',
    '**/*',
    '-t',
    ...translationFiles,
    '-o',
    translationOutPath,
    ...(locales.length > 0 ? ['--target-locales', ...locales] : []),
    '-l',
    sourceLocale,
  ];

  const targetPaths = locales.map(localePath);
  ensureDistFolders(targetPaths);
  copyRemoteEntry(targetPaths, sourceLocalePath);

  try {
    // An exhaustive list, not `*.js`: on a watch rebuild the source locale folder also holds Angular's output
    stageFiles(federationFiles, sourceLocalePath, inputPath);

    logger.debug('Running: ' + [process.execPath, ...args].join(' '));
    execCommand(process.execPath, args, workspaceRoot, 'Successfully translated');
    const translatedPaths: string[] = [];
    for (const locale of new Set([sourceLocale, ...locales])) {
      const staged = path.join(stagingPath, locale);
      if (fs.existsSync(staged)) {
        fs.cpSync(staged, localePath(locale), { recursive: true });
        translatedPaths.push(localePath(locale));
      }
    }

    // Translating changes the bundles, so the integrity hashes in the copied remoteEntry.json are stale
    refreshIntegrity(translatedPaths);
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

// Run the CLI script with node directly: .bin/localize-translate is a shell script on POSIX and a
// .cmd shim on Windows, which can only be started through cmd.exe (and its 8191 character limit)
function resolveLocalizeTranslate(workspaceRoot: string): string {
  const workspaceRequire = createRequire(path.join(workspaceRoot, 'package.json'));
  let packageJsonPath: string;
  try {
    packageJsonPath = workspaceRequire.resolve('@angular/localize/package.json');
  } catch {
    throw new Error(
      '@angular/localize could not be found. Install it to build with i18n translations.'
    );
  }
  const { bin } = workspaceRequire(packageJsonPath) as { bin: Record<string, string> };
  return path.resolve(path.dirname(packageJsonPath), bin['localize-translate']!);
}

function execCommand(file: string, args: string[], cwd: string, defaultSuccessInfo: string) {
  try {
    // translation file paths from angular.json are workspace-relative
    const output = execFileSync(file, args, { cwd });
    logger.info(output.toString() || defaultSuccessInfo);
  } catch (error) {
    logger.error((error as Error).message!);
    // Swallowing this leaves the non-source locale folders without their federation files
    // (only remoteEntry.json is copied), so the build would succeed and ship broken locales.
    throw error;
  }
}

// remoteEntry.json lists a subresource integrity hash per file when the integrityHashes feature is on
function refreshIntegrity(localePaths: string[]) {
  for (const localePath of localePaths) {
    const remoteEntryPath = path.join(localePath, 'remoteEntry.json');
    if (!fs.existsSync(remoteEntryPath)) {
      continue;
    }

    const remoteEntry = JSON.parse(fs.readFileSync(remoteEntryPath, 'utf-8')) as {
      integrity?: Record<string, string>;
    };
    if (!remoteEntry.integrity) {
      continue;
    }

    for (const [file, previous] of Object.entries(remoteEntry.integrity)) {
      const filePath = path.join(localePath, file);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const algorithm = previous.split('-')[0]!;
      const hash = createHash(algorithm).update(fs.readFileSync(filePath)).digest('base64');
      remoteEntry.integrity[file] = `${algorithm}-${hash}`;
    }

    fs.writeFileSync(remoteEntryPath, JSON.stringify(remoteEntry, null, 2));
  }
}

function copyRemoteEntry(targetPaths: string[], sourceLocalePath: string) {
  const remoteEntry = path.join(sourceLocalePath, 'remoteEntry.json');

  for (const targetPath of targetPaths) {
    fs.copyFileSync(remoteEntry, path.join(targetPath, 'remoteEntry.json'));
  }
}

// A listed file that is missing fails the build instead of being skipped
function stageFiles(files: string[], fromDir: string, toDir: string) {
  fs.mkdirSync(toDir, { recursive: true });
  for (const file of new Set(files)) {
    fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
  }
}

function ensureDistFolders(targetPaths: string[]) {
  for (const targetPath of targetPaths) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}
