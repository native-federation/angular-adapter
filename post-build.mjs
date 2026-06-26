// Post-build step: replaces what the old `@nx/js:tsc` executor did after `tsc`.
// `tsc` (tsconfig.build.json) already emitted dist/src/**/*.{js,d.ts,d.ts.map}.
// Here we copy the non-TS assets and write the published package.json.
import { readFile, writeFile, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

// Root-level files copied verbatim into dist/.
const rootAssets = [
  'README.md',
  'LICENSE',
  'collection.json',
  'generators.json',
  'builders.json',
  'migration-collection.json',
];

// Recursively copy every non-`.ts` file under src/ into dist/src/, preserving
// structure (schema.json files and the generator/schematic `files/**` templates).
async function copySrcAssets(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await copySrcAssets(abs);
    } else if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) {
      // Copy non-TS assets (schema.json, file templates) and hand-authored
      // .d.ts files (e.g. schema.d.ts) — tsc compiles the .ts sources itself.
      const dest = join(dist, relative(root, abs));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(abs, dest);
    }
  }
}

// Derive the published package.json from the repo manifest: drop dev-only fields
// and add the entry-point fields the old executor injected.
async function writePackageJson() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  pkg.types = './src/index.d.ts';
  pkg.module = './src/index.js';
  pkg.main = './src/index.js';
  await writeFile(join(dist, 'package.json'), JSON.stringify(pkg, null, 2));
}

async function main() {
  if (!(await stat(dist).catch(() => null))) {
    throw new Error('dist/ not found — run `tsc -p tsconfig.build.json` first');
  }
  await mkdir(dist, { recursive: true });
  for (const asset of rootAssets) {
    await copyFile(join(root, asset), join(dist, asset));
  }
  await copySrcAssets(join(root, 'src'));
  await writePackageJson();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
