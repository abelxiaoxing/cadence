#!/usr/bin/env node
// P-001 approved parent-mechanical extraction: copy the approved package
// payload from the reference package to the standalone root without
// dereferencing symlinks. The payload allowlist excludes node_modules,
// AGENTS.md, and any other non-approved source entry.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const RELOCATED = "/home/abelxiaoxing/work/subagent/pi-packages";
const REF_SOURCE = join(ROOT, "pi-packages", "packages", "pi-abel-workflow");
const REF_RELOCATED = join(RELOCATED, "packages", "pi-abel-workflow");
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

function entries(dir) {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .sort();
}

function walk(dir, base = SOURCE_PKG) {
  const top = lstatSync(dir);
  assert(!top.isSymbolicLink(), `refuses to dereference symlink: ${dir}`);
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
  for (const path of entries(dir)) {
    const st = lstatSync(path);
    assert(!st.isSymbolicLink(), `refuses to dereference symlink: ${path}`);
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyTree(src, dst) {
  const st = lstatSync(src);
  assert(!st.isSymbolicLink(), `refuses to dereference symlink: ${src}`);
  if (st.isDirectory()) {
    mkdirSync(dst, { mode: st.mode & 0o777 });
    for (const name of readdirSync(src))
      copyTree(join(src, name), join(dst, name));
  } else {
    copyFileSync(src, dst);
    chmodSync(dst, st.mode & 0o777);
    utimesSync(dst, st.atime, st.mtime);
  }
}

function verifyPayload() {
  for (const entry of PAYLOAD) {
    const src = join(SOURCE_PKG, entry);
    const dst = join(ROOT, entry);
    assert(existsSync(src), `source payload entry missing: ${entry}`);
    assert(existsSync(dst), `root payload entry missing: ${entry}`);
    const srcFiles = walk(src, src).filter((f) => !f.isDir);
    const dstFiles = walk(dst, dst).filter((f) => !f.isDir);
    const byRel = (list) => new Map(list.map((f) => [f.rel, f]));
    const srcMap = byRel(srcFiles);
    const dstMap = byRel(dstFiles);
    assert.deepEqual(
      [...dstMap.keys()].sort(),
      [...srcMap.keys()].sort(),
      `file set mismatch under ${entry}`,
    );
    for (const [rel, sf] of srcMap) {
      const df = dstMap.get(rel);
      assert.equal(df.mode, sf.mode, `mode mismatch: ${rel}`);
      assert.equal(
        sha256(join(dst, rel)),
        sha256(join(src, rel)),
        `hash mismatch: ${rel}`,
      );
    }
  }
  // copied payload must not contain symlinks
  for (const entry of PAYLOAD) walk(join(ROOT, entry), join(ROOT, entry));
  assert(
    !existsSync(join(ROOT, "node_modules")),
    "root must not contain node_modules",
  );
}

const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  assert(existsSync(SOURCE_PKG), `source package missing: ${SOURCE_PKG}`);
  assert(
    existsSync(join(SOURCE_PKG, "package.json")),
    "source package.json missing",
  );
  for (const entry of PAYLOAD) {
    const dst = join(ROOT, entry);
    assert(!existsSync(dst), `root payload path already exists: ${entry}`);
  }
  for (const entry of PAYLOAD)
    copyTree(join(SOURCE_PKG, entry), join(ROOT, entry));
}

verifyPayload();
console.log(`extract-package: payload verified at ${ROOT}`);
