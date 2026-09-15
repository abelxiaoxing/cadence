import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const directory = resolve("scripts/host-prototype");
it("[HOST-PREP:harness-contract] rejects false qualification (unit evidence only)", async () => {
  for (const file of [
    "macos-supervisor.mjs",
    "lifecycle-fixture.mjs",
    "qualify.mjs",
  ])
    expect(
      existsSync(`${directory}/${file}`),
      "[HOST-PREP:harness-contract]",
    ).toBe(true);
  const harness = await import(`${directory}/qualify.mjs`);
  const supervisor = await import(`${directory}/macos-supervisor.mjs`);
  const cases = harness.planCases("darwin");
  expect(cases).toContain("parent-loss");
  expect(cases).toContain("helper-failure");
  expect(harness.planCases("win32")).toContain("assignment-failure");
  const observation = {
    version: 1,
    outcome: "complete",
    reason: "exit",
    rootExited: true,
    managedSettled: true,
    descendantsReaped: true,
  };
  expect(harness.validateCase("stream", observation, { witness: true })).toBe(
    true,
  );
  for (const bad of [
    { ...observation, managedSettled: false },
    { ...observation, descendantsReaped: false },
    { ...observation, outcome: "failed", reason: "launch-failed" },
    {
      ...observation,
      outcome: "uncertain",
      reason: "termination-unconfirmed",
      managedSettled: false,
    },
  ])
    expect(() =>
      harness.validateCase("stream", bad, { witness: true }),
    ).toThrow();
  expect(() => harness.validateResults("darwin", [])).toThrow();
  expect(() =>
    harness.validateCase("stream", observation, { witness: false }),
  ).toThrow();
  expect(
    supervisor.settlement({
      rootExited: true,
      groupExists: true,
      expired: true,
    }).outcome,
  ).toBe("uncertain");
  expect(
    supervisor.settlement({
      rootExited: true,
      groupExists: false,
      expired: false,
    }).outcome,
  ).toBe("complete");
  const output = mkdtempSync(join(tmpdir(), "host-prep-test-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        `${directory}/qualify.mjs`,
        "--require-native",
        "--output",
        output,
        "--fake-platform",
        "darwin",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).not.toBe(0);
    expect(readdirSync(output)).not.toContain("qualified.json");
    if (process.platform === "linux") {
      writeFileSync(join(output, "qualified.json"), '{"stale":true}');
      const native = spawnSync(
        process.execPath,
        [`${directory}/qualify.mjs`, "--require-native", "--output", output],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(native.status).toBe(1);
      expect(readdirSync(output)).not.toContain("qualified.json");
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

it("requires each named case exactly once, with scenario-specific settlement", async () => {
  const harness = await import(`${directory}/qualify.mjs`);
  const reasons: Record<string, string> = {
    "root-exit": "timeout",
    stream: "exit",
    "output-limit": "output-limit",
    cancel: "cancelled",
    timeout: "timeout",
    "parent-loss": "cancelled",
    "helper-failure": "helper-failed",
    "unicode-environment": "exit",
  };
  const results = harness.planCases("darwin").map((name: string) => ({
    name,
    evidence: { witness: true },
    observation: {
      version: 1,
      outcome: reasons[name] === "exit" ? "complete" : "failed",
      reason: reasons[name],
      rootExited: true,
      managedSettled: true,
      descendantsReaped: true,
    },
  }));
  // Controlled observations validate preparation only; there is no report writer API.
  expect(harness.validateResults("darwin", results)).toBe(true);
  expect(() =>
    harness.validateResults("darwin", [...results.slice(1), results[1]]),
  ).toThrow();
  expect(() =>
    harness.validateCase("timeout", results[1].observation, { witness: true }),
  ).toThrow();
  expect(() =>
    harness.validateCase(
      "stream",
      { ...results[1].observation, productRed: true },
      { witness: true },
    ),
  ).toThrow();
  expect(harness).not.toHaveProperty("executeCase");
  expect(harness).not.toHaveProperty("main");
});
