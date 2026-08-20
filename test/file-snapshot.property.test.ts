import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let snapshots = null;
try {
  snapshots = await import("../src/file-snapshot");
} catch {
  snapshots = null;
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
  const root = mkdtempSync(path.join(tmpdir(), "abel-snap-"));
  tempRoots.push(root);
  return root;
}

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

describe("file snapshot invariants", () => {
  it("captures a file snapshot bound to content hashes", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    const bound = snapshots.snapshotFiles(root, ["a.txt"]);
    const entry = bound["a.txt"] as {
      sha256: string;
      bytes: number;
      kind: "file";
    };
    expect(entry.sha256).toBe(sha("alpha"));
    expect(entry.bytes).toBe(5);
    expect(entry.kind).toBe("file");
    expect(snapshots.isCurrent(root, bound)).toBe(true);
  });

  it("is idempotent across recaptures of unchanged files", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    const first = snapshots.snapshotFiles(root, ["a.txt"]);
    const second = snapshots.snapshotFiles(root, ["a.txt"]);
    expect(second).toEqual(first);
  });

  it("is independent of path input order", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    writeFileSync(path.join(root, "b.txt"), "beta");
    const one = snapshots.snapshotFiles(root, ["b.txt", "a.txt"]);
    const two = snapshots.snapshotFiles(root, ["a.txt", "b.txt"]);
    expect(one).toEqual(two);
  });

  it("stays current when an unrelated file changes", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    writeFileSync(path.join(root, "b.txt"), "beta");
    const bound = snapshots.snapshotFiles(root, ["a.txt"]);
    writeFileSync(path.join(root, "b.txt"), "changed outside the bound set");
    expect(snapshots.isCurrent(root, bound)).toBe(true);
  });

  it("becomes stale on content change, deletion, or creation of a bound file", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    const bound = snapshots.snapshotFiles(root, ["a.txt"]);
    writeFileSync(path.join(root, "a.txt"), "changed");
    expect(snapshots.isCurrent(root, bound)).toBe(false);

    const root2 = makeRoot();
    writeFileSync(path.join(root2, "a.txt"), "alpha");
    const bound2 = snapshots.snapshotFiles(root2, ["a.txt"]);
    rmSync(path.join(root2, "a.txt"));
    expect(snapshots.isCurrent(root2, bound2)).toBe(false);

    const root3 = makeRoot();
    writeFileSync(path.join(root3, "a.txt"), "alpha");
    const absent = snapshots.snapshotFiles(root3, ["new.txt"], {
      absent: ["new.txt"],
    });
    expect(snapshots.isCurrent(root3, absent)).toBe(true);
    writeFileSync(path.join(root3, "new.txt"), "now exists");
    expect(snapshots.isCurrent(root3, absent)).toBe(false);
  });

  it("tracks observed directories and invalidates when the manifest changes", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "a.txt"), "alpha");
    const bound = snapshots.snapshotDirManifests(root, ["."]);
    expect(snapshots.isCurrent(root, bound)).toBe(true);
    writeFileSync(path.join(root, "b.txt"), "added");
    expect(snapshots.isCurrent(root, bound)).toBe(false);
  });

  it("invalidates a dependency directory when nested file content changes", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    const dependency = path.join(root, "node_modules/pkg/index.js");
    writeFileSync(dependency, 'export const value = "old";\n');
    const bound = snapshots.snapshotDirManifests(root, ["node_modules"]);

    writeFileSync(dependency, 'export const value = "new";\n');

    expect(snapshots.isCurrent(root, bound)).toBe(false);
  });

  it("respects generated changes with a fixed seed", () => {
    if (!snapshots) return notReady("file-snapshot");
    const rand = mulberry32(0xf1e5);
    const root = makeRoot();
    const files = ["a.txt", "b.txt", "c.txt"];
    for (const f of files) writeFileSync(path.join(root, f), `v0-${f}`);
    for (let i = 0; i < 50; i++) {
      const bound = snapshots.snapshotFiles(root, files);
      const pick = files[Math.floor(rand() * files.length)];
      const mutate = rand() < 0.5;
      if (mutate) writeFileSync(path.join(root, pick), `v1-${pick}-${i}`);
      expect(snapshots.isCurrent(root, bound)).toBe(!mutate);
    }
  });
});

describe("proposed write targets", () => {
  it("binds an explicit absent marker for proposed new paths", () => {
    if (!snapshots) return notReady("file-snapshot");
    const root = makeRoot();
    writeFileSync(path.join(root, "existing.txt"), "keep");
    const bound = snapshots.snapshotFiles(
      root,
      ["existing.txt", "proposed/new-file.ts"],
      { absent: ["proposed/new-file.ts"] },
    );
    expect(bound["proposed/new-file.ts"]).toEqual({
      kind: "absent",
      absent: true,
    });
    expect(snapshots.isCurrent(root, bound)).toBe(true);
    mkdirSync(path.join(root, "proposed"));
    writeFileSync(path.join(root, "proposed", "new-file.ts"), "created");
    expect(snapshots.isCurrent(root, bound)).toBe(false);
  });
});
