import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import { runDir } from "../test/cleanup-temp.ts";

// The run owns one temp subtree; the globalSetup teardown removes it.
const tempRoot = runDir();
const home = join(tempRoot, "home");
mkdirSync(home, { recursive: true });

export default defineConfig({
  cacheDir: join(tempRoot, "vite-cache"),
  test: {
    include: ["test/web/**/*.test.tsx"],
    environment: "node",
    maxWorkers: 2,
    globalSetup: join(import.meta.dirname, "../test/cleanup-temp.ts"),
    env: {
      HOME: home,
      USERPROFILE: home,
      TMPDIR: tempRoot,
      TEMP: tempRoot,
      TMP: tempRoot,
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
});
