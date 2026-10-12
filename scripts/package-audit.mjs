// Strict real archive audit shared by development pack gates, never shipped.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const refuse = (code) => {
  throw new Error(`package-audit-${code}`);
};
function safe(name) {
  return (
    name.startsWith("package/") &&
    !name.includes("\\") &&
    [...name].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) &&
    name.split("/").every((s) => s && s !== "." && s !== "..")
  );
}
export function archiveBodies(archive) {
  const raw = gunzipSync(readFileSync(archive), {
    maxOutputLength: 128 * 1024 * 1024,
  });
  const bodies = new Map(),
    names = new Set();
  let offset = 0,
    terminated = false;
  const field = (b) =>
    b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString("utf8");
  const octal = (b) => {
    const s = b.toString("ascii").replace(/\0/gu, "").trim();
    if (!/^[0-7]+$/u.test(s)) refuse("numeric-header");
    return Number.parseInt(s, 8);
  };
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((v) => v === 0)) {
      if (
        offset + 512 > raw.length ||
        !raw.subarray(offset).every((v) => v === 0)
      )
        refuse("trailer");
      terminated = true;
      break;
    }
    const sum = header.reduce(
      (n, b, i) => n + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    if (octal(header.subarray(148, 156)) !== sum) refuse("checksum");
    const prefix = field(header.subarray(345, 500)),
      short = field(header.subarray(0, 100));
    let name = prefix ? `${prefix}/${short}` : short;
    const type = header[156],
      size = octal(header.subarray(124, 136));
    if (type === 53) name = name.replace(/\/$/u, "");
    if (
      (!(type === 53 && name === "package") && !safe(name)) ||
      names.has(name)
    )
      refuse("name");
    names.add(name);
    if (![0, 48, 53].includes(type)) refuse("nonregular");
    if (offset + size > raw.length || (type === 53 && size !== 0))
      refuse("size");
    if (type !== 53) bodies.set(name, raw.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  if (!terminated || bodies.size === 0) refuse("trailer");
  return bodies;
}
export function auditPackage(
  archive,
  sourceRoot,
  expected,
  provenanceRoot = sourceRoot,
) {
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    new Set(expected).size !== expected.length ||
    !expected.every(safe)
  )
    refuse("manifest");
  const bodies = archiveBodies(archive);
  if (
    JSON.stringify([...bodies.keys()].sort()) !==
    JSON.stringify([...expected].sort())
  )
    refuse("member-drift");
  for (const [name, bytes] of bodies) {
    let file = sourceRoot;
    for (const part of name.slice(8).split("/")) {
      file = path.join(file, part);
      if (lstatSync(file).isSymbolicLink()) refuse("source-link");
    }
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || !bytes.equals(readFileSync(file)))
      refuse("body-drift");
  }
  const provenance = readFileSync(
    path.join(provenanceRoot, "provenance/adapted-modules.yaml"),
    "utf8",
  );
  for (const role of [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ]) {
    const binding = provenance.match(
      new RegExp(
        `path: agents/${role}\\.md[\\s\\S]{0,160}?role: ${role}[\\s\\S]{0,160}?sha256: ([0-9a-f]{64})`,
        "u",
      ),
    );
    if (
      binding?.[1] !==
      sha256(bodies.get(`package/agents/${role}.md`) ?? Buffer.alloc(0))
    )
      refuse("agent-pin");
  }
  return {
    members: [...bodies.keys()].sort(),
    archiveSha256: sha256(readFileSync(archive)),
    bodyHashes: Object.fromEntries(
      [...bodies].map(([name, b]) => [name, sha256(b)]),
    ),
  };
}
