import { mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";
import { runDir } from "./test/cleanup-temp.ts";

// The run owns one temp subtree: fixtures, the isolated HOME and any strays
// live under it, and the globalSetup teardown removes it. The caller's
// verification temp root is never touched.
const tempRoot = runDir();
const isolatedHome = path.join(tempRoot, "home");
mkdirSync(isolatedHome, { recursive: true });

/** Options every unit run shares, including `test/service.config.ts`. */
export const shared = {
  globalSetup: path.join(import.meta.dirname, "test/cleanup-temp.ts"),
  maxWorkers: Math.min(4, availableParallelism()),
  execArgv: [
    `--import=${pathToFileURL(path.join(import.meta.dirname, "test/no-fsync.mjs")).href}`,
  ],
  env: {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    TMPDIR: tempRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
  },
  tags: [
    {
      name: "slow",
      description:
        "Takes about 0.4 s or more, usually by starting real owners, SDK workers, CLIs or crash children. Excluded from verification and default test commands; select explicitly for diagnosis only.",
    },
  ],
};

export default defineConfig({
  test: {
    ...shared,
    include: ["test/**/*.test.{ts,mjs}"],
  },
});
