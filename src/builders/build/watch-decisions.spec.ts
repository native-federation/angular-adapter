import * as path from "path";
import { describe, expect, it } from "vitest";

import {
  createFederationFreshness,
  shouldRunWatcherRebuild,
  shouldWakeFederation,
} from "./watch-decisions.js";

describe("createFederationFreshness", () => {
  it("skips the Angular-driven rebuild when a watcher rebuild covered the save", () => {
    // The ordinary save: watcher wins the race, rebuilds, and by the time
    // Angular's output arrives core's dirty buffer is empty again.
    const freshness = createFederationFreshness();
    freshness.mark(true);

    expect(freshness.consume(0)).toBe(true);
  });

  it("rebuilds when the dirty buffer is non-empty at the Angular output", () => {
    const freshness = createFederationFreshness();
    freshness.mark(true);

    expect(freshness.consume(3)).toBe(false);
  });

  it("never skips without a preceding watcher rebuild", () => {
    expect(createFederationFreshness().consume(0)).toBe(false);
  });

  it("never skips when a watcher rebuild failed", () => {
    const freshness = createFederationFreshness();
    freshness.mark(false);

    expect(freshness.consume(0)).toBe(false);
  });

  it("never skips without a watcher (undefined dirty count)", () => {
    const freshness = createFederationFreshness();
    freshness.mark(true);

    expect(freshness.consume(undefined)).toBe(false);
  });

  it("vouches for one Angular output only", () => {
    const freshness = createFederationFreshness();
    freshness.mark(true);

    expect(freshness.consume(0)).toBe(true);
    expect(freshness.consume(0)).toBe(false);
  });

  // Regression: the flag used to be cleared below the failed-build and
  // first-output branches, both of which `continue` — so a rebuild that
  // happened before a *failed* Angular build still vouched for the next,
  // unrelated output and wrongly skipped it.
  it("is cleared by an output it did not cover", () => {
    const freshness = createFederationFreshness();
    freshness.mark(true);

    // Angular build failed: consumed with a non-empty buffer, so no skip...
    expect(freshness.consume(2)).toBe(false);
    // ...and the next output must not inherit the stale flag.
    expect(freshness.consume(0)).toBe(false);
  });
});

describe("shouldRunWatcherRebuild", () => {
  it("runs when paths are buffered after the first build", () => {
    expect(shouldRunWatcherRebuild(false, 1)).toBe(true);
  });

  it("does not run on a wake with an empty buffer", () => {
    // fs.watch fires several events per save; the ones that arrive after the
    // buffer was consumed would otherwise drive a phantom rebuild.
    expect(shouldRunWatcherRebuild(false, 0)).toBe(false);
  });

  it("does not run before the first Angular output", () => {
    expect(shouldRunWatcherRebuild(true, 5)).toBe(false);
  });

  it("does not run without a watcher", () => {
    expect(shouldRunWatcherRebuild(false, undefined)).toBe(false);
  });
});

describe("shouldWakeFederation", () => {
  const watched = new Set([
    path.normalize("/ws/apps/host/src/app/app.component.ts"),
  ]);
  const linkedDir = path.normalize("/ws/node_modules/.links/my-lib");
  const sharedDir = path.normalize("/ws/libs/internal/src/logging");
  const wakeDirs = [linkedDir, sharedDir];
  const outDir = path.normalize("/ws/dist/host");

  it("wakes for a federation-tracked source", () => {
    expect(
      shouldWakeFederation(
        "/ws/apps/host/src/app/app.component.ts",
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(true);
  });

  it("wakes for a file under a linked dir", () => {
    expect(
      shouldWakeFederation(
        path.join(linkedDir, "src", "lib", "thing.ts"),
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(true);
  });

  it("wakes for a wake dir itself", () => {
    expect(shouldWakeFederation(linkedDir, watched, wakeDirs, outDir)).toBe(
      true,
    );
  });

  // The reason sharedMappingDirs is in the wake set: a file created since the
  // last build is in no compiled-inputs set, so this is its only wake path.
  it("wakes for a newly created file in a shared-mapping dir", () => {
    expect(
      shouldWakeFederation(
        path.join(sharedDir, "audit.service.ts"),
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(true);
  });

  it("does not wake for an unrelated path", () => {
    expect(
      shouldWakeFederation(
        "/ws/apps/host/src/styles.css",
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(false);
  });

  // A sibling whose name merely starts with a wake dir's name is outside it.
  it("does not wake for a wake-dir name prefix", () => {
    expect(
      shouldWakeFederation(
        sharedDir + "-other/src/index.ts",
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(false);
  });

  // With `sharedMappings` unset core promotes every tsconfig `paths` entry, so an
  // entry point near the workspace root yields a wake dir containing dist. The
  // rebuild writes there with a fresh mtime — not a replay, so core delivers it —
  // and without the guard that wake drives the next rebuild, forever.
  it("does not wake for the output it just wrote, under a workspace-root wake dir", () => {
    const rootWakeDirs = [path.normalize("/ws")];

    expect(
      shouldWakeFederation(
        path.join(outDir, "remoteEntry.json"),
        watched,
        rootWakeDirs,
        outDir,
      ),
    ).toBe(false);
  });

  it("still wakes for a source under that same workspace-root wake dir", () => {
    const rootWakeDirs = [path.normalize("/ws")];

    expect(
      shouldWakeFederation(
        "/ws/libs/internal/src/logging/audit.service.ts",
        watched,
        rootWakeDirs,
        outDir,
      ),
    ).toBe(true);
  });

  // The guard is containment, not a string prefix: `dist/host-e2e` is not output.
  it("wakes for a sibling of the output dir", () => {
    expect(
      shouldWakeFederation(
        outDir + "-e2e/src/app.po.ts",
        watched,
        [path.normalize("/ws")],
        outDir,
      ),
    ).toBe(true);
  });

  // Regression: the wake dirs arrive with native separators while core delivers
  // posix paths, so comparing against `dir + path.sep` was always false on
  // Windows. Backslash dirs make that reproducible off Windows.
  it("wakes for a posix event path against a backslash wake dir", () => {
    expect(
      shouldWakeFederation(
        "C:/ws/libs/internal/src/logging/audit.service.ts",
        new Set<string>(),
        ["C:\\ws\\libs\\internal\\src\\logging"],
        "C:\\ws\\dist\\host",
      ),
    ).toBe(true);
  });

  it("still rejects a sibling name prefix across separator styles", () => {
    expect(
      shouldWakeFederation(
        "C:/ws/libs/internal/src/logging-other/thing.ts",
        new Set<string>(),
        ["C:\\ws\\libs\\internal\\src\\logging"],
        "C:\\ws\\dist\\host",
      ),
    ).toBe(false);
  });

  // The output path reaches the guard with native separators too.
  it("rejects a posix output event against a backslash output path", () => {
    expect(
      shouldWakeFederation(
        "C:/ws/dist/host/remoteEntry.json",
        new Set<string>(),
        ["C:\\ws"],
        "C:\\ws\\dist\\host",
      ),
    ).toBe(false);
  });

  it("matches tracked files regardless of path separators in the event", () => {
    expect(
      shouldWakeFederation(
        "/ws/apps/host/src/app/../app/app.component.ts",
        watched,
        wakeDirs,
        outDir,
      ),
    ).toBe(true);
  });
});
