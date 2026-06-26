import { logger } from '@softarc/native-federation/internal';

const ALLOWED_FILE_EXTENSIONS = new Set(['mjs', 'js', 'mts', 'ts', 'jsx', 'tsx', 'json']);

export function checkForInvalidImports(importList: string[], type: string) {
  const importsWithDot = [];
  for (const mappingImport of importList) {
    if (!mappingImport.includes('.')) {
      continue;
    }

    const queryIndex = mappingImport.search(/[?#]/);
    const sanitizedImport = queryIndex >= 0 ? mappingImport.slice(0, queryIndex) : mappingImport;

    const segmentStart = sanitizedImport.lastIndexOf('/') + 1;
    const lastSegment = sanitizedImport.slice(segmentStart);
    const dotIndex = lastSegment.lastIndexOf('.');

    if (dotIndex < 0) {
      continue;
    }

    const extension = lastSegment.slice(dotIndex + 1);
    if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
      importsWithDot.push(mappingImport);
    }
  }

  if (importsWithDot.length > 0) {
    importsWithDot.forEach(e => {
      logger.warn(`Import '${e}' contains a bad dot (.) import.`);
    });
    logger.debug('Bad import issue: https://github.com/vitejs/vite/issues/21036');
    throw new Error(
      `Invalid '${type}' config. Invalid imports paths detected, consider using a barrel import instead. `
    );
  }
}
