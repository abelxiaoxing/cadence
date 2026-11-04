import { mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";

const isolatedHome = path.join(tmpdir(), `cadence-vitest-home-${process.pid}`);
mkdirSync(isolatedHome, { recursive: true });

/** Options every unit run shares, including `test/service.config.ts`. */
export const shared = {
  maxWorkers: Math.min(4, availableParallelism()),
  execArgv: [
    `--import=${pathToFileURL(path.join(import.meta.dirname, "test/no-fsync.mjs")).href}`,
  ],
  env: {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
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
