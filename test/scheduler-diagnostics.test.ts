/** Diagnostics-only controls; not scheduler/native performance evidence. */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SchedulerDiagnostics } from "./helpers/scheduler-diagnostics.ts";

it("timing observation does not replace or await an original promise or retain its payload", async () => {
  const diagnostic = new SchedulerDiagnostics();
  diagnostic.path = join(
    mkdtempSync(join(tmpdir(), "cadence-timing-")),
    "receipt.json",
  );
  let release!: (value: object) => void;
  const original = new Promise<object>((resolve) => {
    release = resolve;
  });
  const target = { run: () => original },
    run = target.run;
  diagnostic.wrap(target, "run", () => {
    const result = run();
    diagnostic.original("write", result);
    return result;
  });
  expect(target.run()).toBe(original);
  diagnostic.finish(); // must return while the original is still pending
  expect(target.run).toBe(run);
  const pending = JSON.parse(readFileSync(diagnostic.path, "utf8"));
  expect(pending.pendingOriginalOrReportIds).toHaveLength(1);
  release({ privatePayload: "fabricated-never-retained-payload" });
  await original;
  diagnostic.finish();
  const bytes = readFileSync(diagnostic.path, "utf8");
  expect(JSON.parse(bytes).pendingOriginalOrReportIds).toEqual([]);
  expect(bytes).not.toContain("fabricated-never-retained-payload");
});

it("diagnostic slots and unresolved identity snapshots are bounded without holding original work", () => {
  const diagnostic = new SchedulerDiagnostics();
  diagnostic.path = join(
    mkdtempSync(join(tmpdir(), "cadence-timing-")),
    "receipt.json",
  );
  for (let i = 0; i < 2200; i++)
    diagnostic.original("write", new Promise(() => {}));
  diagnostic.finish();
  const bytes = readFileSync(diagnostic.path, "utf8"),
    receipt = JSON.parse(bytes);
  expect(receipt.events).toHaveLength(2048);
  expect(receipt.pendingOriginalOrReportIds).toHaveLength(2048);
  expect(receipt.dropped).toBeGreaterThan(0);
  expect(Buffer.byteLength(bytes)).toBeLessThan(256 * 1024);
});

it("receipt IO failure cannot replace the original test error or prevent wrapper restoration", () => {
  const diagnostic = new SchedulerDiagnostics();
  diagnostic.path = mkdtempSync(join(tmpdir(), "cadence-timing-")); // a directory, not a file
  const target = { run: () => 1 },
    run = target.run;
  diagnostic.wrap(target, "run", () => 2);
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => diagnostic.finish()).not.toThrow();
    expect(target.run).toBe(run);
    expect(output).toHaveBeenCalledWith(
      "Scheduler timing receipt unavailable; original test outcome unchanged.",
    );
  } finally {
    output.mockRestore();
  }
});
