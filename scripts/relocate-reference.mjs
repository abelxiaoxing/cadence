#!/usr/bin/env node
// P-001 approved parent-mechanical relocation: move the complete reference
// repository to /home/abelxiaoxing/work/subagent/pi-packages with one
// same-device, no-copy, collision-failing rename. No copy/delete fallback and
// no automatic reverse move are performed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SOURCE = join(ROOT, "pi-packages");
const DEST = "/home/abelxiaoxing/work/subagent/pi-packages";

const BASELINE = {
  head: "a1ee2255b81cb540f88d233112e868ca91fe7846",
  branch: "main",
  inode: 1942151,
};

function git(args) {
  const r = spawnSync("git", ["-C", DEST, ...args], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function verify() {
  assert(!existsSync(SOURCE), `old path must be absent: ${SOURCE}`);
  assert(existsSync(DEST), `destination missing: ${DEST}`);
  assert.equal(
    statSync(DEST).ino,
    BASELINE.inode,
    "destination inode does not match source",
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
  console.log(`relocate-reference: identity verified at ${DEST}`);
}

const checkOnly = process.argv.includes("--check");

if (checkOnly) {
  verify();
} else {
  assert(
    existsSync(join(SOURCE, ".git")),
    `source repository missing: ${SOURCE}`,
  );
  assert(!existsSync(DEST), `destination must be absent: ${DEST}`);
  const dev = statSync(ROOT).dev;
  assert.equal(
    statSync(dirname(DEST)).dev,
    dev,
    "source and destination parent must be on one device",
  );
  assert.equal(
    statSync(SOURCE).ino,
    BASELINE.inode,
    "source inode does not match baseline",
  );
  const r = spawnSync(
    "mv",
    ["--no-copy", "--update=none-fail", "-T", SOURCE, DEST],
    { stdio: "inherit", shell: false },
  );
  assert.equal(
    r.status,
    0,
    `rename failed: ${r.error?.message ?? `exit ${r.status}`}`,
  );
  verify();
}
