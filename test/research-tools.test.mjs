import { mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RESEARCH_LIMITS as L } from "../src/research-scan.mjs";
import { createResearchTools } from "../src/research-tools.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";

const owned = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((tools) => tools.close()));
  vi.useRealTimers();
});
async function fixture(now) {
  const root = await mkdtemp(join(tmpdir(), "research-tools-"));
  const session = createResearchTools(bindWorkerWorkspace(root), now);
  owned.push(session);
  const call = async (name, args, signal) => {
    const result = await session.tools
      .find((t) => t.name === name)
      .execute("call", args, signal);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      L.outputBytes,
    );
    const page = JSON.parse(result.content[0].text);
    expect(page.nextCursor).toBe(result.details.nextCursor);
    return page;
  };
  const collect = async (name, args) => {
    const pages = [await call(name, args)];
    for (let n = 0; pages.at(-1).nextCursor; n++) {
      expect(n).toBeLessThan(300);
      pages.push(await call(name, { cursor: pages.at(-1).nextCursor }));
    }
    return { pages, items: pages.flatMap((p) => p.items), final: pages.at(-1) };
  };
  return { root, call, collect, session };
}
it("scoped scans include backup trees, return real continuations and refuse parent escapes", async () => {
  const { root, call, collect } = await fixture();
  await mkdir(join(root, "backup"));
  for (const name of ["a", "b", "c"])
    await writeFile(
      join(root, "backup", `${name}.txt`),
      `literal.* evidence ${name}\n`,
    );
  const found = await collect("find", {
    path: "backup",
    pattern: "*.txt",
    pageSize: 2,
  });
  expect(found.pages).toHaveLength(2);
  expect(new Set(found.items.map((i) => i.path)).size).toBe(3);
  expect(found.final.coverage.complete).toBe(true);
  const grep = await collect("grep", { path: "backup", pattern: "literal.*" });
  expect(grep.items).toHaveLength(3);
  expect(grep.items).toContainEqual({
    root: 0,
    path: "backup/a.txt",
    line: 1,
    text: "literal.* evidence a",
    matchedPatterns: [0],
  });
  await expect(call("ls", { path: ".." })).rejects.toThrow(
    "outside investigation roots",
  );
  const shallow = await call("find", { pattern: "*.txt", depth: 0 });
  expect(shallow.items).toEqual([]);
  expect(shallow.state).toBe("done");
  expect(shallow.coverage.complete).toBe(false);
  expect(shallow.coverage.omissions).toContainEqual({
    reason: "depth limit",
    count: 1,
  });
  await expect(
    call("grep", { pattern: "a.*", literal: false }),
  ).rejects.toThrow("literal");
});
it("line/range batches merge overlaps, scan a file once and complete the requested range independently of EOF", async () => {
  const { root, collect, call } = await fixture();
  const body = Array.from(
    { length: 1000 },
    (_, i) => `${i + 1}: ${"x".repeat(95)}\n`,
  ).join("");
  await writeFile(join(root, "a"), body);
  await writeFile(join(root, "b"), "other\n");
  const { items, final, pages } = await collect("read", {
    files: [
      {
        path: "a",
        ranges: [
          { start: 11, end: 20 },
          { start: 1, end: 12 },
        ],
      },
      { path: "a", ranges: [{ start: 25, end: 25 }] },
      { path: "b" },
    ],
    pageSize: 4,
  });
  expect(items.filter((i) => i.path === "a").map((i) => i.line)).toEqual([
    ...Array.from({ length: 20 }, (_, i) => i + 1),
    25,
  ]);
  expect(items.at(-1).text).toBe("other");
  expect(final.coverage.complete).toBe(true);
  expect(final.progress.total.readBytes).toBe(L.chunkBytes + 6);
  expect(pages.reduce((sum, p) => sum + p.progress.readBytes, 0)).toBe(
    final.progress.total.readBytes,
  );
  const exact = await call("read", {
    path: "a",
    offset: 1,
    limit: 10,
    pageSize: 10,
  });
  expect(exact.items).toHaveLength(10);
  expect(exact.state).toBe("done");
  expect(exact.coverage.complete).toBe(true);
});
it("literal multi-pattern search reaches beyond 1MiB with empty progress pages and no prefix rescan", async () => {
  const { root, collect } = await fixture();
  const body = `${`${"x".repeat(4095)}\n`.repeat(300)}Alpha tail\nbeta\n`;
  await writeFile(join(root, "large"), body);
  const result = await collect("grep", {
    path: "large",
    patterns: ["alpha", "BETA", "tail"],
    ignoreCase: true,
  });
  expect(result.pages[0].state).toBe("more");
  expect(result.pages[0].items).toEqual([]);
  expect(result.pages[0].coverage.complete).toBe(false);
  expect(result.items.map((i) => [i.line, i.matchedPatterns])).toEqual([
    [301, [0, 2]],
    [302, [1]],
  ]);
  expect(result.final.coverage.complete).toBe(true);
  expect(result.final.progress.total.readBytes).toBe(Buffer.byteLength(body));
  const tail = await collect("read", { path: "large", offset: 301, limit: 2 });
  expect(tail.pages[0].items).toEqual([]);
  expect(tail.items.map((i) => i.text)).toEqual(["Alpha tail", "beta"]);
  expect(tail.final.coverage.complete).toBe(true);
});
it("UTF-8 split at chunk and file quanta preserves valid lines; long lines do not block later evidence", async () => {
  const { root, collect } = await fixture();
  const prefix = `${"x".repeat(4095)}\n`.repeat(255);
  const body = `${prefix}${"a".repeat(4095)}你\nretained evidence\n`;
  await writeFile(join(root, "utf8"), body);
  const result = await collect("read", { path: "utf8", offset: 256, limit: 2 });
  expect(result.items.map((i) => i.text)).toEqual([
    `${"a".repeat(4095)}你`,
    "retained evidence",
  ]);
  expect(result.final.coverage.complete).toBe(true);
  await writeFile(
    join(root, "long"),
    `${"z".repeat(L.fileBytes + 3)}\nnext line\n`,
  );
  const long = await collect("read", { path: "long" });
  expect(long.items.map((i) => i.text)).toEqual(["next line"]);
  expect(long.final.coverage.complete).toBe(false);
  expect(long.final.coverage.omissions).toContainEqual({
    reason: "long line omitted",
    count: 1,
  });
});
it("per-line UTF-8 decoding preserves embedded BOM characters for reads and literal searches", async () => {
  const { root, collect } = await fixture();
  await writeFile(join(root, "bom"), "head\n\uFEFFneedle\n\uFEFFother");
  const read = await collect("read", { path: "bom", pageSize: 1 });
  expect(read.items.map((item) => item.text)).toEqual([
    "head",
    "\uFEFFneedle",
    "\uFEFFother",
  ]);
  const grep = await collect("grep", { path: "bom", pattern: "\uFEFFneedle" });
  expect(grep.items.map((item) => [item.line, item.text])).toEqual([
    [2, "\uFEFFneedle"],
  ]);
  expect(grep.final.coverage.complete).toBe(true);
});
it("binary and invalid UTF-8 are labelled, while valid neighboring lines remain evidence", async () => {
  const { root, call } = await fixture();
  await writeFile(join(root, "binary"), Buffer.from([0, 1, 2]));
  const binary = await call("read", { path: "binary" });
  expect(binary.coverage.omissions).toContainEqual({
    reason: "binary file omitted",
    count: 1,
  });
  await writeFile(join(root, "invalid"), Buffer.from([97, 10, 255, 10, 98]));
  const invalid = await call("read", { path: "invalid" });
  expect(invalid.items.map((i) => i.text)).toEqual(["a", "b"]);
  expect(invalid.coverage.omissions).toContainEqual({
    reason: "non-UTF-8 line omitted",
    count: 1,
  });
  await expect(call("read", { path: "." })).rejects.toThrow("regular text");
});
it.skipIf(process.platform === "win32").each(["find", "grep", "read"])(
  "%s never treats an explicitly selected special file as regular text",
  async (tool) => {
    const { root, call } = await fixture();
    const path = join(root, "socket");
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    try {
      if (tool === "read") {
        await expect(call(tool, { path })).rejects.toThrow(
          "Only regular text files can be read",
        );
        return;
      }
      const page = await call(tool, {
        path,
        pattern: tool === "find" ? "*" : "needle",
      });
      expect(page.items).toEqual([]);
      expect(page.state).toBe("done");
      expect(page.coverage.complete).toBe(false);
      expect(page.coverage.omissions).toContainEqual({
        reason: "special file omitted",
        count: 1,
      });
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
it("JSON escaping, path labels and metadata count against the complete output bound without losing rows", async () => {
  const { root, collect } = await fixture();
  const body = `${'\t"\\'.repeat(1000)}\n`.repeat(8);
  await writeFile(join(root, "quoted"), body);
  const result = await collect("read", { path: "quoted" });
  expect(result.pages.length).toBeGreaterThan(1);
  expect(result.items).toHaveLength(8);
  expect(result.items.map((i) => i.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(result.final.coverage.complete).toBe(true);
});
it("cooperative time exhaustion returns a continuation, not final omission or absence", async () => {
  let ticks = 0;
  const { root, call } = await fixture(() => ticks++ * 15000);
  await writeFile(join(root, "a"), "evidence");
  const page = await call("ls", {});
  expect(page.state).toBe("more");
  expect(page.nextCursor).toEqual(expect.any(String));
  expect(page.pausedBy).toBe("cooperative time quantum");
  expect(page.coverage.omissions).toEqual([]);
});
it("elapsed worker time and more than 64 calls do not impose cumulative admission limits", async () => {
  let clock = 0;
  const { root, call } = await fixture(() => clock);
  await writeFile(join(root, "a"), "evidence");
  const abort = new AbortController();
  abort.abort();
  await expect(call("read", { path: "a" }, abort.signal)).rejects.toThrow(
    "canceled",
  );
  for (let i = 0; i < 80; i++) {
    clock += 30000;
    expect((await call("read", { path: "a" })).items[0].text).toBe("evidence");
  }
});
it.skipIf(process.platform === "win32")(
  "tree symlinks and default exclusions never silently expand coverage",
  async () => {
    const { root, call, collect } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "research-outside-"));
    await writeFile(join(outside, "private.txt"), "not selected");
    await symlink(outside, join(root, "link"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "omitted.txt"), "not selected");
    const result = await collect("find", { pattern: "*.txt" });
    expect(result.items).toEqual([]);
    expect(result.final.coverage.omissions).toEqual(
      expect.arrayContaining([
        { reason: "symlink omitted", count: 1 },
        { reason: ".git/node_modules omitted", count: 1 },
      ]),
    );
    await expect(call("read", { path: "link/private.txt" })).rejects.toThrow(
      "outside investigation roots",
    );
    const listing = await collect("ls", { pageSize: 1 });
    expect(listing.items).toContainEqual({
      root: 0,
      path: "link",
      kind: "symlink",
    });
    expect(listing.final.coverage.complete).toBe(true);
  },
);
it("explicit roots, not an unrelated checkout, bind relative requests; schema errors do not allocate cursors", async () => {
  const { root, call } = await fixture();
  const selected = await mkdtemp(join(tmpdir(), "selected-root-"));
  await writeFile(join(selected, "save.txt"), "selected evidence");
  const tools = createResearchTools(bindWorkerWorkspace(root, [selected]));
  owned.push(tools);
  const result = await tools.tools
    .find((t) => t.name === "read")
    .execute("id", { path: "save.txt" });
  expect(result.content[0].text).toContain("selected evidence");
  for (let i = 0; i < 8; i++)
    await expect(call("find", { pattern: "{1..100000000}" })).rejects.toThrow(
      "simple glob",
    );
  await expect(
    call("read", { files: [{ path: "a", ranges: [{ start: 5, end: 1 }] }] }),
  ).rejects.toThrow("range");
  await expect(call("grep", { patterns: Array(17).fill("a") })).rejects.toThrow(
    "batch",
  );
  expect((await call("ls", {})).state).toBe("done");
});
it("cursors are one-use, tool-bound, non-rebindable, and limited by live resources only", async () => {
  const { root, call } = await fixture();
  await writeFile(join(root, "a"), "1\n2\n3\n");
  const cursors = [];
  for (let i = 0; i < L.scans; i++)
    cursors.push((await call("read", { path: "a", pageSize: 1 })).nextCursor);
  await expect(call("read", { path: "a" })).rejects.toThrow("capacity");
  await expect(call("grep", { cursor: cursors[0] })).rejects.toThrow("foreign");
  await expect(
    call("read", { cursor: cursors[0], path: "other" }),
  ).rejects.toThrow("arguments");
  const page = await call("read", { cursor: cursors[0] });
  expect(page.items[0].line).toBe(2);
  await expect(call("read", { cursor: cursors[0] })).rejects.toThrow(
    "consumed",
  );
  expect(
    (await call("read", { cursor: page.nextCursor, close: true })).state,
  ).toBe("closed");
  expect((await call("read", { path: "a" })).state).toBe("done");
});
it("expired cursors close owned resources without restarting or evicting any other scan", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let clock = 0;
  const { root, call } = await fixture(() => clock);
  await writeFile(join(root, "a"), "1\n2\n3");
  const page = await call("read", { path: "a", pageSize: 1 });
  clock = L.idleMs;
  await vi.advanceTimersByTimeAsync(L.idleMs);
  await expect(call("read", { cursor: page.nextCursor })).rejects.toThrow(
    /consumed|expired/,
  );
  expect((await call("read", { path: "a" })).state).toBe("done");
});
it.each(["modify", "replace", "directory"])(
  "%s invalidates continuation instead of mixing source versions",
  async (change) => {
    const { root, call } = await fixture();
    await writeFile(join(root, "a"), "1\n2\n3");
    const page = await call("read", { path: "a", pageSize: 1 });
    if (change === "modify") await writeFile(join(root, "a"), "changed source");
    if (change === "replace") {
      await rename(join(root, "a"), join(root, "old"));
      await writeFile(join(root, "a"), "other source");
    }
    if (change === "directory") await writeFile(join(root, "added"), "new");
    await expect(call("read", { cursor: page.nextCursor })).rejects.toThrow(
      "source changed",
    );
  },
);
it("close refuses new calls and invalidates all suspended cursors", async () => {
  const { root, call, session } = await fixture();
  await writeFile(join(root, "a"), "1\n2");
  const page = await call("read", { path: "a", pageSize: 1 });
  const closing = session.close();
  expect(session.close()).toBe(closing);
  await closing;
  await expect(call("read", { cursor: page.nextCursor })).rejects.toThrow(
    "closed",
  );
  await expect(call("ls", {})).rejects.toThrow("closed");
});
it("concurrent cursor consumption has one owner; pre-cancel and foreign workers cannot consume it", async () => {
  const f = await fixture();
  const other = await fixture();
  await writeFile(join(f.root, "a"), "1\n2\n3\n4");
  const page = await f.call("read", { path: "a", pageSize: 1 });
  const abort = new AbortController();
  abort.abort();
  await expect(
    f.call("read", { cursor: page.nextCursor }, abort.signal),
  ).rejects.toThrow("canceled");
  await expect(other.call("read", { cursor: page.nextCursor })).rejects.toThrow(
    "foreign",
  );
  const first = f.call("read", { cursor: page.nextCursor });
  await expect(f.call("read", { cursor: page.nextCursor })).rejects.toThrow(
    "consumed",
  );
  expect((await first).items[0].line).toBe(2);
});
