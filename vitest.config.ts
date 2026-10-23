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
/** Real PTY flows, overlapping SDK children and >8MiB cold scans exceed their
 * own waits when they share the CPU with other files, so they run one at a time
 * after the parallel group. */
export const serialFiles = [
  "test/terminal-integration.test.mjs",
  "test/service-accepting-host.test.ts",
  "test/service-history.test.ts",
  "test/service-history-list-entity.test.ts",
  "test/service-history-lookahead.test.ts",
  "test/service-history-read-completion.test.ts",
  "test/service-history-search-export.test.ts",
  "test/service-history-validator.test.ts",
  "test/service-owner.test.ts",
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
          exclude: [...configDefaults.exclude, ...serialFiles],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "serial",
          include: serialFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
