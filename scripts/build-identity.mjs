/** Build-only input hashing. Importing this module never builds or writes files. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function inputFiles(root, at) {
  return readdirSync(at, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      if (entry.isSymbolicLink()) throw new Error("build-source-link");
      const path = join(at, entry.name);
      if (entry.isDirectory()) return inputFiles(root, path);
      if (!entry.isFile()) throw new Error("build-source-special");
      return [
        [
          relative(root, path).replaceAll("\\", "/"),
          digest(readFileSync(path)),
        ],
      ];
    });
}
const tuples = (root, names) =>
  names.sort().map((name) => [name, digest(readFileSync(join(root, name)))]);
export function contractIdentity(root) {
  return digest(
    JSON.stringify(
      tuples(root, [
        "src/worker-public.mjs",
        "src/worker-public.d.mts",
        "src/service-contract.ts",
        "src/service-client.ts",
        "src/service-http-client.ts",
        "src/service-wire.ts",
        ...inputFiles(root, join(root, "src/service/contracts")).map(
          ([name]) => name,
        ),
      ]),
    ),
  );
}
export function browserIdentity(root) {
  const sourceHash = digest(
    JSON.stringify([
      ...inputFiles(root, join(root, "web/src")),
      ...tuples(root, [
        "web/index.html",
        "web/vite.config.ts",
        "web/build-vis-style.ts",
        "scripts/build-web.mjs",
        "scripts/build-identity.mjs",
        "scripts/audit-notices.mjs",
        "scripts/web-output.ts",
        "provenance/bundled-notices.json",
        "licenses/bundled-web.txt",
        "src/service-assets.ts",
        "package.json",
        "bun.lock",
      ]),
    ]),
  );
  const contractHash = contractIdentity(root);
  return {
    sourceHash,
    contractHash,
    buildId: digest(JSON.stringify({ sourceHash, contractHash })),
  };
}
