import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildApplicationInternal,
  ComponentStylesheetBundler,
} from "@angular/build/private";
import type { BuilderContext } from "@angular-devkit/architect";

import { createInternalAngularBuilder } from "./internal-angular-builder.js";

vi.mock("@angular/build/private", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildApplicationInternal: vi.fn(),
}));

type Options = Parameters<typeof buildApplicationInternal>[0];

// `served` is the object serveWithVite passed in and reads externalDependencies back from
// for Vite; `build` is what Angular's build (and with it the stylesheet bundler) gets.
function runBoth(
  options: Partial<Options>,
  opts?: Parameters<typeof createInternalAngularBuilder>[1],
  externals = ["@angular/core"],
) {
  createInternalAngularBuilder(externals, opts)(
    options as Options,
    {} as BuilderContext,
  );
  return {
    build: vi.mocked(buildApplicationInternal).mock.calls.at(-1)![0],
    served: options as Options,
  };
}

function run(
  options: Partial<Options>,
  opts?: Parameters<typeof createInternalAngularBuilder>[1],
) {
  return runBoth(options, opts).build;
}

describe("createInternalAngularBuilder", () => {
  beforeEach(() => vi.mocked(buildApplicationInternal).mockClear());

  it("appends the federation externals", () => {
    expect(run({ externalDependencies: ["fs"] }).externalDependencies).toEqual([
      "fs",
      "@angular/core",
    ]);
  });

  // #129: serveWithVite reads the build target's options itself, so the builder's define
  // must be merged here or `serve --define` never reaches the main bundle.
  it("merges the builder define over the target define", () => {
    const options = run(
      { define: { BUILD_ID: "'target'", KEEP: "true" } },
      { define: { BUILD_ID: "'cli'" } },
    );

    expect(options.define).toEqual({ BUILD_ID: "'cli'", KEEP: "true" });
  });

  it("leaves the target define alone when the builder sets none", () => {
    expect(run({ define: { KEEP: "true" } }).define).toEqual({ KEEP: "true" });
  });

  // #167: @angular/build hands externalDependencies to the stylesheet bundler too, and an
  // external package name covers its subpaths, so `@use 'pkg/styles/...'` can't be found.
  describe("when the externals plugin covers the browser bundle", () => {
    it("keeps the federation externals out of the build", () => {
      const { build, served } = runBoth(
        { externalDependencies: ["fs"] },
        { externalsPlugin: true },
      );

      expect(build.externalDependencies).toEqual(["fs"]);
      expect(served.externalDependencies).toEqual(["fs", "@angular/core"]);
    });

    it("leaves externalDependencies unset for the build when the target sets none", () => {
      const { build, served } = runBoth({}, { externalsPlugin: true });

      expect(build.externalDependencies).toBeUndefined();
      expect(served.externalDependencies).toEqual(["@angular/core"]);
    });

    it("still applies the builder define", () => {
      const { build, served } = runBoth(
        { define: { KEEP: "true" } },
        { externalsPlugin: true, define: { BUILD_ID: "'cli'" } },
      );

      expect(build.define).toEqual({ BUILD_ID: "'cli'", KEEP: "true" });
      // Vite's define comes from the served options too.
      expect(served.define).toEqual({ BUILD_ID: "'cli'", KEEP: "true" });
    });

    // Angular's normalizeOptions writes its corrections back onto the options it gets
    // (`ssr = false` and `prerender = !!server` when `outputMode` is set without `server`), and
    // serveWithVite picks its SSR middleware from the served options' `ssr` afterwards.
    it("lets Angular's option corrections reach the served options", () => {
      vi.mocked(buildApplicationInternal).mockImplementationOnce((options) => {
        options.ssr = false;
        options.prerender = false;
        return (async function* () {})();
      });

      const { build, served } = runBoth(
        {
          externalDependencies: ["fs"],
          outputMode: "static" as Options["outputMode"],
          ssr: true,
        },
        { externalsPlugin: true },
      );

      expect(served.ssr).toBe(false);
      expect(served.prerender).toBe(false);
      expect(build.externalDependencies).toEqual(["fs"]);
      expect(served.externalDependencies).toEqual(["fs", "@angular/core"]);
    });

    // Server bundles and their polyfills don't run the plugin, and Angular only adds the
    // `ngServerMode` banner for externals when externalDependencies is set.
    it("keeps the federation externals in the build when there is a server bundle", () => {
      const { build, served } = runBoth(
        { externalDependencies: ["fs"], server: "src/main.server.ts" },
        { externalsPlugin: true },
      );

      expect(build.externalDependencies).toEqual(["fs", "@angular/core"]);
      expect(served.externalDependencies).toEqual(["fs", "@angular/core"]);
    });
  });

  // A federated SSR build (`ssr` without `dev`) turns the plugin off, so the browser bundle
  // only gets its externals from the options.
  it("keeps the federation externals in the build when the externals plugin is off", () => {
    const { build } = runBoth(
      { externalDependencies: ["fs"] },
      { externalsPlugin: false },
    );

    expect(build.externalDependencies).toEqual(["fs", "@angular/core"]);
  });

  // Runs Angular's real component stylesheet bundler (what createComponentStyleBundler builds
  // from the normalized externalDependencies) against a package shipping a Sass partial.
  describe("component stylesheets", () => {
    const roots: string[] = [];

    // Angular caches Sass package resolutions per working directory for the whole process, so
    // each bundle gets its own workspace root.
    function createWorkspace(): string {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "nf-stylesheet-externals-")),
      );
      roots.push(root);

      const pkg = path.join(root, "node_modules", "shared-ui");
      fs.mkdirSync(path.join(pkg, "styles"), { recursive: true });
      fs.writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "shared-ui", version: "1.0.0", main: "index.js" }),
      );
      fs.writeFileSync(path.join(pkg, "index.js"), "export const ui = true;\n");
      fs.writeFileSync(
        path.join(pkg, "styles", "_mixins.scss"),
        "@mixin brand { color: rebeccapurple; }\n",
      );
      fs.writeFileSync(
        path.join(root, "app.component.scss"),
        "@use 'shared-ui/styles/mixins' as m;\n.app { @include m.brand; }\n",
      );

      return root;
    }

    async function bundleStylesheet(externalDependencies: string[] | undefined) {
      const root = createWorkspace();
      const bundler = new ComponentStylesheetBundler(
        {
          workspaceRoot: root,
          optimization: false,
          inlineFonts: false,
          sourcemap: false,
          outputNames: { bundles: "[name]", media: "media/[name]" },
          externalDependencies,
          target: ["chrome120"],
          cacheOptions: { enabled: false, path: root, basePath: root },
        },
        "scss",
        false,
      );

      try {
        return await bundler.bundleFile(path.join(root, "app.component.scss"));
      } finally {
        await bundler.dispose();
      }
    }

    afterAll(() => {
      for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it("resolves a shared package's Sass partial with the externals the build gets", async () => {
      const { build, served } = runBoth({}, { externalsPlugin: true }, [
        "shared-ui",
      ]);

      // Control: the full list (what Vite gets, and what the build got before #167)
      // reproduces the issue's error.
      const failing = await bundleStylesheet(served.externalDependencies);
      expect(failing.errors?.map((e) => e.text).join("\n")).toContain(
        "Can't find stylesheet to import",
      );

      const result = await bundleStylesheet(build.externalDependencies);
      expect(result.errors).toBeUndefined();
      expect(result.contents).toContain("color: rebeccapurple");
    });
  });
});
