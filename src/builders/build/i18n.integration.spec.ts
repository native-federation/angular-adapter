import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { FederationInfo } from '@softarc/native-federation';

import { translateFederationArtifacts, type I18nConfig } from './i18n.js';

// Runs the real @angular/localize CLI, which the mocks in i18n.spec.ts cannot cover.
// The workspace lives in node_modules so that @angular/localize resolves from the repo.
describe('translateFederationArtifacts with the real localize-translate CLI', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(process.cwd(), 'node_modules', '.i18n-spec-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  const xlf = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" target-language="de" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="greeting" datatype="html">
        <source>Hello</source>
        <target>Hallo</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

  it('translates the staged federation files and leaves the Angular output alone', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    const sourceFile = (name: string) => path.join(browser, 'en', name);
    const translation = path.join(workspaceRoot, 'messages.de.xlf');

    write(translation, xlf);
    write(path.join(browser, 'en', 'remoteEntry.json'), '{}');
    write(sourceFile('cmp.js'), 'export const t = $localize`:@@greeting:Hello`;');
    write(sourceFile('chunk.js'), 'export const c = $localize`:@@greeting:Hello`;');
    write(sourceFile('chunk.css'), 'a{}');
    // Angular's own output sits in the same folder and must be left alone
    write(sourceFile('main.js'), 'export const m = $localize`:@@greeting:Hello`;');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };
    const federationResult = {
      shared: [],
      exposes: [{ outFileName: 'cmp.js' }],
      chunks: { c1: ['chunk.js', 'chunk.css'] },
    } as unknown as FederationInfo;

    translateFederationArtifacts(i18n, true, 'dist', federationResult, workspaceRoot);

    const de = (name: string) => fs.readFileSync(path.join(browser, 'de', name), 'utf8');
    expect(de('cmp.js')).toContain('Hallo');
    expect(de('chunk.js')).toContain('Hallo');
    expect(de('chunk.css')).toBe('a{}');
    expect(fs.existsSync(path.join(browser, 'de', 'main.js'))).toBe(false);
  });

  it('inlines the source locale and refreshes the integrity hashes', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    const translation = path.join(workspaceRoot, 'messages.de.xlf');

    write(translation, xlf);
    write(
      path.join(browser, 'en', 'remoteEntry.json'),
      JSON.stringify({ integrity: { 'cmp.js': 'sha384-stale' } })
    );
    write(path.join(browser, 'en', 'cmp.js'), 'export const t = $localize`:@@greeting:Hello`;');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };
    const federationResult = {
      shared: [],
      exposes: [{ outFileName: 'cmp.js' }],
      chunks: {},
    } as unknown as FederationInfo;

    translateFederationArtifacts(i18n, true, 'dist', federationResult, workspaceRoot);

    for (const locale of ['en', 'de']) {
      const file = path.join(browser, locale, 'cmp.js');
      const integrity = JSON.parse(
        fs.readFileSync(path.join(browser, locale, 'remoteEntry.json'), 'utf8')
      ).integrity;
      expect(fs.readFileSync(file, 'utf8')).not.toContain('$localize');
      expect(integrity['cmp.js']).toBe(
        `sha384-${createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`
      );
    }
    expect(fs.readFileSync(path.join(browser, 'en', 'cmp.js'), 'utf8')).toContain('Hello');
  });

  it('inlines the source locale when it is the only requested locale', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    write(path.join(browser, 'en', 'remoteEntry.json'), '{}');
    write(path.join(browser, 'en', 'cmp.js'), 'export const t = $localize`:@@greeting:Hello`;');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: {} };
    const federationResult = {
      shared: [],
      exposes: [{ outFileName: 'cmp.js' }],
      chunks: {},
    } as unknown as FederationInfo;

    translateFederationArtifacts(i18n, true, 'dist', federationResult, workspaceRoot);

    const inlined = fs.readFileSync(path.join(browser, 'en', 'cmp.js'), 'utf8');
    expect(inlined).not.toContain('$localize');
    expect(inlined).toContain('Hello');
  });

  it('fails the build when a listed file is missing', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    const translation = path.join(workspaceRoot, 'messages.de.xlf');

    write(translation, xlf);
    write(path.join(browser, 'en', 'remoteEntry.json'), '{}');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };
    const federationResult = {
      shared: [],
      exposes: [{ outFileName: 'missing.js' }],
      chunks: {},
    } as unknown as FederationInfo;

    expect(() =>
      translateFederationArtifacts(i18n, true, 'dist', federationResult, workspaceRoot)
    ).toThrow(/ENOENT/);
  });
});
