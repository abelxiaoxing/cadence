import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let scopedTools = null;
try {
  scopedTools = await import("../src/scoped-tools");
} catch {
  scopedTools = null;
}

const notReady = (what: string) => {
  expect.fail(`not_ready: ${what} is not implemented`);
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0))
    rmSync(r, { recursive: true, force: true });
});

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "abel-scoped-"));
  tempRoots.push(root);
  return root;
}

describe("scoped read-only tools", () => {
  it("rejects absolute, parent, backslash, NUL, and noncanonical paths", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "hello");
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const read = tools.find((t) => t.name === "read")!;
    const hostile = [
      "/etc/passwd",
      "../secret",
      "a/../../b",
      "a\\b",
      "a\u0000b",
      "./a.txt",
      "a//b",
      path.join(root, "a.txt"),
    ];
    for (const p of hostile) {
      const result = await read.execute({ path: p });
      expect(result.ok, `path ${JSON.stringify(p)} must be rejected`).toBe(
        false,
      );
      expect(result.error).toBeTruthy();
    }
  });

  it("rejects symlink escapes and never follows symlinks", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    const outside = mkdtempSync(path.join(tmpdir(), "abel-outside-"));
    tempRoots.push(outside);
    writeFileSync(path.join(outside, "secret.txt"), "top secret");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const read = tools.find((t) => t.name === "read")!;
    const result = await read.execute({ path: "link.txt" });
    expect(result.ok).toBe(false);
  });

  it("reads regular UTF-8 text files and identifies truncation at 50 KiB / 2,000 lines", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    writeFileSync(path.join(root, "small.txt"), "hello world\n");
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const read = tools.find((t) => t.name === "read")!;
    const small = await read.execute({ path: "small.txt" });
    expect(small.ok).toBe(true);
    expect(small.content as string).toContain("hello world");
    expect(small.truncated).toBe(false);

    writeFileSync(path.join(root, "big.txt"), "x".repeat(60 * 1024));
    const big = await read.execute({ path: "big.txt" });
    expect(big.ok).toBe(true);
    expect(big.truncated).toBe(true);
    expect((big.content as string).length).toBeLessThan(60 * 1024);

    writeFileSync(
      path.join(root, "many.txt"),
      Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"),
    );
    const many = await read.execute({ path: "many.txt" });
    expect(many.ok).toBe(true);
    expect(many.truncated).toBe(true);
  });

  it("rejects directories and non-regular files", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    mkdirSync(path.join(root, "sub"));
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const read = tools.find((t) => t.name === "read")!;
    expect((await read.execute({ path: "sub" })).ok).toBe(false);
  });

  it("enforces grep pattern and scan bounds", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    for (let i = 0; i < 20; i++)
      writeFileSync(path.join(root, `f${i}.txt`), `content ${i}\nneedle-${i}`);
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const grep = tools.find((t) => t.name === "grep")!;
    const longPattern = "a".repeat(1100);
    const bad = await grep.execute({ pattern: longPattern, path: "." });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/1024|pattern/i);
    const good = await grep.execute({ pattern: "needle-3", path: "." });
    expect(good.ok).toBe(true);
    expect(
      (good.matches as { path: string; line: number; text: string }[]).some(
        (m) => m.path === "f3.txt",
      ),
    ).toBe(true);
  });

  it("hides .git and node_modules unless explicitly in scope", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    mkdirSync(path.join(root, ".git"));
    mkdirSync(path.join(root, "node_modules"));
    writeFileSync(path.join(root, ".git", "config"), "secret");
    writeFileSync(path.join(root, "node_modules", "x.js"), "secret");
    writeFileSync(path.join(root, "ok.txt"), "visible");
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const ls = tools.find((t) => t.name === "ls")!;
    const listing = await ls.execute({ path: "." });
    expect(listing.ok).toBe(true);
    const entries = listing.entries as { name: string; type: string }[];
    expect(entries.map((e) => e.name)).toContain("ok.txt");
    expect(entries.map((e) => e.name)).not.toContain(".git");
    expect(entries.map((e) => e.name)).not.toContain("node_modules");
    const read = tools.find((t) => t.name === "read")!;
    expect((await read.execute({ path: ".git/config" })).ok).toBe(false);
  });

  it("never mutates the filesystem", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "original");
    const tools = scopedTools.createScopedTools({ roots: [root] });
    for (const tool of tools) {
      const params =
        tool.name === "read"
          ? { path: "a.txt" }
          : tool.name === "grep"
            ? { pattern: "a", path: "." }
            : { path: "." };
      const result = await tool.execute(params);
      expect(result.ok).toBe(true);
    }
    const after = readFileSync(path.join(root, "a.txt"), "utf8");
    expect(after).toBe("original");
    expect(readdirSync(root).sort()).toEqual(["a.txt"]);
  });

  it("rejects reads and scans outside the declared read/write paths", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    writeFileSync(path.join(root, "allowed.txt"), "allowed\n");
    writeFileSync(path.join(root, "undeclared.txt"), "secret\n");
    const tools = scopedTools.createScopedTools({
      roots: [root],
      allowedPaths: [path.join(root, "allowed.txt")],
    });
    const read = tools.find((tool) => tool.name === "read")!;
    const grep = tools.find((tool) => tool.name === "grep")!;

    expect((await read.execute({ path: "allowed.txt" })).ok).toBe(true);
    expect(await read.execute({ path: "undeclared.txt" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/declared|scope/i),
    });
    expect(await grep.execute({ path: ".", pattern: "secret" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/declared|scope/i),
    });
  });
});

describe("generated path containment with a fixed seed", () => {
  it("never allows a generated escape path", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "x");
    const rand = mulberry32(0x5c07);
    const chunks = ["..", ".", "a", "a.txt", "sub", "\\", "x\u0000y", "/"];
    const tools = scopedTools.createScopedTools({ roots: [root] });
    const read = tools.find((t) => t.name === "read")!;
    const ls = tools.find((t) => t.name === "ls")!;
    for (let i = 0; i < 150; i++) {
      const n = 1 + Math.floor(rand() * 4);
      const p = Array.from(
        { length: n },
        () => chunks[Math.floor(rand() * chunks.length)],
      ).join("/");
      const result = await read.execute({ path: p });
      const lsResult = await ls.execute({ path: p });
      if (p === "a.txt") {
        expect(result.ok).toBe(true);
      } else if (p === "." || p === "a" || p.includes("sub")) {
        // "." is canonical; "a" is a file path for read but a dir for ls
      } else {
        expect(
          result.ok,
          `read must reject generated path ${JSON.stringify(p)}`,
        ).toBe(false);
        expect(
          lsResult.ok,
          `ls must reject generated path ${JSON.stringify(p)}`,
        ).toBe(false);
      }
    }
  });
});
