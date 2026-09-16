import type { Tree } from '@angular-devkit/schematics';
import * as path from 'path';

export type AppComponent = {
  path: string;
  className: string | null;
};

// The first class exported after an `@Component` decorator. Angular <20 scaffolds
// `AppComponent` in app.component.ts, Angular >=20 `App` in app.ts, so neither the
// file nor the symbol can be assumed.
const DECORATED_CLASS = /@Component\b[\s\S]*?\bexport\s+class\s+([A-Za-z_$][\w$]*)/;
const EXPORTED_CLASS = /\bexport\s+class\s+([A-Za-z_$][\w$]*)/;

// `className` is null when the file exists but neither pattern matches (a default
// export, a separate `export { App }`): callers that only need the path still get it.
export function resolveAppComponent(tree: Tree, projectSourceRoot: string): AppComponent | null {
  const candidates = ['app.component.ts', 'app.ts'].map(name =>
    path.join(projectSourceRoot, 'app', name).replace(/\\/g, '/')
  );

  const file = candidates.find(candidate => tree.exists(candidate));
  if (!file) {
    return null;
  }

  const source = tree.readText(file);
  const className = (DECORATED_CLASS.exec(source) ?? EXPORTED_CLASS.exec(source))?.[1] ?? null;

  return { path: file, className };
}

export function importSpecifier(fromDir: string, file: string): string {
  const relative = path
    .relative(fromDir, file)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '');

  return relative.startsWith('.') ? relative : `./${relative}`;
}
