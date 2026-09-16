import { EmptyTree } from '@angular-devkit/schematics';

import config from './schematic.js';
import type { NfSchematicSchema } from './schema.js';

function run(schema: Partial<NfSchematicSchema>) {
  const options = { project: 'mfe1', port: '4200', type: 'remote', ...schema } as NfSchematicSchema;
  const rule = config(options);
  return (rule as (t: unknown, c: unknown) => Promise<unknown>)(new EmptyTree(), {
    addTask: () => undefined,
  });
}

describe('init option validation', () => {
  // The generated custom element bootstrap only registers an element; a host that never
  // bootstraps its own application renders nothing. Rejected before anything is written.
  it.each(['host', 'dynamic-host'])('rejects --webcomponent for --type %s', async type => {
    await expect(
      run({ type: type as NfSchematicSchema['type'], webcomponent: true })
    ).rejects.toThrow(/only valid for --type remote/);
  });
});
