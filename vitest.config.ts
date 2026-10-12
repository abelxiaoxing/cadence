import { mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const isolatedHome = path.join(tmpdir(), `cadence-vitest-home-${process.pid}`);
mkdirSync(isolatedHome, { recursive: true });

export default defineConfig({
  test: {
    maxWorkers: Math.min(4, availableParallelism()),
    include: ["test/**/*.test.{ts,mjs}"],
    env: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
  },
});
