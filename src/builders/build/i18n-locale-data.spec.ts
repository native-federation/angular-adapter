import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  logger,
  type NormalizedFederationConfig,
} from "@softarc/native-federation/internal";

import {
  registerAngularLocaleDataInFederationConfig,
  resolveAngularLocaleData,
  type I18nConfig,
} from "./i18n.js";

const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  warnSpy.mockRestore();
});

function makeFakeWorkspace(locales: string[], version = "22.0.0"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nf-i18n-spec-"));
  const globalDir = path.join(
    root,
    "node_modules",
    "@angular",
    "common",
    "locales",
    "global",
  );
  fs.mkdirSync(globalDir, { recursive: true });
  for (const locale of locales) {
    fs.writeFileSync(path.join(globalDir, `${locale}.js`), "/* fake */");
  }
  fs.writeFileSync(
    path.join(root, "node_modules", "@angular", "common", "package.json"),
    JSON.stringify({ name: "@angular/common", version }),
  );
  return root;
}

function emptyConfig(): NormalizedFederationConfig {
  return {
    $type: "classic",
    name: "test",
    exposes: {},
    shared: {},
    sharedMappings: {},
    skip: { strings: new Set(), functions: [], regexps: [] },
    chunks: false,
    externals: [],
    features: {
      mappingVersion: false,
      ignoreUnusedDeps: false,
      denseChunking: false,
      denseExternals: false,
      integrityHashes: false,
    },
  } as unknown as NormalizedFederationConfig;
}

describe("resolveAngularLocaleData", () => {
  it("returns null for built-in english locales", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    expect(resolveAngularLocaleData("en", root)).toBeNull();
    expect(resolveAngularLocaleData("en-US", root)).toBeNull();
  });

  it("resolves an exact match", () => {
    const root = makeFakeWorkspace(["de-CH"], "22.0.0");
    const result = resolveAngularLocaleData("de-CH", root);
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe("@angular/common/locales/global/de-CH");
    expect(result!.matchedCode).toBe("de-CH");
    expect(result!.entryPoint).toBe(
      "node_modules/@angular/common/locales/global/de-CH.js",
    );
    expect(result!.version).toBe("22.0.0");
  });

  it("falls back to a shorter locale tag when the exact code is missing", () => {
    // Mirrors angular's i18n-locale-plugin behaviour: de-XYZ → de
    const root = makeFakeWorkspace(["de"]);
    const result = resolveAngularLocaleData("de-XYZ", root);
    expect(result).not.toBeNull();
    expect(result!.matchedCode).toBe("de");
    expect(result!.packageName).toBe("@angular/common/locales/global/de");
  });

  it("returns null when the locale cannot be resolved at all", () => {
    const root = makeFakeWorkspace([]);
    expect(resolveAngularLocaleData("de-CH", root)).toBeNull();
  });
});

describe("registerAngularLocaleDataInFederationConfig", () => {
  it("does nothing when i18n is undefined", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    const config = emptyConfig();
    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      undefined,
      root,
    );
    expect(registered).toEqual([]);
    expect(Object.keys(config.shared)).toEqual([]);
  });

  it("does nothing for a default en-US source locale", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    const config = emptyConfig();
    const i18n: I18nConfig = { sourceLocale: "en-US", locales: {} };
    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
    );
    expect(registered).toEqual([]);
    expect(Object.keys(config.shared)).toEqual([]);
  });

  it("registers a shared entry for an object-form non-english sourceLocale", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    const config = emptyConfig();
    const i18n: I18nConfig = {
      sourceLocale: { code: "de-CH", baseHref: "/de/" },
      locales: {},
    };

    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
    );

    expect(registered).toEqual(["@angular/common/locales/global/de-CH"]);
    const entry = config.shared["@angular/common/locales/global/de-CH"];
    expect(entry).toBeDefined();
    expect(entry!.platform).toBe("browser");
    expect(entry!.build).toBe("default");
    expect(entry!.packageInfo?.entryPoint).toBe(
      "node_modules/@angular/common/locales/global/de-CH.js",
    );
  });

  it("also handles the string-form sourceLocale (regression: bug is not specific to object form)", () => {
    const root = makeFakeWorkspace(["fr-CH"]);
    const config = emptyConfig();
    const i18n: I18nConfig = { sourceLocale: "fr-CH", locales: {} };

    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
    );

    expect(registered).toEqual(["@angular/common/locales/global/fr-CH"]);
  });

  it("registers inline locales requested via the dev-server locale filter", () => {
    const root = makeFakeWorkspace(["de-CH", "fr-CH"]);
    const config = emptyConfig();
    const i18n: I18nConfig = {
      sourceLocale: { code: "de-CH" },
      locales: { "fr-CH": { translation: "messages.fr-CH.xlf" } },
    };

    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
      ["fr-CH"],
    );

    expect(new Set(registered)).toEqual(
      new Set([
        "@angular/common/locales/global/de-CH",
        "@angular/common/locales/global/fr-CH",
      ]),
    );
  });

  it("does not overwrite an entry the user already configured", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    const config = emptyConfig();
    const userEntry = {
      singleton: true,
      strictVersion: true,
      requiredVersion: "auto",
      chunks: false,
      platform: "browser" as const,
      build: "default" as const,
      packageInfo: {
        entryPoint: "custom/path.js",
        version: "0.0.0",
        esm: true,
      },
    };
    config.shared["@angular/common/locales/global/de-CH"] = userEntry;
    const i18n: I18nConfig = {
      sourceLocale: { code: "de-CH" },
      locales: {},
    };

    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
    );

    expect(registered).toEqual([]);
    expect(config.shared["@angular/common/locales/global/de-CH"]).toBe(
      userEntry,
    );
  });

  it("warns and skips locales that cannot be resolved on disk but still processes the rest", () => {
    const root = makeFakeWorkspace(["de-CH"]);
    const config = emptyConfig();
    const i18n: I18nConfig = {
      sourceLocale: { code: "de-CH" },
      locales: {},
    };

    const registered = registerAngularLocaleDataInFederationConfig(
      config,
      i18n,
      root,
      ["xx-YY"],
    ); // xx-YY not present on disk

    expect(registered).toEqual(["@angular/common/locales/global/de-CH"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
