// Refreshes the content hashes of the files provenance/webui-reuse.json
// already pins under "destinations", in place and byte for byte otherwise.
// Which files are pinned is decided by whoever edits that list: this never
// adds, removes or reorders an entry, and touches nothing else in the file
// (upstream, sources, groups) nor any other provenance or package record.
// `--check` writes nothing and fails when a pin is stale.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVENANCE_FILE = "provenance/webui-reuse.json";
const OPEN = /^ {2}"destinations": \{$/u;
const CLOSE = /^ {2}\},?$/u;
const ENTRY = /^( {4}("(?:[^"\\]|\\.)*"): ")([0-9a-f]{64})(",?)$/u;

/** `text` with the hash of every pinned destination replaced by what
 * `hashOf(path)` returns. A path it returns null for (the file is absent)
 * keeps the hash it has and is reported; whether its entry should go is not
 * decided here. The block has to hold exactly the entries the parsed document
 * has: a shape this does not recognise is refused, never guessed at. */
export function refreshDestinations(text, hashOf) {
  const refuse = (detail) => {
    throw new Error(`${PROVENANCE_FILE}: ${detail}`);
  };
  const pinned = JSON.parse(text).destinations;
  if (pinned === null || typeof pinned !== "object" || Array.isArray(pinned))
    refuse('"destinations" is not an object');
  const lines = text.split("\n");
  const blocks = lines.flatMap((line, at) => (OPEN.test(line) ? [at] : []));
  if (blocks.length !== 1)
    refuse('expected exactly one top-level "destinations" block');
  const seen = new Set(),
    changed = [],
    missing = [];
  let at = blocks[0] + 1;
  for (; at < lines.length && !CLOSE.test(lines[at]); at++) {
    const entry = ENTRY.exec(lines[at]);
    if (!entry) refuse(`line ${at + 1} is not a "path": "sha256" entry`);
    const path = JSON.parse(entry[2]);
    if (seen.has(path) || pinned[path] !== entry[3])
      refuse(`line ${at + 1} is not the entry the document has for ${path}`);
    seen.add(path);
    const hash = hashOf(path);
    if (hash === null) missing.push(path);
    else if (hash !== entry[3]) {
      lines[at] = `${entry[1]}${hash}${entry[4]}`;
      changed.push(path);
    }
  }
  if (at === lines.length || seen.size !== Object.keys(pinned).length)
    refuse("the destinations block does not hold exactly its entries");
  return { text: lines.join("\n"), total: seen.size, changed, missing };
}

/** The SHA-256 of a repository file's bytes; null when there is no such file. */
export function repositoryHash(root, path) {
  const file = resolve(root, path);
  if (isAbsolute(path) || !file.startsWith(`${resolve(root)}${sep}`))
    throw new Error(
      `${PROVENANCE_FILE}: ${path} is not a path inside the repository`,
    );
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check"))
    throw new Error("usage: node scripts/sync-provenance.mjs [--check]");
  const root = resolve(import.meta.dirname, "..");
  const target = join(root, PROVENANCE_FILE);
  const before = readFileSync(target, "utf8");
  const result = refreshDestinations(before, (path) =>
    repositoryHash(root, path),
  );
  for (const path of result.missing)
    console.error(
      `sync-provenance: ${path} is pinned but does not exist; its entry was left as it is`,
    );
  if (args.includes("--check")) {
    for (const path of result.changed)
      console.error(`sync-provenance: the pin of ${path} is stale`);
    if (result.changed.length || result.missing.length) process.exit(1);
    console.log(`sync-provenance: all ${result.total} destination pins match`);
  } else {
    if (result.text !== before) writeFileSync(target, result.text);
    console.log(
      `sync-provenance: refreshed ${result.changed.length} of ${result.total} destination pins`,
    );
  }
}
