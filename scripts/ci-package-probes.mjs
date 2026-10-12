// Installed layout is exercised by real pack/distribution tests, not a manager install.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const peer = JSON.parse(
  readFileSync(
    path.join(
      root,
      "node_modules/@earendil-works/pi-coding-agent/package.json",
    ),
    "utf8",
  ),
);
console.log(
  JSON.stringify({
    node: process.version,
    executable: process.execPath,
    pi: peer.version,
    platform: process.platform,
    arch: process.arch,
  }),
);
const result = spawnSync(
  "bun",
  ["run", "test", "--", "test/distribution.test.mjs"],
  { cwd: root, stdio: "inherit", shell: false },
);
process.exitCode = result.status ?? 1;
