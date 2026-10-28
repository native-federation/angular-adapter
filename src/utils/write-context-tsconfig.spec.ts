import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

import { logger } from '@softarc/native-federation/internal';

import { writeContextTsConfig } from './write-context-tsconfig.js';
import type { EntryPoint } from '@softarc/native-federation';

function entry(fileName: string): EntryPoint {
  return { fileName, outName: 'out.js' } as EntryPoint;
}

function touch(ws: string, file: string, content = '') {
  const full = path.join(ws, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// What TypeScript (and so Angular's compiler plugin) makes of the generated config.
function parse(configPath: string) {
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath), {}, configPath);
}

// What Angular's compiler plugin would report for a program built from the generated config.
function diagnose(configPath: string): string[] {
  const { fileNames, options } = parse(configPath);
  const program = ts.createProgram(fileNames, options);
  return ts
    .getPreEmitDiagnostics(program)
    .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

const posix = (p: string) => p.replace(/\\/g, '/');

describe('writeContextTsConfig', () => {
  let ws: string;
  let cacheDir: string;

  beforeEach(() => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-context-tsconfig-')));
    cacheDir = path.join(ws, 'node_modules/.cache/native-federation');

    // Every Angular workspace has its own typescript; the type roots are read through it.
    fs.mkdirSync(path.join(ws, 'node_modules'));
    fs.symlinkSync(
      path.resolve('node_modules/typescript'),
      path.join(ws, 'node_modules/typescript')
    );

    // The shape the init schematic writes: extends the app tsconfig, `files` seeded, `include`
    // only picking up ambient declarations.
    touch(
      ws,
      'projects/mfe1/tsconfig.app.json',
      JSON.stringify({ compilerOptions: { paths: { '@libs/ui': ['../../libs/ui/src/index.ts'] } } })
    );
    touch(
      ws,
      'projects/mfe1/tsconfig.federation.json',
      JSON.stringify({
        extends: './tsconfig.app.json',
        files: ['src/stale-from-schematic.ts'],
        include: ['src/**/*.d.ts'],
      })
    );
    touch(ws, 'projects/mfe1/src/typings.d.ts');
    touch(ws, 'projects/mfe1/src/bootstrap.ts');
    touch(ws, 'projects/mfe1/src/main.ts');
    touch(ws, 'libs/ui/src/index.ts');
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const write = (bundleName: string, entryPoints: EntryPoint[], fallbackEntryPoints?: string[]) =>
    writeContextTsConfig({
      workspaceRoot: ws,
      tsConfigPath: 'projects/mfe1/tsconfig.federation.json',
      cacheDir,
      bundleName,
      entryPoints,
      fallbackEntryPoints,
    });

  it('throws naming the tsconfig when the file the target points at is missing', () => {
    expect(() =>
      writeContextTsConfig({
        workspaceRoot: ws,
        tsConfigPath: 'projects/mfe2/tsconfig.federation.json',
        cacheDir,
        bundleName: 'mapping-or-exposed',
        entryPoints: [entry('./projects/mfe2/src/bootstrap.ts')],
      })
    ).toThrow(/"projects\/mfe2\/tsconfig\.federation\.json" does not exist/);
  });

  it('writes into the cache dir and leaves the federation tsconfig untouched', () => {
    const federationTsConfig = path.join(ws, 'projects/mfe1/tsconfig.federation.json');
    const before = fs.readFileSync(federationTsConfig, 'utf-8');

    const written = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(path.dirname(written)).toBe(path.join(cacheDir, 'tsconfig'));
    expect(fs.readFileSync(federationTsConfig, 'utf-8')).toBe(before);
  });

  // The #138 regression: each context's program holds only its own entry points, whatever the
  // other contexts wrote, while `include` and `paths` still come from the federation tsconfig.
  it('gives each build context a program of its own entry points', () => {
    const mappings = write('mapping-bundle', [entry(path.join(ws, 'libs/ui/src/index.ts'))]);
    const exposed = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(mappings).not.toBe(exposed);

    expect(parse(mappings).fileNames).toEqual([
      posix(path.join(ws, 'libs/ui/src/index.ts')),
      posix(path.join(ws, 'projects/mfe1/src/typings.d.ts')),
    ]);
    expect(parse(exposed).fileNames).toEqual([
      posix(path.join(ws, 'projects/mfe1/src/bootstrap.ts')),
      posix(path.join(ws, 'projects/mfe1/src/typings.d.ts')),
    ]);
    expect(parse(exposed).options.paths).toEqual({ '@libs/ui': ['../../libs/ui/src/index.ts'] });
  });

  // The cache dir is workspace-wide and every remote has a 'mapping-or-exposed' context.
  it('keys the file on the federation tsconfig, so two projects never share one', () => {
    touch(ws, 'projects/mfe2/tsconfig.federation.json', JSON.stringify({ files: [] }));

    const mfe1 = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);
    const mfe2 = writeContextTsConfig({
      workspaceRoot: ws,
      tsConfigPath: 'projects/mfe2/tsconfig.federation.json',
      cacheDir,
      bundleName: 'mapping-or-exposed',
      entryPoints: [entry('./projects/mfe2/src/bootstrap.ts')],
    });

    expect(mfe1).not.toBe(mfe2);
  });

  it('falls back to the given entry points when the context has none of its own', () => {
    const written = write('mapping-or-exposed', [], ['projects/mfe1/src/main.ts']);

    expect(parse(written).fileNames[0]).toBe(posix(path.join(ws, 'projects/mfe1/src/main.ts')));
  });

  it('deduplicates entry points resolving to the same file', () => {
    const written = write('mapping-or-exposed', [
      entry(path.join(ws, 'projects/mfe1/src/bootstrap.ts')),
      entry('./projects/mfe1/src/bootstrap.ts'),
    ]);

    expect(JSON.parse(fs.readFileSync(written, 'utf-8')).files).toEqual([
      posix(path.join(ws, 'projects/mfe1/src/bootstrap.ts')),
    ]);
  });

  // `mapping-<pkg>` names come from package names; keep them to one path segment.
  it('keeps the bundle name to a single file name', () => {
    const written = write('mapping-@scope/ui', [entry(path.join(ws, 'libs/ui/src/index.ts'))]);

    expect(path.dirname(written)).toBe(path.join(cacheDir, 'tsconfig'));
  });

  // Default typeRoots are every node_modules/@types above the leaf config. From the cache dir
  // that would skip e.g. a pnpm workspace package's own projects/mfe1/node_modules/@types.
  it('pins the type roots the federation tsconfig resolves to', () => {
    const written = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);
    const typeRoots = parse(written).options.typeRoots!;

    expect(typeRoots[0]).toBe(posix(path.join(ws, 'projects/mfe1/node_modules/@types')));
    expect(typeRoots.some(root => root.startsWith(posix(cacheDir)))).toBe(false);
  });

  it('keeps typeRoots the federation tsconfig sets explicitly', () => {
    touch(
      ws,
      'projects/mfe1/tsconfig.app.json',
      JSON.stringify({ compilerOptions: { typeRoots: ['./custom-types'] } })
    );

    const written = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(parse(written).options.typeRoots).toEqual([
      posix(path.join(ws, 'projects/mfe1/custom-types')),
    ]);
  });

  describe('type libraries in `types`', () => {
    // A package that ships its own typings, like @angular/localize: not under @types.
    const selfTyped = (dir: string) => {
      touch(
        ws,
        `${dir}/@acme/localize/package.json`,
        JSON.stringify({ name: '@acme/localize', typings: './types/localize.d.ts' })
      );
      touch(
        ws,
        `${dir}/@acme/localize/types/localize.d.ts`,
        'declare function $localize(parts: TemplateStringsArray): string;'
      );
    };

    const useTypes = (compilerOptions: object) =>
      touch(
        ws,
        'projects/mfe1/tsconfig.app.json',
        JSON.stringify({ compilerOptions: { skipLibCheck: true, ...compilerOptions } })
      );

    const atTypes = (dir: string, name: string, global: string) =>
      touch(ws, `${dir}/@types/${name}/index.d.ts`, `declare const ${global}: string;`);

    const writeUsing = (global: string) => {
      touch(ws, 'projects/mfe1/src/bootstrap.ts', `export const text: string = ${global};`);
      return write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);
    };

    const cacheRoots = (written: string) =>
      parse(written).options.typeRoots!.filter(root => root.startsWith(posix(cacheDir)));

    // #166: pinned typeRoots turn off TypeScript's node_modules fallback for these.
    it('resolves a package that ships its own typings', () => {
      selfTyped('node_modules');
      atTypes('node_modules', 'acme-env', 'ACME_ENV');
      useTypes({ types: ['@acme/localize'] });

      const written = writeUsing('$localize`hi`');

      expect(diagnose(written)).toEqual([]);
      expect(cacheRoots(written)).toEqual([]);
    });

    // The fallback walks up from the federation tsconfig, not from the cache dir.
    it("resolves it from the federation tsconfig's own node_modules", () => {
      selfTyped('projects/mfe1/node_modules');
      useTypes({ types: ['@acme/localize'] });

      expect(diagnose(writeUsing('$localize`hi`'))).toEqual([]);
    });

    // Without one, every absolute `types` entry fails with TS2688.
    it('adds a type root that exists when none of the pinned ones does', () => {
      selfTyped('node_modules');
      useTypes({ types: ['@acme/localize'] });

      const written = writeUsing('$localize`hi`');

      expect(diagnose(written)).toEqual([]);
      expect(cacheRoots(written)).toEqual([posix(path.join(cacheDir, 'tsconfig'))]);
    });

    it('resolves a package that exposes its typings only through `exports`', () => {
      touch(
        ws,
        'node_modules/@acme/env/package.json',
        JSON.stringify({ name: '@acme/env', exports: { '.': { types: './dist/env.d.ts' } } })
      );
      touch(ws, 'node_modules/@acme/env/dist/env.d.ts', 'declare const ACME_ENV: string;');
      useTypes({ module: 'esnext', moduleResolution: 'bundler', types: ['@acme/env'] });

      expect(diagnose(writeUsing('ACME_ENV'))).toEqual([]);
    });

    // Relative to the federation tsconfig, not to the cache dir.
    it('resolves a relative entry', () => {
      touch(ws, 'projects/mfe1/src/env/index.d.ts', 'declare const ACME_ENV: string;');
      useTypes({ types: ['./src/env'] });

      expect(diagnose(writeUsing('ACME_ENV'))).toEqual([]);
    });

    it('still resolves @types packages, the workspace ones and its own', () => {
      atTypes('node_modules', 'acme-env', 'ACME_ENV');
      atTypes('projects/mfe1/node_modules', 'acme-local', 'ACME_LOCAL');
      useTypes({ types: ['acme-env', 'acme-local'] });

      expect(diagnose(writeUsing('ACME_ENV + ACME_LOCAL'))).toEqual([]);
    });

    // The "*" wildcard is TypeScript 6+; this branch builds against 5.9.
    it.skipIf(Number(ts.versionMajorMinor.split('.')[0]) < 6)(
      'keeps the "*" wildcard next to resolved entries',
      () => {
        selfTyped('node_modules');
        atTypes('node_modules', 'acme-env', 'ACME_ENV');
        useTypes({ types: ['*', '@acme/localize'] });

        expect(diagnose(writeUsing('$localize`hi` + ACME_ENV'))).toEqual([]);
      }
    );

    // With explicit typeRoots TypeScript skips the fallback for the federation tsconfig too.
    it('passes an entry it cannot resolve through unchanged', () => {
      selfTyped('node_modules');
      useTypes({ types: ['@acme/localize'], typeRoots: ['./custom-types'] });

      const written = writeUsing('$localize`hi`');

      expect(parse(written).options.typeRoots).toEqual([
        posix(path.join(ws, 'projects/mfe1/custom-types')),
      ]);
      expect(parse(written).options.types).toEqual(['@acme/localize']);
    });

    it('writes no types when the federation tsconfig sets none', () => {
      const written = writeUsing("'hi'");

      expect(JSON.parse(fs.readFileSync(written, 'utf-8')).compilerOptions).not.toHaveProperty(
        'types'
      );
    });
  });

  it('does not rewrite the file when its content is unchanged', () => {
    const written = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(written, past, past);

    write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(fs.statSync(written).mtimeMs).toBe(past.getTime());
  });

  // Tsconfigs generated before the schematic stopped seeding `files` still carry one.
  it("warns once that the federation tsconfig's own files are ignored", () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    write('mapping-bundle', [entry(path.join(ws, 'libs/ui/src/index.ts'))]);
    write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(
      /"projects\/mfe1\/tsconfig\.federation\.json" lists "files"/
    );
  });

  // The app tsconfig it extends often has the older `files: ["src/main.ts"]` shape.
  it('does not warn about files inherited from the extended tsconfig', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    touch(ws, 'projects/mfe1/tsconfig.app.json', JSON.stringify({ files: ['src/main.ts'] }));
    touch(
      ws,
      'projects/mfe1/tsconfig.federation.json',
      JSON.stringify({ extends: './tsconfig.app.json', include: ['src/**/*.d.ts'] })
    );

    const written = write('mapping-or-exposed', [entry('./projects/mfe1/src/bootstrap.ts')]);

    expect(warn).not.toHaveBeenCalled();
    expect(parse(written).fileNames[0]).toBe(
      posix(path.join(ws, 'projects/mfe1/src/bootstrap.ts'))
    );
  });
});
