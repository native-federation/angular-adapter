import type { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

import { getWorkspaceFileName } from '../init/steps/normalize-options.js';
import { federationTsConfigPath } from '../init/steps/generate-federation-tsconfig.js';

// Each build context now supplies its own `files` (utils/write-context-tsconfig.ts),
// so the list in tsconfig.federation.json only goes stale.
export default function update22_2(): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const workspace = JSON.parse(tree.read(getWorkspaceFileName(tree))?.toString('utf8') ?? '{}');

    for (const project of Object.values<{ root?: string }>(workspace.projects ?? {})) {
      removeFiles(tree, context, federationTsConfigPath((project?.root ?? '').replace(/\\/g, '/')));
    }
  };
}

function removeFiles(tree: Tree, context: SchematicContext, tsConfig: string): void {
  const text = tree.read(tsConfig)?.toString('utf8');
  if (text === undefined) return;

  const errors: ParseError[] = [];
  const json = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    context.logger.warn(`Skipping ${tsConfig}: it is not valid JSON. Remove its "files" by hand.`);
    return;
  }

  if (json?.files === undefined) return;

  // Edits in place, so the file keeps its comments and formatting.
  const edits = modify(text, ['files'], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  tree.overwrite(tsConfig, applyEdits(text, edits));
  context.logger.info(`Removed "files" from ${tsConfig}`);
}
