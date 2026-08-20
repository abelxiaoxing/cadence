import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let patch: typeof import("../src/patch") | null = null;
let storeMod: typeof import("../src/result-store") | null = null;
try {
  patch = await import("../src/patch");
  storeMod = await import("../src/result-store");
} catch {
  patch = null;
  storeMod = null;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "abel-patch-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd: root });
  writeFileSync(join(root, "a.txt"), "old\n");
  execFileSync("git", ["add", "a.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";

describe("parent-owned exact patch application", () => {
  it("retains exact bytes, validates snapshot, screens targets, checks, and applies once", async () => {
    if (!patch || !storeMod) return notReady("patch path");
    const root = fixture();
    const store = new storeMod.ResultStore();
    const id = store.retain({ diff, writeSet: ["a.txt"], root });
    const result = await patch.applyRetainedPatch({ root, id, store });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("new\n");
    expect(store.get(id)).toBeUndefined();
    const accepted = result as {
      ok: true;
      targets: string[];
      checkExitCode: 0;
      applyExitCode: 0;
    };
    expect(accepted.targets).toEqual(["a.txt"]);
    expect(accepted.checkExitCode).toBe(0);
    expect(accepted.applyExitCode).toBe(0);
  });

  it("rejects a stale file snapshot without mutation", async () => {
    if (!patch || !storeMod) return notReady("patch path");
    const root = fixture();
    const store = new storeMod.ResultStore();
    const id = store.retain({ diff, writeSet: ["a.txt"], root });
    writeFileSync(join(root, "a.txt"), "changed by sibling\n");
    const before = readFileSync(join(root, "a.txt"), "utf8");
    const result = await patch.applyRetainedPatch({ root, id, store });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/stale/i);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(before);
  });

  it("rejects cancellation before Git screening without mutation", async () => {
    if (!patch || !storeMod) return notReady("patch path");
    const root = fixture();
    const store = new storeMod.ResultStore();
    const id = store.retain({ diff, writeSet: ["a.txt"], root });
    const abort = new AbortController();
    abort.abort(new Error("cancel apply before Git screening"));

    const result = await patch.applyRetainedPatch({
      root,
      id,
      store,
      signal: abort.signal,
    });

    expect(result).toEqual({
      ok: false,
      error: "candidate application cancelled",
    });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("old\n");
    expect(store.get(id)).toBeDefined();
  });

  it("finishes an in-flight final apply before reporting cancellation", async () => {
    if (!patch || !storeMod) return notReady("patch path");
    const root = fixture();
    const store = new storeMod.ResultStore();
    const id = store.retain({ diff, writeSet: ["a.txt"], root });
    const bin = join(root, "test-bin");
    const wrapper = join(bin, "git");
    const marker = join(root, "apply-started");
    const originalPath = process.env.PATH;
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    mkdirSync(bin);
    writeFileSync(
      wrapper,
      [
        "#!/bin/sh",
        '"$CADENCE_PATCH_REAL_GIT" "$@"',
        "status=$?",
        'if [ "$*" = "apply --recount --whitespace=nowarn -" ]; then',
        '  : > "$CADENCE_PATCH_TEST_MARKER"',
        "  sleep 0.2",
        "fi",
        'exit "$status"',
        "",
      ].join("\n"),
    );
    chmodSync(wrapper, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    process.env.CADENCE_PATCH_REAL_GIT = realGit;
    process.env.CADENCE_PATCH_TEST_MARKER = marker;
    const controller = new AbortController();

    try {
      const applying = patch.applyRetainedPatch({
        root,
        id,
        store,
        signal: controller.signal,
      });
      for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(existsSync(marker)).toBe(true);
      controller.abort(new Error("cancel after final apply started"));
      const result = await applying;

      expect(result.ok).toBe(true);
      expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("new\n");
      expect(store.get(id)).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
      delete process.env.CADENCE_PATCH_REAL_GIT;
      delete process.env.CADENCE_PATCH_TEST_MARKER;
    }
  });

  it("rejects binary, rename, mode, submodule, duplicate, and out-of-scope patches", async () => {
    if (!patch || !storeMod) return notReady("patch path");
    const root = fixture();
    const bad = [
      "GIT binary patch\nliteral 0\n",
      "--- a/a.txt\n+++ b/b.txt\nrename from a.txt\nrename to b.txt\n",
      "--- a/a.txt\n+++ b/a.txt\nold mode 100644\nnew mode 100755\n",
      "--- /dev/null\n+++ b/mod\nnew file mode 160000\n",
      "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+one\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+two\n",
      "--- /dev/null\n+++ b/outside.txt\n@@ -0,0 +1 @@\n+x\n",
    ];
    for (const candidate of bad) {
      const store = new storeMod.ResultStore();
      const id = store.retain({ diff: candidate, writeSet: ["a.txt"], root });
      const before = readFileSync(join(root, "a.txt"), "utf8");
      const result = await patch.applyRetainedPatch({ root, id, store });
      expect(result.ok, candidate.slice(0, 40)).toBe(false);
      expect(readFileSync(join(root, "a.txt"), "utf8")).toBe(before);
    }
  });

  it("discards retained results terminally", () => {
    if (!storeMod) return notReady("result store");
    const root = fixture();
    const store = new storeMod.ResultStore();
    const id = store.retain({ diff, writeSet: ["a.txt"], root });
    expect(store.discard(id)).toBe(true);
    expect(store.get(id)).toBeUndefined();
    expect(store.discard(id)).toBe(false);
  });
});
