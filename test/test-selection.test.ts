import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { serialProcessFiles, serialScanFiles } from "../vitest.config.ts";
import { fastTests } from "./fast.config.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
function discover(config: string): { file: string; projectName?: string }[] {
  // Exercise Vitest's real project inheritance/glob merge, not a duplicate
  // selector that can agree with itself while the runner repeats whole suites.
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      "list",
      "--config",
      config,
      "--filesOnly",
      "--json",
    ],
    { cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.signal).toBeNull();
  const rows: { file: string; projectName?: string }[] = JSON.parse(
    result.stdout,
  );
  return rows.map((row) => ({
    ...row,
    file: relative(root, row.file).replaceAll("\\", "/"),
  }));
}

it("fast and integration discovery partition every root test exactly once, preserving serial projects", () => {
  const full = discover("vitest.config.ts"),
    fast = discover("test/fast.config.ts"),
    integration = discover("test/integration.config.ts");
  const files = (rows: typeof full) => rows.map((row) => row.file).sort();
  for (const rows of [full, fast, integration])
    expect(new Set(files(rows)).size).toBe(rows.length);
  expect(files(fast)).toEqual([...fastTests].sort());
  expect(fast.some((a) => integration.some((b) => a.file === b.file))).toBe(
    false,
  );
  expect(files([...fast, ...integration])).toEqual(files(full));
  expect(files(integration)).toContain("test/test-selection.test.ts");
  for (const [project, serial] of [
    ["serial-process", serialProcessFiles],
    ["serial-scan", serialScanFiles],
  ] as const) {
    expect(fast.some((row) => serial.includes(row.file))).toBe(false);
    expect(
      files(integration.filter((row) => row.projectName === project)),
    ).toEqual([...serial].sort());
  }
}, 60000);
