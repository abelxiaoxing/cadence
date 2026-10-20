// Strict real archive audit shared by development pack gates, never shipped.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
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
    !/[\p{Cc}\p{Cf}\p{Cs}\uFFFD]/u.test(name) &&
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
  // Reject links in the supplied root AND every ancestor before any body read.
  let ancestor = path.resolve(sourceRoot);
  for (;;) {
    const stat = lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refuse("source-link");
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
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
  if (path.resolve(sourceRoot) !== path.resolve(provenanceRoot)) {
    const allowed = new Set(expected.map((name) => name.slice(8)));
    const directories = new Set();
    for (const name of allowed) {
      const parts = name.split("/");
      for (let i = 1; i < parts.length; i++)
        directories.add(parts.slice(0, i).join("/"));
    }
    const walk = (directory, prefix = "") => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory() && directories.has(name))
          walk(path.join(directory, entry.name), `${name}/`);
        else if (!entry.isFile() || !allowed.has(name))
          refuse("extracted-extra");
      }
    };
    walk(sourceRoot);
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
  // The independently recorded license/font body policy is not inferred from tar.
  const notices = JSON.parse(
    readFileSync(
      path.join(provenanceRoot, "provenance/bundled-notices.json"),
      "utf8",
    ),
  );
  if (
    sha256(bodies.get(`package/${notices.noticeFile}`) ?? Buffer.alloc(0)) !==
    notices.noticeSha256
  )
    refuse("notice-drift");
  for (const font of notices.fonts) {
    if (
      sha256(
        bodies.get(`package/web/dist/${font.asset}`) ?? Buffer.alloc(0),
      ) !== font.sha256
    )
      refuse("font-drift");
  }
  return {
    members: [...bodies.keys()].sort(),
    archiveSha256: sha256(readFileSync(archive)),
    bodyHashes: Object.fromEntries(
      [...bodies].map(([name, b]) => [name, sha256(b)]),
    ),
  };
}
