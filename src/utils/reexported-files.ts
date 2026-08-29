import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export function resolveModuleFile(candidate: string): string | null {
  if (isFile(candidate)) {
    return candidate;
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    if (isFile(candidate + ext)) {
      return candidate + ext;
    }

    const index = path.join(candidate, 'index' + ext);
    if (isFile(index)) {
      return index;
    }
  }

  return null;
}

// The files an importer of `entryPoint` can actually reach. Anything else the lib holds is
// internal to it, however public the symbol looks from inside.
export function reexportedFiles(entryPoint: string): Set<string> {
  const reachable = new Set<string>();

  const visit = (file: string): void => {
    if (reachable.has(file)) {
      return;
    }
    reachable.add(file);

    for (const statement of parse(file)?.statements ?? []) {
      if (!ts.isExportDeclaration(statement)) {
        continue;
      }

      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) {
        continue;
      }

      const resolved = resolveModuleFile(path.resolve(path.dirname(file), specifier.text));
      if (resolved) {
        visit(resolved);
      }
    }
  };

  visit(entryPoint);
  return reachable;
}

function parse(file: string): ts.SourceFile | null {
  try {
    return ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, false);
  } catch {
    return null;
  }
}

function isFile(candidate: string): boolean {
  return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
}
