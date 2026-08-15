// P-001 bootstrap layout test: verifies the extracted standalone payload at
// the root matches the reference package byte-for-byte and that the complete
// reference repository was relocated intact with an identical Git identity.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEST = "/home/abelxiaoxing/work/subagent/pi-packages";
const REF_SOURCE = join(ROOT, "pi-packages", "packages", "pi-abel-workflow");
const REF_RELOCATED = join(DEST, "packages", "pi-abel-workflow");
const SOURCE_PKG = existsSync(REF_SOURCE) ? REF_SOURCE : REF_RELOCATED;

const PAYLOAD = [
  "package.json",
  "README.md",
  "LICENSE",
  "config",
  "prompts",
  "skills",
  "test",
];

// Baseline recorded before the migration from the source repository.
const BASELINE = {
  inode: 1942151,
  head: "a1ee2255b81cb540f88d233112e868ca91fe7846",
  branch: "main",
  // Content-verified status: every baseline-modified file is an unstaged
  // worktree modification (index == HEAD, worktree differs from index).
  modified: [
    ".fallowrc.json",
    ".gitignore",
    ".pi/settings.json",
    ".release-please-manifest.json",
    ".rumdl.toml",
    "AGENTS.md",
    "README.md",
    "bun.lock",
    "release-please-config.json",
  ],
  untracked: [
    "packages/pi-abel-workflow/AGENTS.md",
    "packages/pi-abel-workflow/LICENSE",
    "packages/pi-abel-workflow/README.md",
    "packages/pi-abel-workflow/config/.env.example",
    "packages/pi-abel-workflow/package.json",
    "packages/pi-abel-workflow/prompts/abel-design.md",
    "packages/pi-abel-workflow/prompts/abel-diagnose.md",
    "packages/pi-abel-workflow/prompts/abel-implement.md",
    "packages/pi-abel-workflow/prompts/abel-init.md",
    "packages/pi-abel-workflow/skills/_shared/http-client.mjs",
    "packages/pi-abel-workflow/skills/_shared/load-config.mjs",
    "packages/pi-abel-workflow/skills/abel-workflow/SKILL.md",
    "packages/pi-abel-workflow/skills/context7-auto-research/SKILL.md",
    "packages/pi-abel-workflow/skills/context7-auto-research/context7.mjs",
    "packages/pi-abel-workflow/skills/git-commit/SKILL.md",
    "packages/pi-abel-workflow/skills/grok-search/SKILL.md",
    "packages/pi-abel-workflow/skills/grok-search/grok-search.mjs",
    "packages/pi-abel-workflow/test/config-context7.test.mjs",
    "packages/pi-abel-workflow/test/distribution.test.mjs",
    "packages/pi-abel-workflow/test/git-commit.test.mjs",
    "packages/pi-abel-workflow/test/grok-search.test.mjs",
    "packages/pi-abel-workflow/test/package-contract.test.mjs",
    "packages/pi-abel-workflow/test/prompts.test.mjs",
    "packages/pi-abel-workflow/test/stage-contracts.test.mjs",
    "packages/pi-abel-workflow/test/workflow-skill.test.mjs",
  ],
  agents: {
    "AGENTS.md":
      "fe107c8f1e7efd01c19f671594c8ccfd6d2bbede75ecd6c6be983055837d1e22",
    "packages/pi-abel-workflow/AGENTS.md":
      "89285354fdc1df0efa4da7e9c63cbf3b75620414d9eab7df4df49e345bec7cbb",
    "packages/pi-autoformat/AGENTS.md":
      "175780429e6698d9b7942a56307b87e15e43e6950dfff654bbd6357006a0768f",
    "packages/pi-colgrep/AGENTS.md":
      "03c55c424a1a8d265d167edf594aa500d00460d8c6822374cf68cba44e6b8ff3",
    "packages/pi-github-tools/AGENTS.md":
      "142d75b6820b85cc4fd06c258ee214ba8f23c69d6b8e51741ec4cc4e0774bf1e",
    "packages/pi-nocd/AGENTS.md":
      "888464eb87fdb2711f8e3c644423d0dc0b9c39bad9bcc8f8f5f5fb9487ff667f",
    "packages/pi-permission-model-judge/AGENTS.md":
      "e4e72e113651ad254d640013b9dc674afa6ce07a2ce32a418d727c7f3e879a55",
    "packages/pi-permission-system/AGENTS.md":
      "b1e3bf6d675cac839e47db5bbe4c79cd27781ebd8964bcca7b936ef6426bb6c2",
    "packages/pi-session-tools/AGENTS.md":
      "ea40bd1c1b98722532b7d879b452b1fe90c7d55a4398aecc3681b38d4ca68d7c",
    "packages/pi-subagents/AGENTS.md":
      "9306f0c9945d36be43ccc198b07ec94d8c8668d07f7556a1a5078d0e11f67784",
    "packages/pi-subagents-worktrees/AGENTS.md":
      "66bd02e0e5e11b9c2506bbaa1642c99cc40c732a8171a30340c81928e3ae7669",
  },
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir, base = SOURCE_PKG) {
  const top = lstatSync(dir);
  assert(!top.isSymbolicLink(), `unexpected symlink: ${dir}`);
  if (!top.isDirectory()) {
    return [
      {
        path: dir,
        rel: relative(base, dir),
        isDir: false,
        mode: top.mode & 0o777,
      },
    ];
  }
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = lstatSync(path);
    assert(!st.isSymbolicLink(), `unexpected symlink: ${path}`);
    out.push({
      path,
      rel: relative(base, path),
      isDir: st.isDirectory(),
      mode: st.mode & 0o777,
    });
    if (st.isDirectory()) out.push(...walk(path, base));
  }
  return out;
}

function git(args, cwd = DEST) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function gitStatus(args, cwd = DEST) {
  try {
    return {
      code:
        execFileSync("git", ["-C", cwd, ...args], {
          stdio: "pipe",
          shell: false,
        }).status ?? 0,
      stdout: "",
    };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout?.toString() ?? "" };
  }
}

test("standalone payload at root matches the reference package", () => {
  assert(existsSync(SOURCE_PKG), `reference package missing: ${SOURCE_PKG}`);
  for (const entry of PAYLOAD) {
    const src = join(SOURCE_PKG, entry);
    const dst = join(ROOT, entry);
    assert(existsSync(src), `source payload entry missing: ${entry}`);
    assert(existsSync(dst), `root payload entry missing: ${entry}`);
    const srcFiles = walk(src, src).filter((f) => !f.isDir);
    const dstFiles = walk(dst, dst).filter((f) => !f.isDir);
    assert.deepEqual(
      [...dstFiles.map((f) => f.rel)].sort(),
      [...srcFiles.map((f) => f.rel)].sort(),
      `file set mismatch under ${entry}`,
    );
    for (const f of srcFiles) {
      const df = dstFiles.find((d) => d.rel === f.rel);
      assert.equal(df.mode, f.mode, `mode mismatch: ${f.rel}`);
      assert.equal(
        sha256(join(dst, f.rel)),
        sha256(join(src, f.rel)),
        `hash mismatch: ${f.rel}`,
      );
    }
  }
});

test("reference repository is relocated intact", () => {
  assert(
    !existsSync(join(ROOT, "pi-packages")),
    "old pi-packages path must be absent",
  );
  assert(existsSync(DEST), `destination missing: ${DEST}`);
  assert.equal(
    statSync(DEST).ino,
    BASELINE.inode,
    "destination inode mismatch",
  );
  assert.equal(
    git(["rev-parse", "HEAD"]),
    BASELINE.head,
    "destination HEAD mismatch",
  );
  assert.equal(
    git(["branch", "--show-current"]),
    BASELINE.branch,
    "destination branch mismatch",
  );
  const status = git(["status", "--porcelain=v1"])
    .split("\n")
    .filter(Boolean)
    .sort();
  // Content-based status verification (immune to git stat-cache artifacts):
  // every baseline-modified file is modified in the worktree but not staged.
  for (const file of BASELINE.modified) {
    assert.equal(
      gitStatus(["diff", "--quiet", "--", file]).code,
      1,
      `worktree must differ from index: ${file}`,
    );
    assert.equal(
      gitStatus(["diff", "--cached", "--quiet", "--", file]).code,
      0,
      `index must equal HEAD: ${file}`,
    );
    assert.ok(
      status.some((line) => line.includes(file)),
      `status line missing: ${file}`,
    );
  }
  assert.equal(
    status.filter((line) => line.startsWith("??")).length,
    1,
    "exactly one untracked entry",
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    untracked,
    [...BASELINE.untracked].sort(),
    "destination untracked inventory mismatch",
  );
  const worktrees = git(["worktree", "list", "--porcelain"]);
  assert.match(
    worktrees,
    new RegExp(`^worktree ${DEST.replaceAll(" ", "\\ ")}`),
    "worktree path mismatch",
  );
  assert.match(worktrees, /HEAD [0-9a-f]{40}/, "worktree HEAD missing");
  assert.match(
    worktrees,
    /branch refs\/heads\/main/,
    "worktree branch mismatch",
  );
  const matches = worktrees.match(/^HEAD ([0-9a-f]{40})/m);
  assert.equal(matches?.[1], BASELINE.head, "worktree HEAD mismatch");
  for (const [rel, hash] of Object.entries(BASELINE.agents)) {
    assert.equal(sha256(join(DEST, rel)), hash, `AGENTS hash mismatch: ${rel}`);
  }
});
