import { buildApplicationInternal } from "@angular/build/private";
import type { BuilderContext } from "@angular-devkit/architect";

import { createInternalAngularBuilder } from "./internal-angular-builder.js";

vi.mock("@angular/build/private", () => ({
  buildApplicationInternal: vi.fn(),
}));

type Options = Parameters<typeof buildApplicationInternal>[0];

function run(
  options: Partial<Options>,
  opts?: Parameters<typeof createInternalAngularBuilder>[1],
) {
  createInternalAngularBuilder(["@angular/core"], opts)(
    options as Options,
    {} as BuilderContext,
  );
  return vi.mocked(buildApplicationInternal).mock.calls.at(-1)![0];
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
});
