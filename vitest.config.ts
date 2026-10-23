import { mkdirSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const isolatedHome = path.join(tmpdir(), `cadence-vitest-home-${process.pid}`);
mkdirSync(isolatedHome, { recursive: true });

/** Options every unit run shares, including `test/service.config.ts`. */
export const shared = {
  maxWorkers: Math.min(4, availableParallelism()),
  env: {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
  },
};
/** Files that exceed their own waits when they share the CPU with other files
 * (measured on Windows runners). They run one at a time after the parallel
 * group: real PTY/SDK process flows first, then >8MiB cold history scans. CI
 * runs each group on its own runner. */
export const serialProcessFiles = [
  "test/terminal-integration.test.mjs",
  "test/service-scheduler.test.ts",
  "test/service-accepting-host.test.ts",
  "test/service-history.test.ts",
  "test/service-accepted-work.test.ts",
  "test/service-owner.test.ts",
];
export const serialScanFiles = [
  "test/service-history-list-entity.test.ts",
  "test/service-history-validator.test.ts",
  "test/service-history-search-export.test.ts",
  "test/service-history-lookahead.test.ts",
  "test/service-history-read-completion.test.ts",
];

export default defineConfig({
  test: {
    ...shared,
    projects: [
      {
        extends: true,
        test: {
          name: "parallel",
          include: ["test/**/*.test.{ts,mjs}"],
          exclude: [
            ...configDefaults.exclude,
            ...serialProcessFiles,
            ...serialScanFiles,
          ],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "serial-process",
          include: serialProcessFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "serial-scan",
          include: serialScanFiles,
          fileParallelism: false,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
