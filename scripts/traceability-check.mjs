// Development-only explicit map validation. Never discover tasks or run commands.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const root = realpathSync(path.resolve(import.meta.dirname, ".."));
const statuses = new Set([
  "planned",
  "passed",
  "failed",
  "blocked",
  "unavailable",
]);
const fail = (code) => {
  throw new Error(`traceability-${code}`);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (s, max = 1024) =>
  typeof s === "string" &&
  s.length > 0 &&
  Buffer.byteLength(s) <= max &&
  [...s].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const id = (s) => text(s, 128) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(s);
const digest = (s) => typeof s === "string" && /^[a-f0-9]{64}$/u.test(s);
function object(value, keys, required = keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    fail("shape");
}
function array(value, min = 1, max = 256) {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    fail("array");
}
function unique(values) {
  if (new Set(values).size !== values.length) fail("duplicate");
}
function owned(relative, maximum = 1024 * 1024) {
  if (
    !text(relative, 512) ||
    relative.includes("\\") ||
    path.isAbsolute(relative) ||
    relative.split("/").some((s) => !s || s === "." || s === "..")
  )
    fail("path");
  let current = root;
  try {
    for (const component of relative.split("/")) {
      current = path.join(current, component);
      if (lstatSync(current).isSymbolicLink()) fail("symlink");
    }
    const stat = lstatSync(current);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > maximum ||
      !realpathSync(current).startsWith(`${root}${path.sep}`)
    )
      fail("path");
    return readFileSync(current);
  } catch (error) {
    if (error?.message?.startsWith("traceability-")) throw error;
    fail("path");
  }
}
function status(value) {
  if (!statuses.has(value)) fail("status");
}
function checkEvidence(e, verification) {
  object(e, [
    "command",
    "exitCode",
    "outcome",
    "platform",
    "runtime",
    "lane",
    "inputs",
    "locator",
    "sha256",
  ]);
  array(e.command, 1, 64);
  if (
    !e.command.every((s) => text(s, 4096)) ||
    e.exitCode !== 0 ||
    e.outcome !== "passed" ||
    !id(e.platform) ||
    !id(e.runtime) ||
    !id(e.lane) ||
    !digest(e.sha256)
  )
    fail("evidence");
  array(e.inputs, 1, 1024);
  const inputs = new Set();
  for (const input of e.inputs) {
    object(input, ["path", "sha256"]);
    if (!digest(input.sha256) || inputs.has(input.path)) fail("evidence-input");
    inputs.add(input.path);
    if (hash(owned(input.path, 32 * 1024 * 1024)) !== input.sha256)
      fail("stale");
  }
  if (
    inputs.size !== verification.inputPaths.length ||
    verification.inputPaths.some((p) => !inputs.has(p))
  )
    fail("partial-evidence");
  // The external closed log is identity-bound, but never interpreted or executed.
  if (!text(e.locator, 4096) || !path.isAbsolute(e.locator)) fail("locator");
  try {
    const real = realpathSync(e.locator);
    if (
      real === root ||
      real.startsWith(`${root}${path.sep}`) ||
      lstatSync(e.locator).isSymbolicLink()
    )
      fail("locator");
    const stat = lstatSync(real);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 16 * 1024 * 1024 ||
      hash(readFileSync(real)) !== e.sha256
    )
      fail("evidence-log");
  } catch (error) {
    if (error?.message?.startsWith("traceability-")) throw error;
    fail("evidence-log");
  }
}
function validate(map, requirePassed) {
  object(map, ["formatVersion", "prd", "criteria", "releaseLanes"]);
  if (map.formatVersion !== 1) fail("version");
  const prd = owned(map.prd).toString("utf8");
  const expected = [
    ...prd.matchAll(/^\s*- \[[ x]\] \*\*([A-Z0-9]+-AC[0-9]+)\*\*/gmu),
  ].map((m) => m[1]);
  array(expected);
  unique(expected);
  array(map.criteria);
  unique(map.criteria.map((c) => c.id));
  if (!map.criteria.some((c) => c.required === true)) fail("required-coverage");
  if (
    expected.length !== map.criteria.length ||
    expected.some((c) => !map.criteria.some((v) => v.id === c))
  )
    fail("criterion-coverage");
  const checks = new Map();
  for (const c of map.criteria) {
    object(c, ["id", "parentCriteria", "required", "status", "verification"]);
    if (!id(c.id) || typeof c.required !== "boolean") fail("criterion");
    array(c.parentCriteria);
    unique(c.parentCriteria);
    if (!c.parentCriteria.every(id)) fail("criterion");
    status(c.status);
    array(c.verification);
    for (const v of c.verification) {
      object(v, [
        "id",
        "path",
        "assertions",
        "inputPaths",
        "required",
        "status",
        "evidence",
      ]);
      if (!id(v.id) || checks.has(v.id) || typeof v.required !== "boolean")
        fail("duplicate-check");
      const source = owned(v.path).toString("utf8");
      array(v.assertions);
      unique(v.assertions);
      if (!v.assertions.every((a) => text(a, 2048) && source.includes(a)))
        fail("assertion");
      array(v.inputPaths, 3, 1024);
      unique(v.inputPaths);
      v.inputPaths.forEach((p) => {
        owned(p, 32 * 1024 * 1024);
      });
      if (
        ![v.path, "package.json", map.prd].every((p) =>
          v.inputPaths.includes(p),
        )
      )
        fail("partial-inputs");
      status(v.status);
      array(v.evidence, 0, 64);
      if (v.status === "passed" && v.evidence.length === 0)
        fail("missing-evidence");
      if (v.status !== "passed" && v.evidence.length !== 0)
        fail("nonpassing-evidence");
      v.evidence.forEach((e) => {
        checkEvidence(e, v);
      });
      checks.set(v.id, v);
    }
    if (c.required && !c.verification.some((v) => v.required))
      fail("required-coverage");
    if (
      c.status === "passed" &&
      c.verification.some((v) => v.required && v.status !== "passed")
    )
      fail("partial-criterion");
    if (
      requirePassed &&
      c.required &&
      (c.status !== "passed" ||
        c.verification.some((v) => v.required && v.status !== "passed"))
    )
      fail("required-not-passed");
  }
  array(map.releaseLanes);
  unique(map.releaseLanes.map((l) => l.id));
  if (!map.releaseLanes.some((l) => l.required === true))
    fail("required-lane-coverage");
  for (const lane of map.releaseLanes) {
    object(lane, ["id", "required", "status", "checks", "platform"]);
    if (
      !id(lane.id) ||
      typeof lane.required !== "boolean" ||
      !id(lane.platform)
    )
      fail("lane");
    status(lane.status);
    array(lane.checks);
    unique(lane.checks);
    for (const check of lane.checks) {
      const v = checks.get(check);
      if (!v) fail("dangling-check");
      if (
        lane.status === "passed" &&
        (v.status !== "passed" ||
          !v.evidence.some(
            (e) => e.lane === lane.id && e.platform === lane.platform,
          ))
      )
        fail("inapplicable-evidence");
    }
    if (requirePassed && lane.required && lane.status !== "passed")
      fail("required-lane-not-passed");
  }
  return checks.size;
}
try {
  const args = process.argv.slice(2);
  if (
    args.length < 2 ||
    args[0] !== "--map" ||
    ![2, 3].includes(args.length) ||
    (args.length === 3 && args[2] !== "--require-passed")
  )
    fail("usage");
  const supplied = path
    .relative(root, path.resolve(args[1]))
    .split(path.sep)
    .join("/");
  const map = JSON.parse(owned(supplied).toString("utf8"));
  const count = validate(map, args.length === 3);
  console.log(
    `traceability-check: ${map.criteria.length} criteria / ${count} checks reference-valid${args.length === 3 ? "; required evidence passed" : "; not execution or release evidence"}`,
  );
} catch (error) {
  console.error(
    error?.message?.startsWith("traceability-")
      ? error.message
      : "traceability-invalid-json",
  );
  process.exitCode = 1;
}
