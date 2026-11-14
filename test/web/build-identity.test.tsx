import { afterEach, expect, it, vi } from "vitest";
import { sourceBuild } from "../helpers/source-build.ts";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

it("the embedded browser build is diagnostic metadata, not an access decision", async () => {
  vi.stubGlobal("__CADENCE_BUILD__", sourceBuild.assets);
  const identity = await import("../../web/src/client/build-identity");
  expect(identity.localBuild).toEqual(sourceBuild.assets);
  expect(Object.keys(identity)).toEqual(["localBuild"]);
});

it("a source browser without embedded provenance can still load", async () => {
  vi.stubGlobal("__CADENCE_BUILD__", undefined);
  const identity = await import("../../web/src/client/build-identity");
  expect(identity.localBuild).toBeNull();
});
