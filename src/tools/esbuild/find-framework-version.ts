// Adapted from angular/angular-cli (packages/angular/build/src/), which @angular/build's
// exports map doesn't expose (#153). Copyright Google LLC. MIT License: https://angular.dev/license

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// upstream: angular/angular-cli packages/angular/build/src/builders/application/options.ts @ 11dbe297f8
export async function findFrameworkVersion(projectRoot: string): Promise<string> {
  // upstream: angular/angular-cli packages/angular/build/src/utils/resolve-project.ts @ 11dbe297f8
  const projectRequire = createRequire(join(projectRoot, 'package.json'));

  try {
    const manifestPath = projectRequire.resolve('@angular/core/package.json', {
      paths: [projectRoot],
    });
    const manifestData = await readFile(manifestPath, 'utf-8');
    const manifestObject = JSON.parse(manifestData) as { version: string };

    return manifestObject.version;
  } catch {
    throw new Error(
      'Error: It appears that "@angular/core" is missing as a dependency. Please ensure it is included in your project.'
    );
  }
}
