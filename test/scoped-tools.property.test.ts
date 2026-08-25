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
            : tool.name === "find"
              ? { path: ".", pattern: "**" }
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
    const find = tools.find((tool) => tool.name === "find")!;
    const ls = tools.find((tool) => tool.name === "ls")!;

    expect((await read.execute({ path: "allowed.txt" })).ok).toBe(true);
    expect(await read.execute({ path: "undeclared.txt" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/declared|scope/i),
    });
    expect(await grep.execute({ path: ".", pattern: "secret" })).toMatchObject({
      ok: true,
      matches: [],
    });
    expect(await grep.execute({ path: ".", pattern: "allowed" })).toMatchObject(
      {
        ok: true,
        matches: [expect.objectContaining({ path: "allowed.txt" })],
      },
    );
    expect(await ls.execute({})).toMatchObject({
      ok: true,
      entries: [{ name: "allowed.txt", type: "file" }],
    });
    expect(await find.execute({ pattern: "*.txt" })).toMatchObject({
      ok: true,
      entries: ["allowed.txt"],
    });
  });

  it("accepts Pi-style scoped arguments without escaping declared paths", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src", "index.ts"),
      Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    writeFileSync(path.join(root, "src", "other.ts"), "other\n");
    writeFileSync(path.join(root, "readme.md"), "# readme\n");
    const tools = scopedTools.createScopedTools({
      roots: [root],
      allowedPaths: [
        path.join(root, "src", "index.ts"),
        path.join(root, "src", "other.ts"),
      ],
    });
    const find = tools.find((tool) => tool.name === "find")!;
    const ls = tools.find((tool) => tool.name === "ls")!;
    const read = tools.find((tool) => tool.name === "read")!;
    const grep = tools.find((tool) => tool.name === "grep")!;

    const listed = await ls.execute({});
    expect(listed.ok).toBe(true);
    expect(
      (listed.entries as { name: string }[]).map((entry) => entry.name),
    ).toEqual(["src"]);

    const found = await find.execute({ pattern: "*.ts" });
    expect(found.ok).toBe(true);
    expect(found.entries).toEqual(["src/index.ts", "src/other.ts"]);
    expect(
      (found.entries as string[]).every((entry) => !path.isAbsolute(entry)),
    ).toBe(true);

    const nested = await find.execute({
      path: "src",
      pattern: "*.ts",
      limit: 1,
    });
    expect(nested).toMatchObject({ ok: true, entries: ["index.ts"] });
    expect(await find.execute({ path: "src" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/pattern/i),
    });

    const windowed = await read.execute({
      path: "src/index.ts",
      offset: 4,
      limit: 3,
    });
    expect(windowed.ok).toBe(true);
    expect(windowed.content).toBe("line 4\nline 5\nline 6");
    expect(
      await read.execute({ path: "src/index.ts", offset: 13, limit: 1 }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/offset|line/i),
    });

    const grepped = await grep.execute({ pattern: "line 1" });
    expect(grepped.ok).toBe(true);
    expect(
      (grepped.matches as { path: string }[]).map((match) => match.path),
    ).toContain("src/index.ts");
    expect(JSON.stringify({ listed, found, grepped })).not.toContain(
      "readme.md",
    );
  });

  it("scans every related root when Pi-style paths are omitted", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const workspace = makeRoot();
    const srcRoot = path.join(workspace, "src");
    const testRoot = path.join(workspace, "test");
    mkdirSync(srcRoot);
    mkdirSync(testRoot);
    writeFileSync(path.join(srcRoot, "source.ts"), "shared needle\n");
    writeFileSync(path.join(testRoot, "source.test.ts"), "shared needle\n");
    writeFileSync(path.join(workspace, "outside.ts"), "shared needle\n");
    const tools = scopedTools.createScopedTools({
      roots: [srcRoot, testRoot],
      allowedPaths: [
        path.join(srcRoot, "source.ts"),
        path.join(testRoot, "source.test.ts"),
      ],
    });
    const find = tools.find((tool) => tool.name === "find")!;
    const grep = tools.find((tool) => tool.name === "grep")!;
    const ls = tools.find((tool) => tool.name === "ls")!;

    expect(await find.execute({ pattern: "*.ts" })).toMatchObject({
      ok: true,
      entries: ["src/source.ts", "test/source.test.ts"],
    });
    expect(await grep.execute({ pattern: "needle" })).toMatchObject({
      ok: true,
      matches: [
        expect.objectContaining({ path: "src/source.ts" }),
        expect.objectContaining({ path: "test/source.test.ts" }),
      ],
    });
    expect(await ls.execute({})).toMatchObject({
      ok: true,
      entries: [
        { name: "src", type: "dir" },
        { name: "test", type: "dir" },
      ],
    });
    expect(
      JSON.stringify({
        find: await find.execute({ pattern: "*.ts" }),
        grep: await grep.execute({ pattern: "needle" }),
      }),
    ).not.toContain("outside.ts");
  });

  it("supports standard positive and negated glob character classes", async () => {
    if (!scopedTools) return notReady("scoped-tools");
    const root = makeRoot();
    mkdirSync(path.join(root, "src"));
    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      writeFileSync(path.join(root, "src", name), `${name}\n`);
    }
    const find = scopedTools
      .createScopedTools({
        roots: [root],
        allowedPaths: [path.join(root, "src")],
      })
      .find((tool) => tool.name === "find")!;

    expect(
      await find.execute({ path: "src", pattern: "[ab].ts" }),
    ).toMatchObject({
      ok: true,
      entries: ["a.ts", "b.ts"],
    });
    expect(
      await find.execute({ path: "src", pattern: "[!a].ts" }),
    ).toMatchObject({
      ok: true,
      entries: ["b.ts", "c.ts"],
    });
    expect(
      await find.execute({ path: "src", pattern: "[^a].ts" }),
    ).toMatchObject({
      ok: true,
      entries: ["b.ts", "c.ts"],
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
