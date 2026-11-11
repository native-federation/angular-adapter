import * as fs from "fs";
import type { Metafile } from "esbuild";

import {
  EXTRACTION_FILE_SEPARATOR,
  extractLicenses,
} from "../../tools/esbuild/license-extractor.js";

export const LICENSES_FILE = "3rdpartylicenses.txt";

export async function appendFederationLicenses(
  licensesFile: string,
  metafiles: Metafile[],
  workspaceRoot: string,
): Promise<void> {
  let written: string;
  try {
    written = await fs.promises.readFile(licensesFile, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  // Both files come from the same extractor, so a package Angular listed has the same entry.
  const listed = new Set(entries(written));
  const missing = entries(await extractLicenses(metafiles, workspaceRoot)).filter(
    (entry) => !listed.has(entry),
  );

  if (missing.length > 0) {
    await fs.promises.writeFile(
      licensesFile,
      written + missing.map((entry) => entry + EXTRACTION_FILE_SEPARATOR).join(""),
    );
  }
}

function entries(licenses: string): string[] {
  return licenses.split(EXTRACTION_FILE_SEPARATOR).slice(1, -1);
}
