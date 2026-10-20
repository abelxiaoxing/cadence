/** Typed reader adapter fixtures, not storage/native execution evidence. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { NativeHistory, type NativeViews } from "../src/native-history.ts";
import type { ServiceClient } from "../src/service-client.ts";
import type { ListRequest, ReadCursor } from "../src/service-contract.ts";

const coverage = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
};
function view(choices: string[]) {
  const shown: string[] = [],
    titles: string[] = [];
  const ui: NativeViews = {
    signal: new AbortController().signal,
    current() {},
    show: async (text) => {
      shown.push(text);
    },
    notify: (t) => shown.push(t),
    input: async () => "汉🧪",
    confirm: async () => true,
    select: async (title, options) => {
      titles.push(title);
      const choice = choices.shift();
      if (choice !== undefined) expect(options).toContain(choice);
      return choice;
    },
  };
  return { ui, shown, titles };
}
it("detail proof, every UTF-8 page and back navigation retain the original snapshot without an automatic proof loop", async () => {
  const seed: ReadCursor = {
    storeId: randomUUID(),
    scope: { kind: "task", id: randomUUID() },
    snapshotSeq: "19",
    query: null,
    recordId: randomUUID(),
    recordVersion: 2,
    field: "message",
    offset: 0,
  };
  const proof = { ...seed, navigation: "proof" };
  const next = { ...seed, offset: 3 };
  const content = {
    recordId: seed.recordId,
    version: 2,
    field: "message",
    bytes: 7,
    sha256: "1".repeat(64),
  };
  const detail = vi.fn(async (cursor: ReadCursor) => ({
    kind: "ok",
    value:
      cursor === seed
        ? { kind: "progress", cursor, next: proof, coverage }
        : {
            cursor,
            content,
            range: { start: cursor.offset, end: cursor.offset === 0 ? 3 : 7 },
            text: cursor.offset === 0 ? "汉" : "🧪",
            next: cursor.offset === 0 ? next : null,
            coverage,
          },
  }));
  const v = view([
    "Next detail page / proof",
    "Next detail page / proof",
    "Previous detail page",
    "Return",
  ]);
  await new NativeHistory(
    { detail } as unknown as ServiceClient,
    seed.storeId,
    v.ui,
  ).detail(seed);
  expect(detail.mock.calls.map(([c]) => c)).toEqual([seed, proof, next, proof]);
  expect(v.shown[0]).toContain("no content yet");
  expect(v.shown[0]).not.toContain("汉");
  expect(v.shown.join("\n")).toContain("🧪");
  expect(v.shown.join("\n")).not.toContain("truncated");
  expect(detail).toHaveBeenCalledTimes(v.titles.length);
});
it("list snapshot/progress and zero-hit search continuations require explicit navigation and never invent empty completion", async () => {
  const storeId = randomUUID(),
    taskId = randomUUID(),
    workspaceId = randomUUID();
  const tasks = vi.fn(async (request: ListRequest) => ({
    kind: "ok",
    value:
      request.snapshotSeq === null
        ? {
            kind: "snapshot",
            request,
            next: { ...request, snapshotSeq: "27", navigation: "one" },
            coverage,
          }
        : request.navigation === "one"
          ? {
              kind: "progress",
              request,
              next: { ...request, navigation: "two" },
              coverage,
            }
          : { request, records: [], next: null, coverage },
  }));
  const v = view(["Next page / proof", "Next page / proof", "Return"]);
  const h = new NativeHistory(
    { tasks } as unknown as ServiceClient,
    storeId,
    v.ui,
  );
  await h.pages("tasks", { kind: "workspace", id: workspaceId });
  expect(tasks.mock.calls.map(([r]) => [r.snapshotSeq, r.navigation])).toEqual([
    [null, undefined],
    ["27", "one"],
    ["27", "two"],
  ]);
  expect(v.titles[0]).toContain("snapshot");
  expect(v.titles[1]).toContain("progress");
  const search = vi.fn(async (cursor: ReadCursor) => ({
    kind: "ok",
    value: {
      cursor,
      hits: [],
      next: cursor.navigation ? null : { ...cursor, navigation: "continued" },
      coverage,
    },
  }));
  const s = view(["Next search page / proof", "Return"]);
  await new NativeHistory(
    { search } as unknown as ServiceClient,
    storeId,
    s.ui,
  ).search({ kind: "task", id: taskId }, "27");
  expect(s.titles[0]).toContain("zero hits is not completion");
  expect(s.titles[1]).toContain("retained scan ended");
  expect(search.mock.calls[1][0]).toEqual({
    ...search.mock.calls[0][0],
    navigation: "continued",
  });
});
it("leaving a proof page makes no next request and a stale view cannot display late retained data", async () => {
  const cursor: ReadCursor = {
    storeId: randomUUID(),
    scope: { kind: "task", id: randomUUID() },
    snapshotSeq: "3",
    query: null,
    recordId: randomUUID(),
    recordVersion: 1,
    field: "message",
    offset: 0,
  };
  const detail = vi.fn(async () => ({
    kind: "ok",
    value: {
      kind: "progress",
      cursor,
      next: { ...cursor, navigation: "held" },
      coverage,
    },
  }));
  const v = view(["Return"]);
  await new NativeHistory(
    { detail } as unknown as ServiceClient,
    cursor.storeId,
    v.ui,
  ).detail(cursor);
  expect(detail).toHaveBeenCalledTimes(1);
  v.ui.current = () => {
    throw Error("stale view");
  };
  v.shown.length = 0;
  await expect(
    new NativeHistory(
      { detail } as unknown as ServiceClient,
      cursor.storeId,
      v.ui,
    ).detail(cursor),
  ).rejects.toThrow("stale view");
  expect(v.shown).toEqual([]);
});
it("Back from a later data page never reuses the initial null-snapshot list seed", async () => {
  const storeId = randomUUID(),
    workspaceId = randomUUID();
  const after = { recordId: randomUUID(), version: 1, offset: 1 };
  const tasks = vi.fn(async (request: ListRequest) => {
    const pinned = { ...request, snapshotSeq: request.snapshotSeq ?? "31" };
    return {
      kind: "ok",
      value: {
        request: pinned,
        records: [],
        coverage,
        next: request.after ? null : { ...pinned, after },
      },
    };
  });
  const v = view(["Next page / proof", "Previous page", "Return"]);
  await new NativeHistory(
    { tasks } as unknown as ServiceClient,
    storeId,
    v.ui,
  ).pages("tasks", { kind: "workspace", id: workspaceId });
  expect(tasks.mock.calls.map(([r]) => [r.snapshotSeq, r.after])).toEqual([
    [null, null],
    ["31", after],
    ["31", null],
  ]);
});
