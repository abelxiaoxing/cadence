import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("traceability check", () => {
  it("resolves the archived delivery traceability map", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "traceability-check.mjs")],
      {
        cwd: path.dirname(root),
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "traceability-check: 81 unique references resolve exactly once",
    );
  });
});
