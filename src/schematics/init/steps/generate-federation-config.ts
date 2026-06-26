import { apply, mergeWith, move, type Source, template } from '@angular-devkit/schematics';
import type { NfSchematicSchema } from '../schema.js';

export function generateFederationConfig(
  templateSource: Source,
  remoteMap: Record<string, string>,
  projectRoot: string,
  projectSourceRoot: string,
  appComponentPath: string,
  options: NfSchematicSchema
) {
  const applied = apply(templateSource, [
    template({
      projectRoot,
      projectSourceRoot,
      appComponentPath,
      remoteMap,
      ...options,
      tmpl: '',
    }),
    move(projectRoot),
  ]);

  return mergeWith(applied);
}
