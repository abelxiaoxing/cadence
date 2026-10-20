import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import {
  compatibleBuild,
  decodeClientBuild,
  decodeCurrentView,
  decodeServiceBuild,
} from "../../src/service-contract.ts";
import { planMetadataClient } from "../../web/src/client/plan-metadata";
import { context, coverage, graph, hash, id, transport } from "./fixtures";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const c = context(),
    storeId = id(),
    g = graph(c);
  if (!c.task) throw Error("fixture task");
  const view = decodeCurrentView({
    request: { storeId, taskId: c.task.id },
    workspaceId: c.workspaceId,
    epoch: c.epoch,
    committedSeq: "1",
    context: { status: "available", version: c },
    task: {
      id: c.task.id,
      kind: c.task.kind,
      revision: c.task.revision,
      identity: c.task.identity,
    },
    roles: ["design-explorer", "implementation-worker", "diagnosis-worker"].map(
      (role) => ({ role, sha256: hash }),
    ),
    readablePlan: {
      source: "current-v1",
      text: "Readable plan",
      editable: true,
      coverage,
    },
    savedGraph: { status: "none" },
  });
  return { c, storeId, g, view };
}
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
it("prospective Save refetches exact current version after async digest and never submits", async () => {
  const f = fixture();
  let reads = 0,
    stale = false;
  const original = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    const result = await original(...args);
    stale = true;
    return result;
  });
  const client = new ServiceClient(
    transport({
      current: async () => {
        reads++;
        return {
          kind: "ok",
          value: stale
            ? {
                ...f.view,
                context: {
                  status: "available",
                  version: { ...f.c, controlRev: f.c.controlRev + 1 },
                },
              }
            : f.view,
        };
      },
    }),
  );
  const reply = await planMetadataClient(client, f.storeId).saveAction(f.c, {
    readablePlan: "Explicit proposal",
    assignments: f.g.assignments,
  });
  expect(reply).toMatchObject({
    kind: "error",
    error: { code: "stale", effect: "none" },
  });
  expect(reads).toBe(2);
});
it("saved graph proof is one finite UI step, not empty graph or unbounded loop; post-await current is checked", async () => {
  const f = fixture();
  let reads = 0,
    graphs = 0;
  if (!f.c.task) throw Error("fixture task");
  const request = {
    storeId: f.storeId,
    scope: { kind: "task" as const, id: f.c.task.id },
    snapshotSeq: "1",
    graph: { recordId: id(), revision: 1, sha256: hash },
  };
  f.view.savedGraph = { status: "saved", request, planRevision: 1 };
  const client = new ServiceClient(
    transport({
      current: async () => {
        reads++;
        return { kind: "ok", value: f.view };
      },
      graph: async () => {
        graphs++;
        return {
          kind: "ok",
          value: {
            kind: "progress",
            request,
            next: { ...request, navigation: "fixture-proof" },
            coverage,
          },
        };
      },
    }),
  );
  const reply = await planMetadataClient(client, f.storeId).read(f.c);
  expect(reply).toMatchObject({
    kind: "ok",
    value: { kind: "progress", next: { navigation: "fixture-proof" } },
  });
  expect(graphs).toBe(1);
  expect(reads).toBe(2);
  expect(reply.kind === "ok" && "savedGraph" in reply.value).toBe(false);
});
