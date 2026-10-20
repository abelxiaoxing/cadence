import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const home = mkdtempSync(join(tmpdir(), "cadence-browser-runner-"));
export default defineConfig({
  cacheDir: join(home, "vite-cache"),
  test: {
    include: ["test/web/*.e2e.mjs"],
    environment: "node",
    fileParallelism: false,
    env: { HOME: home, USERPROFILE: home },
  },
});
