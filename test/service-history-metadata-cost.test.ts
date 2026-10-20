import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { IndexTree } from "../src/history/index-tree.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import { hash } from "../src/service/private-files.ts";
import { ContractError, canonicalJson } from "../src/service-contract.ts";
import { admitFixtureRun, historyFixture } from "./helpers/history-fixture.ts";
import { metadataCost } from "./helpers/history-metadata-cost.ts";
import { active } from "./helpers/history-metadata-counters.ts";

// Only primitive observations; a vi.fn(readSync) retains each original buffer
// argument (including max-sized EOF probes), which is not a bounded IO meter.
const io = vi.hoisted(() => ({ calls: 0, requested: 0, read: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readSync: (...args: unknown[]) => {
      const n = Reflect.apply(fs.readSync, fs, args);
      io.calls++;
      io.requested += Number(args[3]);
      io.read += n;
      return n;
    },
  };
});
const reset = () => {
  io.calls = io.requested = io.read = 0;
};

it("review: aggregate observer preserves parse coercion, receivers, returns and opaque throws", () => {
  const parse = JSON.parse,
    head = IndexTree.prototype.head,
    receiver = {},
    result = { seq: "1", hash: hash("head") },
    fault = {};
  let parseReceiver: unknown, headReceiver: unknown;
  JSON.parse = function (this: unknown, ...args: Parameters<typeof parse>) {
    parseReceiver = this;
    return Reflect.apply(parse, this, args);
  };
  IndexTree.prototype.head = function (this: IndexTree, root, id) {
    headReceiver = this;
    if (id === "throw") throw fault;
    expect(root).toBeNull();
    return result;
  };
  const cost = metadataCost();
  try {
    expect(Reflect.apply(JSON.parse, receiver, [null])).toBeNull();
    expect(parseReceiver).toBe(receiver);
    let coerced = 0;
    expect(
      Reflect.apply(JSON.parse, receiver, [
        {
          toString() {
            coerced++;
            return "1";
          },
        },
      ]),
    ).toBe(1);
    expect(coerced).toBe(1);
    expect(Reflect.apply(JSON.parse, receiver, ["1", () => result])).toBe(
      result,
    );
    let thrown: unknown;
    try {
      Reflect.apply(JSON.parse, receiver, [
        "1",
        () => {
          throw fault;
        },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(fault);
    expect(
      Reflect.apply(IndexTree.prototype.head, receiver, [null, "head"]),
    ).toBe(result);
    expect(headReceiver).toBe(receiver);
    thrown = undefined;
    try {
      Reflect.apply(IndexTree.prototype.head, receiver, [null, "throw"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(fault);
    const sha = createHash("sha256");
    for (let i = 0; i < 1000; i++) expect(sha.update("x")).toBe(sha);
    expect(sha.digest("hex")).toBe(
      createHash("sha256").update("x".repeat(1000)).digest("hex"),
    );
    expect(Object.keys(active!).length).toBeLessThan(20);
    expect(
      Object.values(active!).every(
        (v) => typeof v === "number" && Number.isFinite(v),
      ),
    ).toBe(true);
  } finally {
    cost.close();
    JSON.parse = parse;
    IndexTree.prototype.head = head;
  }
});

it("journal-anchored publication does not rewrite redundant legacy mutable heads", async () => {
  const f = historyFixture();
  const nav = new HistoryNavigation(f.files);
  const legacy = nav.indexPath("entities", f.link.taskId);
  f.files.files.create(legacy, "preserved untrusted legacy hint");
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  await admitFixtureRun(f);
  await f.writer.settled();
  expect(readFileSync(legacy, "utf8")).toBe("preserved untrusted legacy hint");
  expect(existsSync(nav.indexPath("entities", f.link.runId))).toBe(false);
  expect(existsSync(nav.indexPath("rosters", f.link.taskId))).toBe(false);
  // Durable journal/root/entity links still drive real lookup; no fsync or
  // original integrity check is suppressed to obtain this write reduction.
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
  });
});

it("one synchronous head unit reuses original nodes, not a cross-call stale root", () => {
  const f = historyFixture(),
    tree = new IndexTree(f.files);
  const values = new Map(
    Array.from(
      { length: 24 },
      () => [randomUUID(), { seq: "1", hash: hash("head") }] as const,
    ),
  );
  const root = tree.update(f.lease, null, values, () => {});
  const ids = [...values.keys(), randomUUID()];
  reset();
  const original = new Map(
    ids.flatMap((id) => {
      const head = tree.head(root, id);
      return head ? [[id, head] as const] : [];
    }),
  );
  const repeated = { ...io };
  reset();
  expect(tree.heads(root, ids)).toEqual(original);
  expect(io.read * ids.length).toBe(repeated.read);
  expect(io.calls * ids.length).toBe(repeated.calls);
  expect(io.requested * ids.length).toBe(repeated.requested);
  // Each separate invocation must read original bytes again, even on the same
  // tree object. The previous lookup's absence never authorizes stale reuse.
  reset();
  expect(tree.heads(root, ids)).toEqual(original);
  expect(io.read).toBeGreaterThan(0);
  const path = join(
    f.files.directory,
    "indexes",
    "nodes",
    root!.slice(0, 2),
    `${root}.json`,
  );
  const bytes = readFileSync(path);
  writeFileSync(path, '{"kind":"leaf","entries":{}}');
  expect(() => tree.heads(root, ids)).toThrow();
  expect(readFileSync(path, "utf8")).toBe('{"kind":"leaf","entries":{}}');
  // Restore only this fixture's deliberate corruption, then remove just the
  // selected accelerator: the unit cannot silently reuse its old decoded node.
  writeFileSync(path, bytes);
  renameSync(path, `${path}.preserved`);
  expect(() => tree.heads(root, ids)).toThrow();
});

it("exact readback allocation never raises the existing index-record ceiling", () => {
  const f = historyFixture(),
    nav = new HistoryNavigation(f.files);
  const pair = { taskId: randomUUID(), runId: randomUUID() };
  expect(() =>
    nav.publishActive(
      f.lease,
      "0",
      Array.from({ length: 14000 }, () => pair),
      () => {},
    ),
  ).toThrowError(new ContractError("oversize"));
  expect(existsSync(nav.indexPath("heads", "active"))).toBe(false);
});

it("review: a discovery larger than 128 nodes evicts and rereads original nodes", () => {
  const f = historyFixture(),
    tree = new IndexTree(f.files);
  const pathFor = (id: string) =>
    join(f.files.directory, "indexes", "nodes", id.slice(0, 2), `${id}.json`);
  const store = (value: unknown) => {
    const body = canonicalJson(value),
      id = hash(body);
    f.files.files.create(pathFor(id), body);
    return id;
  };
  // Valid immutable radix fixture with 129 distinct two-digit routes. This tests
  // the memo bound without creating thousands of unrelated journal records.
  const routes = new Map<string, string>();
  for (let n = 0; routes.size < 129; n++) {
    const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    routes.set(hash(id).slice(0, 2), id);
  }
  const branches: Record<string, Record<string, string>> = {},
    values = new Map<string, { seq: string; hash: string }>();
  let firstLeaf = "";
  for (const [route, id] of routes) {
    const head = { seq: "1", hash: hash(id) };
    values.set(id, head);
    const leaf = store({ kind: "leaf", entries: { [id]: head } });
    if (!firstLeaf) firstLeaf = pathFor(leaf);
    branches[route[0]] ??= {};
    branches[route[0]][route[1]] = leaf;
  }
  const root = store({
    kind: "branch",
    children: Object.fromEntries(
      Object.entries(branches).map(([key, children]) => [
        key,
        store({ kind: "branch", children }),
      ]),
    ),
  });
  const original = f.files.files.read;
  let firstReads = 0;
  f.files.files.read = function (path, maximum) {
    if (path === firstLeaf) firstReads++;
    return original.call(this, path, maximum);
  };
  try {
    const ids = [...values.keys()];
    expect(tree.heads(root, [...ids, ids[0]])).toEqual(values);
    expect(firstReads).toBe(2); // evicted, not an archive-sized hidden memo
    expect(tree.heads(root, [ids[0]])).toEqual(
      new Map([[ids[0], values.get(ids[0])]]),
    );
    expect(firstReads).toBe(3); // later invocation never inherits the memo
  } finally {
    f.files.files.read = original;
  }
});

it("review: memo misses enforce hash, closed decoding and independent node ceilings", () => {
  const f = historyFixture(),
    tree = new IndexTree(f.files),
    id = randomUUID();
  for (const body of [
    '{"kind":"leaf","entries":{},"unknown":true}',
    '{"kind":"leaf","entries":',
    `{"kind":"leaf","entries":{}}${" ".repeat(16 * 1024)}`,
  ]) {
    const root = hash(body),
      path = join(
        f.files.directory,
        "indexes",
        "nodes",
        root.slice(0, 2),
        `${root}.json`,
      );
    // Deliberately hash-valid malformed/oversized private files; no fake reader.
    f.files.files.create(path, body, Buffer.byteLength(body));
    expect(() => tree.heads(root, [id])).toThrowError(
      new ContractError("receipt-inconclusive"),
    );
    expect(readFileSync(path, "utf8")).toBe(body);
  }
  let charged = 0;
  expect(() =>
    tree.update(
      f.lease,
      null,
      new Map([[id, { seq: "1", hash: "x".repeat(16 * 1024) }]]),
      () => {
        charged++;
      },
    ),
  ).toThrowError(new ContractError("oversize"));
  expect(charged).toBe(0);
});

it("review: discovery cannot authorize update after source change or lease loss", async () => {
  const f = historyFixture(),
    tree = new IndexTree(f.files),
    id = randomUUID();
  const values = new Map([[id, { seq: "1", hash: hash("head") }]]);
  const root = tree.update(f.lease, null, values, () => {});
  expect(tree.heads(root, [id])).toEqual(values);
  await Promise.resolve();
  const path = join(
    f.files.directory,
    "indexes",
    "nodes",
    root!.slice(0, 2),
    `${root}.json`,
  );
  writeFileSync(path, '{"kind":"leaf","entries":{}}');
  let charged = 0;
  expect(() =>
    tree.update(f.lease, root, values, () => {
      charged++;
    }),
  ).toThrowError(new ContractError("receipt-inconclusive"));
  expect(charged).toBe(0);
  expect(readFileSync(path, "utf8")).toBe('{"kind":"leaf","entries":{}}');
  // Inject the original lease refusal at the unchanged pre-effect boundary.
  const original = f.lease.assert,
    fault = new ContractError("conflict");
  let assertions = 0;
  f.lease.assert = () => {
    assertions++;
    throw fault;
  };
  try {
    expect(() =>
      tree.update(f.lease, null, values, () => {
        charged++;
      }),
    ).toThrowError(fault);
    const nav = new HistoryNavigation(f.files);
    expect(() => nav.publishActive(f.lease, "1", [], () => {})).toThrowError(
      fault,
    );
    expect(existsSync(nav.indexPath("heads", "active"))).toBe(false);
    expect(assertions).toBe(2);
    expect(charged).toBe(0);
  } finally {
    f.lease.assert = original;
  }
});

it("review: exact replacement allowance handles shrinking and growing native files", () => {
  const f = historyFixture(),
    nav = new HistoryNavigation(f.files);
  const path = nav.indexPath("heads", "active");
  const pairs = Array.from({ length: 2 }, () => ({
    taskId: randomUUID(),
    runId: randomUUID(),
  }));
  nav.publishActive(f.lease, "1", pairs, () => {});
  const original = f.files.files.replace;
  let shrinks = 0,
    grows = 0;
  f.files.files.replace = function (path, previous, body, maximum) {
    const size = Buffer.byteLength(body);
    expect(maximum).toBe(Math.max(size, previous.bytes.length));
    if (size < previous.bytes.length) shrinks++;
    if (size > previous.bytes.length) grows++;
    return original.call(this, path, previous, body, maximum);
  };
  try {
    nav.publishActive(f.lease, "2", [], () => {});
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      seq: "2",
      runs: [],
    });
    nav.publishActive(f.lease, "3", pairs, () => {});
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      seq: "3",
      runs: pairs,
    });
    expect([shrinks, grows]).toEqual([1, 1]);
  } finally {
    f.files.files.replace = original;
  }
});

it("derived writes keep original lease/fsync paths but bound readback to exact expected bytes", () => {
  const f = historyFixture(),
    nav = new HistoryNavigation(f.files);
  const create = f.files.files.create.bind(f.files.files),
    replace = f.files.files.replace.bind(f.files.files);
  let creations = 0,
    replacements = 0;
  const a = vi
    .spyOn(f.files.files, "create")
    .mockImplementation((path, body, maximum) => {
      if (path.includes(`${join("indexes", "heads")}`)) {
        expect(maximum).toBe(Buffer.byteLength(body));
        creations++;
      }
      return create(path, body, maximum);
    });
  const b = vi
    .spyOn(f.files.files, "replace")
    .mockImplementation((path, previous, body, maximum) => {
      if (path.includes(`${join("indexes", "heads")}`)) {
        expect(maximum).toBe(
          Math.max(previous.bytes.length, Buffer.byteLength(body)),
        );
        replacements++;
      }
      return replace(path, previous, body, maximum);
    });
  try {
    nav.publish(
      f.lease,
      { segment: 1, offset: 0, bytes: 100, seq: "1" },
      [],
      () => {},
    );
    nav.publish(
      f.lease,
      { segment: 1, offset: 100, bytes: 100, seq: "2" },
      [],
      () => {},
    );
    expect(creations).toBeGreaterThan(0);
    expect(replacements).toBe(1);
  } finally {
    a.mockRestore();
    b.mockRestore();
  }
});
