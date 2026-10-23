import { createHash } from "node:crypto";
import { lstatSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StaticAsset } from "./service/http.ts";
import { readBounded, safeDirectory } from "./task-store.ts";
import { parseWireJson } from "./worker-public.mjs";

export const ASSET_MEMBER_BYTES = 16 * 1024 * 1024;
export const ASSET_TOTAL_BYTES = 64 * 1024 * 1024;
const fixed = new Set([
  "index.html",
  "assets/cadence.js",
  "assets/cadence.css",
  "assets/react.js",
  "assets/rolldown-runtime.js",
  "assets/markdown.js",
  "assets/timeline-client.js",
  "assets/vis-timeline.js",
  "assets/vis-timeline.css",
]);
const font =
  /^assets\/KaTeX_(?:AMS-Regular|Caligraphic-(?:Bold|Regular)|Fraktur-(?:Bold|Regular)|Main-(?:Bold|BoldItalic|Italic|Regular)|Math-(?:BoldItalic|Italic)|SansSerif-(?:Bold|Italic|Regular)|Script-Regular|Size[1-4]-Regular|Typewriter-Regular)\.(?:woff2|woff|ttf)$/;
export function assetMime(name: string): StaticAsset["contentType"] {
  if (!fixed.has(name) && !font.test(name))
    throw new Error("asset-name-refused");
  if (name === "index.html") return "text/html; charset=utf-8";
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".woff2")) return "font/woff2";
  if (name.endsWith(".woff")) return "font/woff";
  return "font/ttf";
}
export interface AssetManifest {
  schema: "cadence-web-assets/1";
  sourceHash: string;
  contractHash: string;
  buildId: string;
  assets: {
    name: string;
    bytes: number;
    sha256: string;
    references: string[];
  }[];
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("asset-manifest-refused");
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(v).sort().join() !== expected.sort().join())
    throw new Error("asset-manifest-refused");
}
function hash(v: unknown): string {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    throw new Error("asset-manifest-refused");
  return v;
}
export function decodeAssetManifest(input: unknown): AssetManifest {
  const o = record(input);
  keys(o, ["schema", "sourceHash", "contractHash", "buildId", "assets"]);
  if (
    o.schema !== "cadence-web-assets/1" ||
    !Array.isArray(o.assets) ||
    o.assets.length > 128
  )
    throw new Error("asset-manifest-refused");
  let total = 0;
  const names = new Set<string>();
  const assets = o.assets.map((value) => {
    const a = record(value);
    keys(a, ["name", "bytes", "sha256", "references"]);
    if (typeof a.name !== "string" || names.has(a.name))
      throw new Error("asset-name-refused");
    assetMime(a.name);
    names.add(a.name);
    if (
      typeof a.bytes !== "number" ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes <= 0 ||
      a.bytes > ASSET_MEMBER_BYTES
    )
      throw new Error("asset-size-refused");
    total += a.bytes;
    if (
      total > ASSET_TOTAL_BYTES ||
      !Array.isArray(a.references) ||
      a.references.length > 128 ||
      !a.references.every((r): r is string => typeof r === "string")
    )
      throw new Error("asset-closure-refused");
    return {
      name: a.name,
      bytes: a.bytes,
      sha256: hash(a.sha256),
      references: a.references,
    };
  });
  if (
    [...fixed].some((name) => !names.has(name)) ||
    // The reviewed font policy contains 20 faces in all three actual formats.
    // A self-consistent but partial manifest is not an owned published build.
    assets.filter((a) => font.test(a.name)).length !== 60 ||
    assets.some(
      (a) =>
        new Set(a.references).size !== a.references.length ||
        a.references.some((r) => !names.has(r)),
    )
  )
    throw new Error("asset-closure-refused");
  const sourceHash = hash(o.sourceHash),
    contractHash = hash(o.contractHash),
    buildId = hash(o.buildId);
  if (
    buildId !==
    createHash("sha256")
      .update(JSON.stringify({ sourceHash, contractHash }))
      .digest("hex")
  )
    throw new Error("asset-identity-refused");
  return { schema: o.schema, sourceHash, contractHash, buildId, assets };
}
function incarnation(st: Stats): string {
  return [
    st.dev,
    st.ino,
    st.mode,
    st.nlink,
    st.size,
    st.mtimeMs,
    st.ctimeMs,
  ].join(":");
}
/** Package-relative, finite hash-bound files; never a URL-to-filesystem route. */
export function loadWebAssets(
  directory = fileURLToPath(new URL("../web/dist/", import.meta.url)),
): { manifest: AssetManifest; assets: StaticAsset[]; identity: string } {
  if (!safeDirectory(directory) || !safeDirectory(join(directory, "assets")))
    throw new Error("assets-unavailable");
  const observed = new Map<string, string>();
  for (const path of [directory, join(directory, "assets")])
    observed.set(path, incarnation(lstatSync(path)));
  const read = (path: string, limit: number) => {
    const before = incarnation(lstatSync(path));
    const body = readBounded(path, limit, true);
    if (!body || before !== incarnation(lstatSync(path)))
      throw new Error("asset-read-changed");
    observed.set(path, before);
    return body;
  };
  const bytes = read(join(directory, "manifest.json"), 128 * 1024);
  const manifest = decodeAssetManifest(
    parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      128 * 1024,
    ),
  );
  const members = [
    ...readdirSync(directory).filter((n) => n !== "assets"),
    ...readdirSync(join(directory, "assets")).map((n) => `assets/${n}`),
  ].sort();
  if (
    JSON.stringify(members) !==
    JSON.stringify(
      ["manifest.json", ...manifest.assets.map((a) => a.name)].sort(),
    )
  )
    throw new Error("asset-members-refused");
  const assets: StaticAsset[] = manifest.assets.map((a) => {
    const body = read(join(directory, a.name), a.bytes);
    if (
      !body ||
      body.length !== a.bytes ||
      createHash("sha256").update(body).digest("hex") !== a.sha256
    )
      throw new Error("asset-body-refused");
    return {
      path: a.name === "index.html" ? "/app" : `/${a.name}`,
      contentType: assetMime(a.name),
      bytes: body,
    };
  });
  // Detect replacement/ordinary in-place edits during closure reads, including
  // manifest and directory changes. Not hostile same-user atomic filesystem CAS.
  if (
    !safeDirectory(directory) ||
    [...observed].some(
      ([path, identity]) => incarnation(lstatSync(path)) !== identity,
    )
  )
    throw new Error("asset-read-changed");
  return {
    manifest,
    assets,
    identity: createHash("sha256").update(bytes).digest("hex"),
  };
}
