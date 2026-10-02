import * as fs from 'fs';
import { execSync } from 'child_process';
import { logger } from '@softarc/native-federation/internal';
import type { BuilderContext } from '@angular-devkit/architect';
import type { FederationInfo } from '@softarc/native-federation';

import {
  getI18nConfig,
  getLocaleSubPath,
  getSourceLocaleCode,
  translateFederationArtifacts,
  type I18nConfig,
} from './i18n.js';

vi.mock('fs');
vi.mock('child_process');

const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

const federationResult = {
  shared: [{ outFileName: 'dep1.js' }],
  exposes: [{ outFileName: './cmp.js' }],
  chunks: { c1: ['chunk1.js'] },
} as unknown as FederationInfo;

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  infoSpy.mockRestore();
  debugSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('getI18nConfig', () => {
  it('reads the i18n config from the project metadata', async () => {
    const i18n = { sourceLocale: 'en', locales: { de: 'm.de.xlf' } };
    const getProjectMetadata = vi.fn().mockResolvedValue({ i18n });
    const context = {
      target: { project: 'my-app' },
      getProjectMetadata,
    } as unknown as BuilderContext;

    const result = await getI18nConfig(context);

    expect(getProjectMetadata).toHaveBeenCalledWith('my-app');
    expect(result).toBe(i18n);
  });

  it('returns undefined when no i18n config is present', async () => {
    const context = {
      target: { project: 'my-app' },
      getProjectMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as BuilderContext;

    expect(await getI18nConfig(context)).toBeUndefined();
  });
});

describe('translateFederationArtifacts', () => {
  const i18n: I18nConfig = {
    sourceLocale: 'en',
    locales: {
      de: 'src/locale/messages.de.xlf',
      fr: { translation: ['a.xlf', 'b.xlf'] },
    },
  };

  beforeEach(() => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('translated ok'));
    vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/nf-i18n-x');
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('does nothing when no configured locale matches the requested ones', async () => {
    await translateFederationArtifacts(i18n, ['es'], 'dist', federationResult, '/ws');

    expect(execSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('filters to the intersection of requested and configured locales', async () => {
    await translateFederationArtifacts(i18n, ['de'], 'dist', federationResult, '/ws');

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('--target-locales de');
    expect(cmd).not.toContain(' fr');
  });

  it('builds the localize-translate command from the federation output files', async () => {
    await translateFederationArtifacts(i18n, true, 'dist', federationResult, '/ws');

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('localize-translate');
    expect(cmd).toContain('-s "{dep1.js,./cmp.js,chunk1.js}"');
    expect(cmd).toContain('--target-locales de fr');
    expect(cmd).toContain('-l en');
    // source locale dir is part of the -r reference path
    expect(cmd).toMatch(/-r "[^"]*browser\/en"/);
    // both translation file groups are passed
    expect(cmd).toContain('"src/locale/messages.de.xlf"');
    expect(cmd).toContain('["a.xlf","b.xlf"]');
  });

  it('collects dense shared entries when denseExternals is enabled', async () => {
    const denseResult = {
      shared: [{ entries: { esm: 'dep1.js', legacy: 'dep1.legacy.js' } }],
      exposes: [{ outFileName: './cmp.js' }],
      chunks: { c1: ['chunk1.js'] },
    } as unknown as FederationInfo;

    await translateFederationArtifacts(i18n, true, 'dist', denseResult, '/ws');

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('-s "{dep1.js,dep1.legacy.js,./cmp.js,chunk1.js}"');
  });

  it('uses sourceLocale.code when the source locale is an object', async () => {
    const objLocaleI18n: I18nConfig = {
      sourceLocale: { code: 'en-US' },
      locales: { de: 'm.de.xlf' },
    };

    await translateFederationArtifacts(objLocaleI18n, true, 'dist', federationResult, '/ws');

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('-l en-US');
  });

  // sourceLocale is optional in angular.json; @angular/build then uses en-US
  it('defaults the source locale to en-US when sourceLocale is omitted', async () => {
    await translateFederationArtifacts(
      { locales: { de: 'm.de.xlf' } },
      true,
      'dist',
      federationResult,
      '/ws'
    );

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    expect(cmd).toContain('-l en-US');
    expect(cmd).toMatch(/-r "[^"]*browser\/en-US"/);
  });

  it('creates a dist folder and copies the remoteEntry for each target locale', async () => {
    await translateFederationArtifacts(i18n, true, 'dist', federationResult, '/ws');

    const mkdirPaths = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]));
    expect(mkdirPaths.some(p => p.endsWith('browser/de'))).toBe(true);
    expect(mkdirPaths.some(p => p.endsWith('browser/fr'))).toBe(true);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.any(String), { recursive: true });

    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
    const copyTargets = vi.mocked(fs.copyFileSync).mock.calls.map(c => String(c[1]));
    expect(copyTargets.some(p => p.endsWith('browser/de/remoteEntry.json'))).toBe(true);
    expect(copyTargets.some(p => p.endsWith('browser/fr/remoteEntry.json'))).toBe(true);
  });

  it('resolves output, binary and cwd against workspaceRoot', async () => {
    await translateFederationArtifacts(i18n, ['de'], 'dist', federationResult, '/ws');

    const [cmd, opts] = vi.mocked(execSync).mock.calls[0]!;
    expect(cmd).toContain('"/ws/node_modules/.bin/localize-translate"');
    expect(cmd).toContain('-r "/ws/dist/browser/en"');
    expect(cmd).toContain('-o "/tmp/nf-i18n-x/{{LOCALE}}"');
    expect(opts).toEqual({ cwd: '/ws' });
    expect(fs.mkdirSync).toHaveBeenCalledWith('/ws/dist/browser/de', { recursive: true });
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/ws/dist/browser/en/remoteEntry.json',
      '/ws/dist/browser/de/remoteEntry.json'
    );
  });

  it('copies staged translations into each locale subPath and removes the staging folder', async () => {
    const subPathI18n: I18nConfig = {
      sourceLocale: { code: 'en-US', subPath: 'en' },
      locales: { de: { translation: 'm.de.xlf', subPath: 'deutsch' }, fr: 'm.fr.xlf' },
    };

    await translateFederationArtifacts(subPathI18n, true, 'dist', federationResult, '/ws');

    const cmd = vi.mocked(execSync).mock.calls[0]![0] as string;
    // localize-translate reads from the source subPath, but writes per locale code
    expect(cmd).toContain('-r "/ws/dist/browser/en"');
    expect(cmd).toContain('--target-locales de fr');
    expect(cmd).toContain('-l en-US');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/ws/dist/browser/deutsch', { recursive: true });
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      '/ws/dist/browser/en/remoteEntry.json',
      '/ws/dist/browser/deutsch/remoteEntry.json'
    );
    expect(vi.mocked(fs.cpSync).mock.calls).toEqual([
      ['/tmp/nf-i18n-x/en-US', '/ws/dist/browser/en', { recursive: true }],
      ['/tmp/nf-i18n-x/de', '/ws/dist/browser/deutsch', { recursive: true }],
      ['/tmp/nf-i18n-x/fr', '/ws/dist/browser/fr', { recursive: true }],
    ]);
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/nf-i18n-x', { recursive: true, force: true });
  });

  it('logs an error when the translate command fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('localize boom');
    });

    await translateFederationArtifacts(i18n, ['de'], 'dist', federationResult, '/ws');

    expect(errorSpy).toHaveBeenCalledWith('localize boom');
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/nf-i18n-x', { recursive: true, force: true });
  });
});

describe('getLocaleSubPath', () => {
  const i18n: I18nConfig = {
    sourceLocale: { code: 'en-US', subPath: '' },
    locales: { de: { translation: 'm.de.xlf', subPath: 'deutsch' }, fr: 'm.fr.xlf' },
  };

  it('uses the subPath when configured, the locale code otherwise', () => {
    expect(getLocaleSubPath(i18n, 'de')).toBe('deutsch');
    expect(getLocaleSubPath(i18n, 'fr')).toBe('fr');
  });

  // @angular/build allows an empty subPath (output at the browser root), so '' must not fall back
  it('keeps an empty source locale subPath', () => {
    expect(getLocaleSubPath(i18n, 'en-US')).toBe('');
  });

  it('uses the code for a string source locale', () => {
    expect(getLocaleSubPath({ ...i18n, sourceLocale: 'en-US' }, 'en-US')).toBe('en-US');
  });

  it('uses en-US as the source locale folder when sourceLocale is omitted', () => {
    expect(getLocaleSubPath({ locales: i18n.locales }, 'en-US')).toBe('en-US');
  });

  it('uses the source subPath when sourceLocale has no code', () => {
    expect(getLocaleSubPath({ ...i18n, sourceLocale: { subPath: 'src' } }, 'en-US')).toBe('src');
  });
});

// Mirrors @angular/build's i18n-options, where sourceLocale and sourceLocale.code both fall back to en-US
describe('getSourceLocaleCode', () => {
  it('returns a string source locale as-is', () => {
    expect(getSourceLocaleCode({ sourceLocale: 'nl', locales: {} })).toBe('nl');
  });

  it('returns the code of an object source locale', () => {
    expect(getSourceLocaleCode({ sourceLocale: { code: 'nl' }, locales: {} })).toBe('nl');
  });

  it('defaults to en-US when sourceLocale is omitted', () => {
    expect(getSourceLocaleCode({ locales: { de: 'm.de.xlf' } })).toBe('en-US');
  });

  it('defaults to en-US when sourceLocale has no code', () => {
    expect(getSourceLocaleCode({ sourceLocale: { subPath: 'src' }, locales: {} })).toBe('en-US');
  });
});
