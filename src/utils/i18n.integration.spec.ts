import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

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
    write(sourceFile('chunk.js.map'), '{"version":3}');
    // Angular's own output sits in the same folder and must be left alone
    write(sourceFile('main.js'), 'export const m = $localize`:@@greeting:Hello`;');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };
    // core reports every file it wrote, chunks of non-dense bundles and source maps included
    const federationFiles = ['cmp.js', 'chunk.js', 'chunk.css', 'chunk.js.map'];

    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, workspaceRoot);

    const de = (name: string) => fs.readFileSync(path.join(browser, 'de', name), 'utf8');
    expect(de('cmp.js')).toContain('Hallo');
    expect(de('chunk.js')).toContain('Hallo');
    expect(de('chunk.css')).toBe('a{}');
    expect(de('chunk.js.map')).toBe('{"version":3}');
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
    const federationFiles = ['cmp.js'];

    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, workspaceRoot);

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
    const federationFiles = ['cmp.js'];

    translateFederationArtifacts(i18n, true, 'dist/browser', federationFiles, workspaceRoot);

    const inlined = fs.readFileSync(path.join(browser, 'en', 'cmp.js'), 'utf8');
    expect(inlined).not.toContain('$localize');
    expect(inlined).toContain('Hello');
  });

  // A watch rebuild does not rewrite shared bundles, so the second run stages the same source
  // files again. If the first run had inlined them in place, de would get the English text.
  it('keeps the target locale translated when a run without the source locale repeats', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    const translation = path.join(workspaceRoot, 'messages.de.xlf');
    const raw = 'export const t = $localize`:@@greeting:Hello`;';

    write(translation, xlf);
    write(path.join(browser, 'en', 'remoteEntry.json'), '{}');
    write(path.join(browser, 'en', 'cmp.js'), raw);

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };

    translateFederationArtifacts(i18n, ['de'], 'dist/browser', ['cmp.js'], workspaceRoot);
    translateFederationArtifacts(i18n, ['de'], 'dist/browser', ['cmp.js'], workspaceRoot);

    expect(fs.readFileSync(path.join(browser, 'de', 'cmp.js'), 'utf8')).toContain('Hallo');
    expect(fs.readFileSync(path.join(browser, 'en', 'cmp.js'), 'utf8')).toBe(raw);
  });

  it('leaves the output and integrity hashes unchanged when the source-only run repeats', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    write(
      path.join(browser, 'en', 'remoteEntry.json'),
      JSON.stringify({ integrity: { 'cmp.js': 'sha384-stale' } })
    );
    write(path.join(browser, 'en', 'cmp.js'), 'export const t = $localize`:@@greeting:Hello`;');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: {} };
    const read = (name: string) => fs.readFileSync(path.join(browser, 'en', name), 'utf8');

    translateFederationArtifacts(i18n, ['en'], 'dist/browser', ['cmp.js'], workspaceRoot);
    const firstCmp = read('cmp.js');
    const firstRemoteEntry = read('remoteEntry.json');

    translateFederationArtifacts(i18n, ['en'], 'dist/browser', ['cmp.js'], workspaceRoot);

    expect(firstCmp).not.toContain('$localize');
    expect(read('cmp.js')).toBe(firstCmp);
    expect(read('remoteEntry.json')).toBe(firstRemoteEntry);
    expect(JSON.parse(firstRemoteEntry).integrity['cmp.js']).toBe(
      `sha384-${createHash('sha384').update(firstCmp).digest('base64')}`
    );
  });

  it('fails the build when a listed file is missing', () => {
    const browser = path.join(workspaceRoot, 'dist', 'browser');
    const translation = path.join(workspaceRoot, 'messages.de.xlf');

    write(translation, xlf);
    write(path.join(browser, 'en', 'remoteEntry.json'), '{}');

    const i18n: I18nConfig = { sourceLocale: 'en', locales: { de: translation } };
    expect(() =>
      translateFederationArtifacts(i18n, true, 'dist/browser', ['missing.js'], workspaceRoot)
    ).toThrow(/ENOENT/);
  });
});
