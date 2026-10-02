// Imports every builder/schematic/generator entry point from dist/ the way the Angular CLI and
// Nx do, so an import the published package can't resolve fails CI (see #153).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const manifests = {
  'builders.json': ['builders', 'implementation'],
  'collection.json': ['schematics', 'factory'],
  'generators.json': ['generators', 'factory'],
  'migration-collection.json': ['schematics', 'factory'],
};

const entries = new Set();
for (const [manifest, [section, field]] of Object.entries(manifests)) {
  const json = JSON.parse(await readFile(join(dist, manifest), 'utf-8'));
  for (const entry of Object.values(json[section] ?? {})) {
    if (entry[field]) entries.add(entry[field].split('#')[0]);
  }
}

let failed = 0;
for (const entry of [...entries].sort()) {
  const file = join(dist, entry.endsWith('.js') ? entry : `${entry}.js`);
  try {
    await import(pathToFileURL(file).href);
    console.log(`ok    ${entry}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${entry}\n      ${err.code ?? ''} ${err.message.split('\n')[0]}`);
  }
}

if (failed) {
  console.error(`\n${failed} of ${entries.size} entry points failed to load from dist/.`);
  process.exit(1);
}
