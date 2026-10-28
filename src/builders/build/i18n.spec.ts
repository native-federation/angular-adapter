import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { logger } from '@softarc/native-federation/internal';
import type { BuilderContext } from '@angular-devkit/architect';

import {
  getI18nConfig,
  getLocaleSubPath,
  getSourceLocaleCode,
  translateFederationArtifacts,
  type I18nConfig,
} from './i18n.js';

vi.mock('fs');
vi.mock('child_process');
vi.mock('module', () => ({
  createRequire: () =>
    Object.assign(
      (id: string) => {
        expect(id).toBe('/ws/node_modules/@angular/localize/package.json');
        return { bin: { 'localize-translate': './tools/bundles/src/translate/cli.js' } };
      },
      { resolve: () => '/ws/node_modules/@angular/localize/package.json' }
    ),
}));

const localizeArgs = (call = 0) => vi.mocked(execFileSync).mock.calls[call]![1] as string[];
const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
// path.resolve yields backslashes and a drive letter on Windows
const posix = (p: string | undefined) => p?.replace(/^[A-Za-z]:/, '').replaceAll('\\', '/');

const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

const federationFiles = ['dep1.js', 'cmp.js', 'chunk1.js'];

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
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('translated ok'));
    vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/nf-i18n-x');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // an existing remoteEntry.json without integrity hashes
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
  });

  it('does nothing when no configured locale matches the requested ones', async () => {
    translateFederationArtifacts(i18n, ['es'], 'dist/browser', federationFiles, '/ws');

    expect(execFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  describe('source locale', () => {
    it('is inlined by the same run as the translations, without a translation file of its own', () => {
      translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, '/ws');

      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(valueAfter(localizeArgs(), '-l')).toBe('en');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(
        vi.mocked(fs.cpSync).mock.calls.map(([from, to]) => [posix(String(from)), posix(String(to))])
      ).toContainEqual(['/tmp/nf-i18n-x/en', '/ws/dist/browser/en']);
    });

    it('is inlined when it is the only requested locale', () => {
      translateFederationArtifacts(i18n, ['en'], 'dist/browser', federationFiles, '/ws');

      const args = localizeArgs();
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(valueAfter(args, '-l')).toBe('en');
      // a bare -t is accepted by the CLI, and there are no target locales to name
      expect(args.slice(args.indexOf('-t') + 1, args.indexOf('-o'))).toEqual([]);
      expect(args).not.toContain('--target-locales');
      expect(fs.copyFileSync).not.toHaveBeenCalledWith(
        expect.stringMatching(/remoteEntry\.json$/),
        expect.stringMatching(/remoteEntry\.json$/)
      );
    });

    it('is inlined when localize is true and no locale is configured', () => {
      translateFederationArtifacts(
        { sourceLocale: 'en', locales: {} },
        true,
        'dist/browser',
        federationFiles,
        '/ws'
      );

      expect(execFileSync).toHaveBeenCalledTimes(1);
    });

    it('is inlined when the i18n config has no locales at all', () => {
      translateFederationArtifacts(
        { sourceLocale: 'en' },
        true,
        'dist/browser',
        federationFiles,
        '/ws'
      );

      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(localizeArgs()).not.toContain('--target-locales');
    });
  });

  describe('integrity hashes', () => {
    const sha384 = (content: string) =>
      `sha384-${createHash('sha384').update(Buffer.from(content)).digest('base64')}`;

    const withRemoteEntry = (integrity: Record<string, string> | undefined) => {
      vi.mocked(fs.readFileSync).mockImplementation(file => {
        if (String(file).endsWith('remoteEntry.json')) {
          return JSON.stringify({ name: 'app', ...(integrity && { integrity }) });
        }
        return String(file).endsWith('importmap.json')
          ? '{}'
          : (Buffer.from('translated content') as never);
      });
    };

    const writtenRemoteEntries = () =>
      Object.fromEntries(
        vi
          .mocked(fs.writeFileSync)
          .mock.calls.filter(c => String(c[0]).endsWith('remoteEntry.json'))
          .map(c => [posix(String(c[0])), JSON.parse(String(c[1]))])
      );

    it('recomputes the hashes in the remoteEntry of every translated locale and the source locale', () => {
      withRemoteEntry({ 'a.js': 'sha384-stale' });

      translateFederationArtifacts(i18n, ['de', 'fr'], 'dist/browser', federationFiles, '/ws');

      const written = writtenRemoteEntries();
      // the run that translates also writes the inlined source locale
      expect(Object.keys(written).sort()).toEqual([
        '/ws/dist/browser/de/remoteEntry.json',
        '/ws/dist/browser/en/remoteEntry.json',
        '/ws/dist/browser/fr/remoteEntry.json',
      ]);
      expect(written['/ws/dist/browser/de/remoteEntry.json'].integrity).toEqual({
        'a.js': sha384('translated content'),
      });
      expect(written['/ws/dist/browser/de/remoteEntry.json'].name).toBe('app');
    });

    it('keeps the algorithm of the existing hash', () => {
      withRemoteEntry({ 'a.js': 'sha512-stale' });

      translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

      const hash = createHash('sha512').update(Buffer.from('translated content')).digest('base64');
      expect(writtenRemoteEntries()['/ws/dist/browser/de/remoteEntry.json'].integrity['a.js']).toBe(
        `sha512-${hash}`
      );
    });

    it('keeps the hash of a file that is not in the locale folder', () => {
      withRemoteEntry({ 'a.js': 'sha384-stale', 'gone.js': 'sha384-keep' });
      vi.mocked(fs.existsSync).mockImplementation(file => !String(file).endsWith('gone.js'));

      translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

      const integrity = writtenRemoteEntries()['/ws/dist/browser/de/remoteEntry.json'].integrity;
      expect(integrity['gone.js']).toBe('sha384-keep');
      expect(integrity['a.js']).toBe(sha384('translated content'));
    });

    it('recomputes the hashes in importmap.json next to the remoteEntry', () => {
      vi.mocked(fs.readFileSync).mockImplementation(file => {
        if (String(file).endsWith('importmap.json')) {
          return JSON.stringify({ imports: { a: 'a.js' }, integrity: { 'a.js': 'sha384-stale' } });
        }
        return String(file).endsWith('remoteEntry.json')
          ? '{}'
          : (Buffer.from('translated content') as never);
      });

      translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

      const written = Object.fromEntries(
        vi
          .mocked(fs.writeFileSync)
          .mock.calls.filter(c => String(c[0]).endsWith('importmap.json'))
          .map(c => [posix(String(c[0])), JSON.parse(String(c[1]))])
      );
      expect(written['/ws/dist/browser/de/importmap.json'].integrity).toEqual({
        'a.js': sha384('translated content'),
      });
      expect(written['/ws/dist/browser/de/importmap.json'].imports).toEqual({ a: 'a.js' });
    });

    it('does not touch a remoteEntry without integrity hashes', () => {
      withRemoteEntry(undefined);

      translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

      expect(writtenRemoteEntries()).toEqual({});
    });
  });

  it('filters to the intersection of requested and configured locales', async () => {
    translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

    const args = localizeArgs();
    const targets = args.slice(args.indexOf('--target-locales') + 1, args.indexOf('-l'));
    expect(targets).toEqual(['de']);
  });

  it('builds the localize-translate command from the federation output files', async () => {
    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, '/ws');

    const [file, args] = vi.mocked(execFileSync).mock.calls[0]!;
    // the CLI script is run with node, not through a shell
    expect(file).toBe(process.execPath);
    expect(posix(args![0])).toBe(
      '/ws/node_modules/@angular/localize/tools/bundles/src/translate/cli.js'
    );
    // the files are staged in their own input folder, so a glob over everything is enough
    expect(valueAfter(args!, '-s')).toBe('**/*');
    expect(posix(valueAfter(args!, '-r'))).toBe('/tmp/nf-i18n-x/.input');
    expect(args!.slice(args!.indexOf('--target-locales') + 1, args!.indexOf('-l'))).toEqual([
      'de',
      'fr',
    ]);
    expect(valueAfter(args!, '-l')).toBe('en');
    // both translation file groups are passed, a list of files as `[a,b]`
    expect(args!.slice(args!.indexOf('-t') + 1, args!.indexOf('-o'))).toEqual([
      'src/locale/messages.de.xlf',
      '[a.xlf,b.xlf]',
    ]);
  });

  const stagedFiles = () =>
    vi
      .mocked(fs.copyFileSync)
      .mock.calls.filter(([, to]) => posix(String(to)).startsWith('/tmp/nf-i18n-x/.input/'))
      .map(([from, to]) => [posix(String(from)), posix(String(to))]);

  it('stages the federation output files from the source locale folder', () => {
    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, '/ws');

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(/\.input$/), {
      recursive: true,
    });
    expect(stagedFiles()).toEqual([
      ['/ws/dist/browser/en/dep1.js', '/tmp/nf-i18n-x/.input/dep1.js'],
      ['/ws/dist/browser/en/cmp.js', '/tmp/nf-i18n-x/.input/cmp.js'],
      ['/ws/dist/browser/en/chunk1.js', '/tmp/nf-i18n-x/.input/chunk1.js'],
    ]);
  });

  it('runs localize-translate once, however many files there are', () => {
    const manyFiles = Array.from({ length: 1000 }, (_, i) => `chunk-${i}-${'x'.repeat(40)}.js`);
    translateFederationArtifacts(i18n, true, 'dist/browser', [...manyFiles, manyFiles[0]!], '/ws');

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(valueAfter(localizeArgs(), '-s')).toBe('**/*');
    // every file is staged exactly once
    expect(stagedFiles().map(([from]) => from!.split('/').pop())).toEqual(manyFiles);
    expect(fs.cpSync).toHaveBeenCalledTimes(3);
  });

  it('uses sourceLocale.code when the source locale is an object', async () => {
    const objLocaleI18n: I18nConfig = {
      sourceLocale: { code: 'en-US' },
      locales: { de: 'm.de.xlf' },
    };

    translateFederationArtifacts(objLocaleI18n, true, 'dist/browser', federationFiles, '/ws');

    expect(valueAfter(localizeArgs(), '-l')).toBe('en-US');
  });

  const mkdirTargets = () => vi.mocked(fs.mkdirSync).mock.calls.map(([dir]) => posix(String(dir)));

  // outputPath.browser can be customised (or empty) in angular.json
  it('translates under the configured browser output folder instead of "browser"', () => {
    translateFederationArtifacts(i18n, ['de'], 'dist/web', federationFiles, '/ws');

    expect(stagedFiles()[0]![0]).toBe('/ws/dist/web/en/dep1.js');
    expect(mkdirTargets()).toContain('/ws/dist/web/de');
  });

  it('writes the locale folders directly under the base when the browser folder is empty', () => {
    translateFederationArtifacts(i18n, ['de'], 'dist', federationFiles, '/ws');

    expect(stagedFiles()[0]![0]).toBe('/ws/dist/en/dep1.js');
    expect(mkdirTargets()).toContain('/ws/dist/de');
  });

  // sourceLocale is optional in angular.json; @angular/build then uses en-US
  it('defaults the source locale to en-US when sourceLocale is omitted', async () => {
    translateFederationArtifacts(
      { locales: { de: 'm.de.xlf' } },
      true,
      'dist/browser',
      federationFiles,
      '/ws'
    );

    const args = localizeArgs();
    expect(valueAfter(args, '-l')).toBe('en-US');
    expect(posix(valueAfter(args, '-r'))).toBe('/tmp/nf-i18n-x/.input');
    expect(posix(String(vi.mocked(fs.copyFileSync).mock.calls.at(-1)![0]))).toContain(
      '/ws/dist/browser/en-US/'
    );
  });

  it('creates a dist folder and copies the remoteEntry for each target locale', async () => {
    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, '/ws');

    const mkdirPaths = vi.mocked(fs.mkdirSync).mock.calls.map(c => String(c[0]));
    expect(mkdirPaths.some(p => p.endsWith('browser/de'))).toBe(true);
    expect(mkdirPaths.some(p => p.endsWith('browser/fr'))).toBe(true);
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(expect.any(String), { recursive: true });

    const copyTargets = vi
      .mocked(fs.copyFileSync)
      .mock.calls.map(c => posix(String(c[1])))
      .filter(p => p.endsWith('remoteEntry.json'));
    expect(copyTargets).toHaveLength(2);
    expect(copyTargets.some(p => p.endsWith('browser/de/remoteEntry.json'))).toBe(true);
    expect(copyTargets.some(p => p.endsWith('browser/fr/remoteEntry.json'))).toBe(true);
  });

  it('resolves output, binary and cwd against workspaceRoot', async () => {
    translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws');

    const [, args, opts] = vi.mocked(execFileSync).mock.calls[0]!;
    expect(posix(args![0])).toContain('/ws/node_modules/@angular/localize/');
    expect(posix(valueAfter(args!, '-o'))).toBe('/tmp/nf-i18n-x/{{LOCALE}}');
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

    translateFederationArtifacts(subPathI18n, true, 'dist/browser', federationFiles, '/ws');

    const args = localizeArgs();
    // localize-translate reads the staged files, which come from the source subPath, but writes per locale code
    expect(posix(valueAfter(args, '-r'))).toBe('/tmp/nf-i18n-x/.input');
    expect(posix(String(vi.mocked(fs.copyFileSync).mock.calls.at(-1)![0]))).toContain(
      '/ws/dist/browser/en/'
    );
    expect(args.slice(args.indexOf('--target-locales') + 1, args.indexOf('-l'))).toEqual([
      'de',
      'fr',
    ]);
    expect(valueAfter(args, '-l')).toBe('en-US');

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

  it('logs the error and rethrows when the translate command fails', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('localize boom');
    });

    expect(() =>
      translateFederationArtifacts(i18n, ['de'], 'dist/browser', federationFiles, '/ws')
    ).toThrow('localize boom');

    expect(errorSpy).toHaveBeenCalledWith('localize boom');
    expect(fs.cpSync).not.toHaveBeenCalled();
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
