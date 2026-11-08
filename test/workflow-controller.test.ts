import { expect, it, vi } from "vitest";
import {
  AttemptFailure,
  DeliveryController,
  decodeRecoveryDecision,
  modelRequestFailed,
  type RecoveryDecision,
  type RecoveryPorts,
  type RecoveryRecord,
} from "../src/service/workflow-controller.ts";

const decision = (
  strategy = "Inspect partial outputs and finish only missing behavior",
): RecoveryDecision => ({
  action: "continue",
  cause: "A settled attempt left work",
  evidence: ["step-a"],
  strategy,
  work: [],
});
function fixture(overrides: Partial<RecoveryPorts> = {}) {
  const records: RecoveryRecord[] = [];
  const ports: RecoveryPorts = {
    assertRunning: vi.fn(),
    observe: async () => "bytes-v1",
    diagnose: vi.fn(async () => decision()),
    record: (r) => records.push(r),
    execute: vi.fn(async () => {}),
    ...overrides,
  };
  return { controller: new DeliveryController(ports), ports, records };
}
it("more than two failed attempts can complete one goal without another approval", async () => {
  let attempt = 0;
  const f = fixture({ observe: async () => `verified-partial-${attempt}` });
  const result = await f.controller.complete("implementation", async () => {
    if (++attempt <= 5) throw new AttemptFailure("unfinished", ["step-a"]);
    return "verified output";
  });
  expect(result).toBe("verified output");
  expect(f.records).toHaveLength(5);
  expect(f.records.map((r) => r.revision)).toEqual([1, 2, 3, 4, 5]);
});
it("a diagnosis can split remaining work, and a failed repair is diagnosed rather than abandoned", async () => {
  let attempts = 0,
    repairs = 0;
  const f = fixture({
    observe: async () => `partial-${repairs}`,
    diagnose: async () => ({
      ...decision(),
      work: [
        {
          title: "missing edge case",
          instructions: "finish existing output",
          writes: ["src"],
        },
      ],
    }),
    execute: async () => {
      if (++repairs === 1)
        throw new AttemptFailure("repair left a gap", ["step-a"]);
    },
  });
  await f.controller.complete("checks", async () => {
    if (++attempts === 1) throw new AttemptFailure("test failed", ["step-a"]);
  });
  expect(attempts).toBe(2);
  expect(repairs).toBe(2);
  expect(f.records.map((r) => r.failure)).toEqual([
    "test failed",
    "repair left a gap",
  ]);
});
it("unchanged evidence and an identical strategy cannot form an automatic replay loop", async () => {
  const f = fixture();
  const work = vi.fn(async () => {
    throw new AttemptFailure("same failure", ["step-a"]);
  });
  await expect(f.controller.complete("implementation", work)).rejects.toThrow(
    "No new evidence",
  );
  expect(work).toHaveBeenCalledTimes(2);
  expect(f.records).toHaveLength(2);
});
it("unknown, scope, storage and cancellation errors never dispatch recovery", async () => {
  for (const message of [
    "unknown closure",
    "scope violation",
    "storage failed",
    "canceled",
  ]) {
    const f = fixture();
    await expect(
      f.controller.complete("implementation", async () => {
        throw new Error(message);
      }),
    ).rejects.toThrow(message);
    expect(f.ports.diagnose).not.toHaveBeenCalled();
    expect(f.records).toEqual([]);
  }
});
it("Cancel during diagnosis prevents a proposed write from being admitted", async () => {
  let canceled = false;
  const f = fixture({
    assertRunning: () => {
      if (canceled) throw new Error("canceled");
    },
    diagnose: async () => {
      canceled = true;
      return decision();
    },
  });
  await expect(
    f.controller.complete("implementation", async () => {
      throw new AttemptFailure("failed", ["step-a"]);
    }),
  ).rejects.toThrow("canceled");
  expect(f.ports.execute).not.toHaveBeenCalled();
  expect(f.records).toEqual([]);
});
it("a real external blocker is retained, never presented as success or a request to keep clicking", async () => {
  const f = fixture({
    diagnose: async () => ({
      ...decision("The approved API does not expose the required operation"),
      action: "blocked",
    }),
  });
  await expect(
    f.controller.complete("implementation", async () => {
      throw new AttemptFailure("unavailable API", ["step-a"]);
    }),
  ).rejects.toThrow("Delivery blocked");
  expect(f.records[0].decision.action).toBe("blocked");
});
it("replanning can only name approved paths and actual evidence, never new commands or acceptance", () => {
  const value = {
    ...decision(),
    work: [
      {
        title: "replace algorithm",
        instructions: "Use the existing module",
        writes: ["src/search.ts"],
      },
    ],
  };
  expect(
    decodeRecoveryDecision(JSON.stringify(value), ["src"], ["step-a"]),
  ).toEqual(value);
  for (const invalid of [
    { ...value, evidence: ["invented-step"] },
    { ...value, evidence: [] },
    { ...value, command: "install unapproved software" },
    { ...value, acceptance: "ignore failing tests" },
    { ...value, work: [{ ...value.work[0], writes: ["src-other/file.ts"] }] },
    { ...value, work: [{ ...value.work[0], writes: ["../outside"] }] },
    { ...value, action: "blocked" },
  ])
    expect(() =>
      decodeRecoveryDecision(JSON.stringify(invalid), ["src"], ["step-a"]),
    ).toThrow();
});
it("model recovery exhaustion never starts diagnosis or replays an earlier repair", async () => {
  let original = 0;
  const writes: string[] = [];
  const f = fixture({
    diagnose: async () => ({
      ...decision(),
      work: ["first", "second"].map((title) => ({
        title,
        instructions: "finish only missing work",
        writes: ["src"],
      })),
    }),
    execute: async (work) => {
      writes.push(work.title);
      if (work.title === "second")
        throw new Error("Model request recovery exhausted");
    },
  });
  await expect(
    f.controller.complete("implementation", async () => {
      if (++original === 1)
        throw new AttemptFailure("needs splitting", ["step-a"]);
    }),
  ).rejects.toThrow("Model request recovery exhausted");
  expect(writes).toEqual(["first", "second"]);
  expect(original).toBe(1);
  expect(f.records).toHaveLength(1);
});

it("terminal model failure requires its fixed diagnostic and settled cleanup, not HTTP or model prose", () => {
  const observed = {
    outcome: "failed",
    stage: "assistant-final",
    class: "model-request-failed",
    terminalStopReason: "error",
    cleanupSettled: true,
    cleanupFailures: 0,
  };
  expect(modelRequestFailed(JSON.stringify(observed))).toBe(true);
  for (const invalid of [
    { ...observed, outcome: "completed" },
    { ...observed, terminalStopReason: "aborted" },
    { ...observed, class: "terminal-incomplete" },
    { ...observed, cleanupSettled: false },
    { ...observed, cleanupFailures: 1 },
    { ...observed, stage: "cleanup" },
    { actualResponseStatus: 429 },
  ])
    expect(modelRequestFailed(JSON.stringify(invalid))).toBe(false);
  expect(modelRequestFailed("The model said HTTP 429, please retry")).toBe(
    false,
  );
});

it("recovery records sanitize decoded field values without reviving escaped secrets", () => {
  const secret = "fixture-private-value";
  const value = {
    ...decision(),
    cause: secret,
    strategy: `Repair ${secret}`,
    work: [
      { title: secret, instructions: `Inspect ${secret}`, writes: ["src"] },
    ],
  };
  const encoded = JSON.stringify(value).replaceAll("fixture", "\\u0066ixture");
  const decoded = decodeRecoveryDecision(
    encoded,
    ["src"],
    ["step-a"],
    [secret],
  );
  expect(JSON.stringify(decoded)).not.toContain(secret);
  expect(decoded.cause).toBe("[redacted]");
});
