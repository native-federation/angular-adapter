import type { Tree } from '@angular-devkit/schematics';

export function updatePolyfills(tree: Tree, polyfills: string | string[]) {
  if (typeof polyfills === 'string') {
    updatePolyfillsFile(tree, polyfills);
  } else {
    updatePolyfillsArray(tree, polyfills);
  }
}

function updatePolyfillsFile(tree: Tree, polyfills: string) {
  let polyfillsContent = tree.readText(polyfills);
  if (!polyfillsContent.includes('es-module-shims')) {
    polyfillsContent += `\nimport 'es-module-shims';\n`;
    tree.overwrite(polyfills, polyfillsContent);
  }
}

function updatePolyfillsArray(_tree: Tree, polyfills: string[]) {
  const polyfillsConfig = polyfills as string[];

  if (!polyfillsConfig.includes('es-module-shims')) {
    polyfillsConfig.push('es-module-shims');
  }
}
