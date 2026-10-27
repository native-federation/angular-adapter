import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Metafile } from "esbuild";

import { appendFederationLicenses, LICENSES_FILE } from "./federation-licenses.js";
import {
  EXTRACTION_FILE_SEPARATOR,
  extractLicenses,
} from "../../tools/esbuild/license-extractor.js";

let ws: string;
let licensesFile: string;

function addPackage(name: string, license: string): void {
  const dir = path.join(ws, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license }));
  fs.writeFileSync(path.join(dir, "LICENSE"), `${name} license text\n`);
  fs.writeFileSync(path.join(dir, "index.js"), "");
}

function bundleOf(...packages: string[]): Metafile {
  return {
    inputs: {},
    outputs: {
      "out/bundle.js": {
        bytes: 1,
        inputs: Object.fromEntries(
          packages.map((name) => [`node_modules/${name}/index.js`, { bytesInOutput: 1 }]),
        ),
        imports: [],
        exports: [],
      },
    },
  };
}

function packagesIn(licenses: string): string[] {
  return [...licenses.matchAll(/^Package: (.+)$/gm)].map((match) => match[1]!);
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "nf-federation-licenses-"));
  licensesFile = path.join(ws, "dist", LICENSES_FILE);
  fs.mkdirSync(path.dirname(licensesFile));
  addPackage("zone.js", "MIT");
  addPackage("rxjs", "Apache-2.0");
  addPackage("@ngrx/store", "MIT");
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("appendFederationLicenses", () => {
  it("appends the packages of the federation bundles after Angular's own entries", async () => {
    // What Angular writes for an app build that bundled only zone.js.
    const angular = await extractLicenses([bundleOf("zone.js")], ws);
    fs.writeFileSync(licensesFile, angular);

    await appendFederationLicenses(licensesFile, [bundleOf("rxjs", "zone.js"), bundleOf("@ngrx/store")], ws);

    const licenses = fs.readFileSync(licensesFile, "utf-8");
    expect(licenses.startsWith(angular)).toBe(true);
    expect(packagesIn(licenses)).toEqual(["zone.js", "rxjs", "@ngrx/store"]);
    expect(licenses).toContain("rxjs license text\n");
    expect(licenses.endsWith(EXTRACTION_FILE_SEPARATOR)).toBe(true);
  });

  it("matches what Angular writes when it bundles every package itself", async () => {
    fs.writeFileSync(licensesFile, await extractLicenses([bundleOf("zone.js")], ws));

    await appendFederationLicenses(licensesFile, [bundleOf("rxjs", "@ngrx/store")], ws);

    expect(fs.readFileSync(licensesFile, "utf-8")).toBe(
      await extractLicenses([bundleOf("zone.js"), bundleOf("rxjs", "@ngrx/store")], ws),
    );
  });

  // A watch rebuild appends to a file Angular may not have rewritten.
  it("adds nothing on a second run", async () => {
    fs.writeFileSync(licensesFile, await extractLicenses([bundleOf("zone.js")], ws));
    await appendFederationLicenses(licensesFile, [bundleOf("rxjs")], ws);
    const once = fs.readFileSync(licensesFile, "utf-8");

    await appendFederationLicenses(licensesFile, [bundleOf("rxjs")], ws);

    expect(fs.readFileSync(licensesFile, "utf-8")).toBe(once);
  });

  it("leaves the file untouched when Angular already lists every package", async () => {
    const angular = await extractLicenses([bundleOf("zone.js", "rxjs")], ws);
    fs.writeFileSync(licensesFile, angular);
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    await appendFederationLicenses(licensesFile, [bundleOf("rxjs")], ws);

    expect(writeFile).not.toHaveBeenCalled();
    expect(fs.readFileSync(licensesFile, "utf-8")).toBe(angular);
    writeFile.mockRestore();
  });

  it("writes nothing when Angular wrote no licenses file", async () => {
    await appendFederationLicenses(licensesFile, [bundleOf("rxjs")], ws);

    expect(fs.existsSync(licensesFile)).toBe(false);
  });
});
