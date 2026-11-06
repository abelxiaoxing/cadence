import {
  mkdir,
  mkdtemp,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RESEARCH_LIMITS as L, ResearchScan } from "../src/research-scan.mjs";
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
it("default-root scans include backup trees and allow explicit external observations", async () => {
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
  const external = await mkdtemp(join(tmpdir(), "research-package-"));
  await writeFile(join(external, "package.json"), '{"name":"fixture"}');
  expect(
    (await call("read", { path: join(external, "package.json") })).items[0],
  ).toMatchObject({
    root: null,
    path: join(external, "package.json"),
    text: '{"name":"fixture"}',
  });
  const shallow = await call("find", { pattern: "*.txt", depth: 0 });
  expect(shallow.items).toEqual([]);
  expect(shallow.state).toBe("done");
  expect(shallow.coverage.complete).toBe(false);
  expect(shallow.coverage.omissions).toContainEqual({
    reason: "depth limit",
    count: 1,
  });
  const regex = await collect("grep", {
    pattern: "evidence [ab]$",
    literal: false,
  });
  expect(regex.items).toHaveLength(2);
  expect(
    (await collect("grep", { pattern: "evidence [ab]$", literal: true })).items,
  ).toEqual([]);
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
  "dependency trees and symlinks are readable without losing logical paths or entering cycles",
  async () => {
    const { root, call, collect } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "research-outside-"));
    await writeFile(
      join(outside, "index.ts"),
      "export const npmCommand = true;",
    );
    await mkdir(join(root, "node_modules"));
    await symlink(outside, join(root, "node_modules", "pi"));
    await symlink(root, join(outside, "loop"));
    const result = await collect("glob", {
      pattern: "node_modules/pi/**/*.{ts,js}",
    });
    expect(result.items).toContainEqual({
      root: 0,
      path: "node_modules/pi/index.ts",
      kind: "file",
    });
    expect(result.final.coverage.omissions).toContainEqual({
      reason: "symlink cycle omitted",
      count: 1,
    });
    const grep = await collect("grep", {
      path: "node_modules",
      pattern: "npmCommand",
    });
    expect(grep.items[0]).toMatchObject({
      path: "node_modules/pi/index.ts",
      text: "export const npmCommand = true;",
    });
    expect(
      (await call("read", { path: "node_modules/pi/index.ts" })).items[0].text,
    ).toContain("npmCommand");
    const listing = await collect("ls", { path: "node_modules" });
    expect(listing.items).toContainEqual({
      root: 0,
      path: "node_modules/pi",
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
      "Glob expansion",
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

it("regex, brace alternatives, extglobs and explicit depth work while malformed requests allocate no scans", async () => {
  const { root, call, collect } = await fixture();
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "api.ts"),
    "npmCommand\nNPM_CONFIG\nother\nliteral.*\n",
  );
  await writeFile(join(root, "src", "api.js"), "NPM_COMMAND\n");
  expect(
    (await collect("glob", { pattern: "**/api.{ts,js}" })).items,
  ).toHaveLength(2);
  expect(
    (await collect("find", { pattern: "**/api.@(ts|js)" })).items,
  ).toHaveLength(2);
  const matches = await collect("grep", {
    patterns: ["^npm(Command|_COMMAND)$", "CONFIG$"],
    ignoreCase: true,
    glob: "**/*.{ts,js}",
  });
  expect(matches.items.map((i) => i.text).sort()).toEqual([
    "NPM_COMMAND",
    "NPM_CONFIG",
    "npmCommand",
  ]);
  expect(
    (await collect("grep", { pattern: "literal.*", literal: true })).items.map(
      (i) => i.text,
    ),
  ).toEqual(["literal.*"]);
  for (let i = 0; i < 6; i++)
    await expect(call("grep", { pattern: "(" })).rejects.toThrow(
      "Invalid regular expression",
    );
  expect(
    (await collect("find", { pattern: "*.ts", depth: 20 })).items,
  ).toHaveLength(1);
  await expect(call("find", { pattern: "{a,b}".repeat(20) })).rejects.toThrow(
    "Glob expansion",
  );
});
it.skipIf(process.platform === "win32")(
  "a retargeted symlink invalidates its continuation instead of mixing sources",
  async () => {
    const { call } = await fixture();
    const external = await mkdtemp(join(tmpdir(), "research-link-target-"));
    await writeFile(join(external, "a"), "first\nsecond\nthird");
    await writeFile(join(external, "b"), "different\ncontent");
    await symlink(join(external, "a"), join(external, "link"));
    const first = await call("read", {
      path: join(external, "link"),
      pageSize: 1,
    });
    await unlink(join(external, "link"));
    await symlink(join(external, "b"), join(external, "link"));
    await expect(call("read", { cursor: first.nextCursor })).rejects.toThrow(
      "source changed",
    );
  },
);
it("find and glob share implementation but never consume each other's cursors", async () => {
  const { root, call } = await fixture();
  await writeFile(join(root, "a.ts"), "a");
  await writeFile(join(root, "b.ts"), "b");
  const first = await call("glob", { pattern: "*.ts", pageSize: 1 });
  await expect(call("find", { cursor: first.nextCursor })).rejects.toThrow(
    "foreign",
  );
  expect((await call("glob", { cursor: first.nextCursor })).state).toBe("done");
});

it.skipIf(process.platform === "win32")(
  "completed traversal aliases release their binding observations",
  async () => {
    const { root } = await fixture();
    const external = await mkdtemp(join(tmpdir(), "research-bindings-"));
    await writeFile(join(external, "source.ts"), "evidence");
    for (const name of ["first", "second", "third"])
      await symlink(external, join(root, name));
    const scan = new ResearchScan(bindWorkerWorkspace(root), {
      kind: "find",
      glob: "*.ts",
      depth: 8,
    });
    scan.begin();
    try {
      const paths = [];
      for await (const next of scan.iterator)
        if (next?.item) paths.push(next.item.path);
      expect(paths.sort()).toEqual([
        "first/source.ts",
        "second/source.ts",
        "third/source.ts",
      ]);
      expect(scan.bindings.size).toBe(0);
    } finally {
      await scan.close();
    }
  },
);
it("tilde selects this account's configured home without copying a profile", async () => {
  const { root, call } = await fixture();
  const home = await mkdtemp(join(tmpdir(), "research-home-"));
  await writeFile(join(home, "public-package.ts"), "installed source");
  vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", home);
  try {
    const result = await call("read", { path: "~/public-package.ts" });
    expect(result.items[0]).toMatchObject({
      root: null,
      text: "installed source",
    });
    expect((await call("ls", { path: root })).items).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
  }
});
