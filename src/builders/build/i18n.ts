import type { BuilderContext } from '@angular-devkit/architect';
import { logger } from '@softarc/native-federation/internal';
import { execSync } from 'child_process';
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

function getSourceLocaleCode(i18n: I18nConfig): string {
  return typeof i18n.sourceLocale === 'string' ? i18n.sourceLocale : i18n.sourceLocale.code;
}

// Mirrors @angular/build's i18n-options: a locale's output folder is its subPath, defaulting to the code
export function getLocaleSubPath(i18n: I18nConfig, locale: string): string {
  if (locale === getSourceLocaleCode(i18n)) {
    return typeof i18n.sourceLocale === 'string' ? locale : (i18n.sourceLocale.subPath ?? locale);
  }
  const config = i18n.locales[locale];
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    return config.subPath ?? locale;
  }
  return locale;
}

export async function translateFederationArtifacts(
  i18n: I18nConfig,
  localize: boolean | string[],
  outputPath: string,
  federationResult: FederationInfo,
  workspaceRoot: string
) {
  outputPath = path.resolve(workspaceRoot, outputPath);
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

  const sourceLocale = getSourceLocaleCode(i18n);

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

  // Here, we use a glob with an exhaustive list i/o `"*.js"`
  // to improve performance
  const sourcePattern = '{' + federationFiles.join(',') + '}';

  const localePath = (locale: string) =>
    path.join(outputPath, 'browser', getLocaleSubPath(i18n, locale));
  const sourceLocalePath = localePath(sourceLocale);

  const localizeTranslate = path.resolve(workspaceRoot, 'node_modules/.bin/localize-translate');

  const cmd = `"${localizeTranslate}" -r "${sourceLocalePath}" -s "${sourcePattern}" -t ${translationFiles} -o "${translationOutPath}" --target-locales ${targetLocales} -l ${sourceLocale}`;

  const targetPaths = locales.map(localePath);
  ensureDistFolders(targetPaths);
  copyRemoteEntry(targetPaths, sourceLocalePath);

  logger.debug('Running: ' + cmd);

  try {
    execCommand(cmd, workspaceRoot, 'Successfully translated');
    for (const locale of new Set([sourceLocale, ...locales])) {
      const staged = path.join(stagingPath, locale);
      if (fs.existsSync(staged)) {
        fs.cpSync(staged, localePath(locale), { recursive: true });
      }
    }
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

function execCommand(cmd: string, cwd: string, defaultSuccessInfo: string) {
  try {
    // translation file paths from angular.json are workspace-relative
    const output = execSync(cmd, { cwd });
    logger.info(output.toString() || defaultSuccessInfo);
  } catch (error) {
    logger.error((error as Error).message!);
  }
}

function copyRemoteEntry(targetPaths: string[], sourceLocalePath: string) {
  const remoteEntry = path.join(sourceLocalePath, 'remoteEntry.json');

  for (const targetPath of targetPaths) {
    fs.copyFileSync(remoteEntry, path.join(targetPath, 'remoteEntry.json'));
  }
}

function ensureDistFolders(targetPaths: string[]) {
  for (const targetPath of targetPaths) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}
