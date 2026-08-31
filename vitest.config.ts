import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

const isolatedHome = path.join(tmpdir(), `cadence-vitest-home-${process.pid}`);
mkdirSync(isolatedHome, { recursive: true });

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,mjs}"],
    env: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
    },
  },
});
