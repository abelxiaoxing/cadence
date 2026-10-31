import { afterEach, expect, it, vi } from "vitest";
import {
  compatibleBuild,
  decodeClientBuild,
  decodeServiceBuild,
} from "../../src/service-contract.ts";
import { hash } from "./fixtures";

afterEach(() => vi.restoreAllMocks());
it("closed independent build comparison: browser bytes plus contract, native contract, compatible safety only", () => {
  const server = decodeServiceBuild({
    contractHash: hash,
    assets: {
      sourceHash: "b".repeat(64),
      contractHash: hash,
      buildId: "c".repeat(64),
    },
  });
  const client = decodeClientBuild({ kind: "browser", ...server.assets });
  expect(compatibleBuild(server, client)).toBe(true);
  expect(compatibleBuild(server, null)).toBe(false);
  expect(compatibleBuild(undefined, client)).toBe(false);
  const old = {
    ...client,
    kind: "browser" as const,
    sourceHash: "b".repeat(64),
    buildId: "d".repeat(64),
  };
  expect(compatibleBuild(server, old)).toBe(false);
  expect(compatibleBuild(server, old, true)).toBe(true);
  expect(
    compatibleBuild(server, { ...old, contractHash: "e".repeat(64) }, true),
  ).toBe(false);
  expect(() => decodeClientBuild({ ...client, compatible: true })).toThrow();
  expect(
    compatibleBuild({ ...server, contractHash: "0".repeat(64) }, client),
  ).toBe(false);
});
