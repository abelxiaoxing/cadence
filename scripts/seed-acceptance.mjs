// References and tests are not release certification.
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const result = spawnSync(
  "bun",
  [
    "run",
    "test",
    "--",
    "test/lightweight-store-controller.test.ts",
    "test/history-shell.test.ts",
    "test/lightweight-process-diff.test.ts",
    "test/lightweight-sdk.test.ts",
    "test/distribution.test.mjs",
  ],
  { cwd: root, stdio: "inherit", shell: false },
);
process.exitCode = result.status ?? 1;
