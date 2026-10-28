import * as path from 'path';

import type { NfRemoteBuilderSchema } from './schema.js';

export function resolveBrowserOutputPath(
  outputPath: NfRemoteBuilderSchema['outputPath'],
  project: string
): string {
  const { base, browser = 'browser' } =
    typeof outputPath === 'object' ? outputPath : { base: outputPath ?? `dist/${project}` };
  return path.join(base, browser);
}
