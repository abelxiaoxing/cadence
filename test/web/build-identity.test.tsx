import { afterEach, expect, it, vi } from "vitest";
import { sourceBuild } from "../helpers/source-build.ts";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

it("the embedded browser build accepts only the exact advertised gateway build", async () => {
  vi.stubGlobal("__CADENCE_BUILD__", sourceBuild.assets);
  const identity = await import("../../web/src/client/build-identity");
  expect(identity.browserBuildCompatible(sourceBuild)).toBe(true);
  expect(() =>
    identity.assertBrowserBuildCompatible(sourceBuild),
  ).not.toThrow();
  const stale = {
    ...sourceBuild,
    assets: { ...sourceBuild.assets, buildId: "0".repeat(64) },
  };
  expect(identity.browserBuildCompatible(stale)).toBe(false);
  expect(() => identity.assertBrowserBuildCompatible(stale)).toThrow(
    "reload-required",
  );
});

it("an unbuilt browser cannot acquire mutation compatibility", async () => {
  vi.stubGlobal("__CADENCE_BUILD__", undefined);
  const identity = await import("../../web/src/client/build-identity");
  expect(identity.browserBuildCompatible(sourceBuild)).toBe(false);
  expect(() => identity.assertBrowserBuildCompatible(sourceBuild)).toThrow(
    "unsupported-context",
  );
});
