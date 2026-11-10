import { expect, it, vi } from "vitest";
import {
  AttemptFailure,
  DeliveryController,
  decodeRecoveryDecision,
  InvalidDecision,
  modelRequestFailed,
  type RecoveryBounds,
  type RecoveryDecision,
  type RecoveryLevel,
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
  level: "repair",
  scope: [],
  deviation: null,
  blocker: null,
});
const bounds = (extra: Partial<RecoveryBounds> = {}): RecoveryBounds => ({
  scope: ["src"],
  evidence: ["step-a"],
  floor: "repair",
  checks: ["unit", "lint"],
  ...extra,
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
it("unchanged evidence and an identical approach move the decision up a level instead of replaying it, and end only at the top", async () => {
  const floors: RecoveryLevel[] = [];
  const f = fixture({
    // The diagnosis keeps answering at the least level it is allowed.
    diagnose: async (_failure, _previous, floor) => {
      floors.push(floor);
      return {
        ...decision(),
        level: floor,
        deviation:
          floor === "deviate"
            ? { item: "exact parity", reason: "x", delivered: "y", waives: [] }
            : null,
      };
    },
  });
  const work = vi.fn(async () => {
    throw new AttemptFailure("same failure", ["step-a"]);
  });
  await expect(f.controller.complete("implementation", work)).rejects.toThrow(
    "No new evidence or strategy for implementation at any level",
  );
  // repair, then replan, then deviate are each tried once before the end.
  expect(f.records.map((r) => r.decision.level)).toEqual([
    "repair",
    "replan",
    "deviate",
  ]);
  expect(work).toHaveBeenCalledTimes(4);
  expect(floors).toEqual([
    "repair",
    "repair",
    "replan",
    "replan",
    "deviate",
    "deviate",
  ]);
});
it("a reply the owner cannot act on is asked again with the reason, and is not a failed delivery by itself", async () => {
  const objections: (string | undefined)[] = [];
  let asked = 0;
  const f = fixture({
    diagnose: async (_failure, _previous, _floor, objection) => {
      objections.push(objection);
      if (++asked === 1) throw new InvalidDecision("not the requested JSON");
      return decision();
    },
  });
  let attempt = 0;
  await f.controller.complete("implementation", async () => {
    if (++attempt === 1) throw new AttemptFailure("failed", ["step-a"]);
  });
  expect(objections).toEqual([undefined, "not the requested JSON"]);
  expect(f.records).toHaveLength(1);
  // It stays bounded: a third unusable reply ends the stage.
  const stubborn = fixture({
    diagnose: vi.fn(async () => {
      throw new InvalidDecision("still unusable");
    }),
  });
  await expect(
    stubborn.controller.complete("implementation", async () => {
      throw new AttemptFailure("failed", ["step-a"]);
    }),
  ).rejects.toBeInstanceOf(InvalidDecision);
  expect(stubborn.ports.diagnose).toHaveBeenCalledTimes(3);
  expect(stubborn.records).toEqual([]);
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
      ...decision("The provider rejects every request for this account"),
      action: "blocked",
      blocker: "model",
    }),
  });
  await expect(
    f.controller.complete("implementation", async () => {
      throw new AttemptFailure("unavailable API", ["step-a"]);
    }),
  ).rejects.toThrow("Delivery blocked (model)");
  expect(f.records[0].decision.action).toBe("blocked");
});
it("a repair names only paths in the current scope and actual evidence, never new commands or acceptance", () => {
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
  expect(decodeRecoveryDecision(JSON.stringify(value), bounds())).toEqual(
    value,
  );
  // A reply may omit the fields a plain repair does not need.
  const { level: _l, scope: _s, deviation: _d, blocker: _b, ...plain } = value;
  expect(decodeRecoveryDecision(JSON.stringify(plain), bounds())).toEqual(
    value,
  );
  for (const invalid of [
    { ...value, evidence: ["invented-step"] },
    { ...value, evidence: [] },
    { ...value, command: "install unapproved software" },
    { ...value, acceptance: "ignore failing tests" },
    { ...value, work: [{ ...value.work[0], writes: ["src-other/file.ts"] }] },
    { ...value, work: [{ ...value.work[0], writes: ["../outside"] }] },
    // A repair cannot widen the scope; that is a revision of the route.
    { ...value, scope: ["docs/guide.md"] },
    // Blocked needs a named outside condition and dispatches nothing.
    { ...value, action: "blocked" },
    { ...value, action: "blocked", work: [], blocker: null },
    { ...value, blocker: "model" },
  ])
    expect(() =>
      decodeRecoveryDecision(JSON.stringify(invalid), bounds()),
    ).toThrow(InvalidDecision);
  expect(() =>
    decodeRecoveryDecision("I would simply retry.", bounds()),
  ).toThrow(InvalidDecision);
});
it("a revised route may bring repository files into the write scope, never credentials, keys or paths outside it", () => {
  const value = {
    ...decision("Move the shared type so both modules can use it"),
    level: "replan",
    scope: ["shared/types.ts", "docs/guide.md"],
    work: [
      {
        title: "extract type",
        instructions: "Create the shared type and update both users",
        writes: ["shared/types.ts", "src/a.ts"],
      },
    ],
  };
  expect(decodeRecoveryDecision(JSON.stringify(value), bounds())).toEqual(
    value,
  );
  for (const path of [
    ".env",
    "config/.env.local",
    ".git/config",
    "../sibling/file.ts",
    "/etc/hosts",
    "deploy/id_rsa",
    "certs/server.pem",
    ".ssh/config",
    "auth.json",
  ])
    expect(
      () =>
        decodeRecoveryDecision(
          JSON.stringify({ ...value, scope: [path], work: [] }),
          bounds(),
        ),
      path,
    ).toThrow(InvalidDecision);
  // Work may not write what the decision did not bring into scope.
  expect(() =>
    decodeRecoveryDecision(
      JSON.stringify({
        ...value,
        work: [{ ...value.work[0], writes: ["other/file.ts"] }],
      }),
      bounds(),
    ),
  ).toThrow("list the additional paths in scope");
  // Once an approach repeated, a decision below the required level is refused.
  expect(() =>
    decodeRecoveryDecision(
      JSON.stringify(decision()),
      bounds({ floor: "replan" }),
    ),
  ).toThrow("decide at level replan or above");
});
it("a deviation names the item, the reason and what is delivered, and can set aside only declared checks", () => {
  const value = {
    ...decision("The upstream format cannot carry the field"),
    level: "deviate",
    deviation: {
      item: "Exports keep the legacy checksum column",
      reason: "The format has no such column since v3 (see test output)",
      delivered: "Exports carry the checksum in the footer line",
      waives: ["lint"],
    },
  };
  expect(decodeRecoveryDecision(JSON.stringify(value), bounds())).toEqual(
    value,
  );
  for (const invalid of [
    { ...value, deviation: null },
    { ...value, level: "replan" },
    { ...value, deviation: { ...value.deviation, waives: ["invented-check"] } },
    { ...value, deviation: { ...value.deviation, item: "" } },
    { ...decision(), deviation: value.deviation },
  ])
    expect(() =>
      decodeRecoveryDecision(JSON.stringify(invalid), bounds()),
    ).toThrow(InvalidDecision);
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
  const decoded = decodeRecoveryDecision(encoded, bounds(), [secret]);
  expect(JSON.stringify(decoded)).not.toContain(secret);
  expect(decoded.cause).toBe("[redacted]");
});

it("settled owner-auth refusal/loss ends delivery rather than starting a second recovery layer", () => {
  for (const category of ["owner-auth-refused", "owner-auth-lost"]) {
    const diagnostic = {
      outcome: "failed",
      stage: "auth-model",
      class: category,
      cleanupSettled: true,
      cleanupFailures: 0,
    };
    expect(modelRequestFailed(JSON.stringify(diagnostic))).toBe(true);
    expect(
      modelRequestFailed(
        JSON.stringify({ ...diagnostic, cleanupSettled: false }),
      ),
    ).toBe(false);
  }
});
it("a repair is dispatched under the revision the run recorded for its decision", async () => {
  const dispatched: number[] = [];
  let attempt = 0;
  const f = fixture({
    observe: async () => `partial-${attempt}`,
    diagnose: async () => ({
      ...decision(`approach ${attempt}`),
      work: [{ title: "finish", instructions: "the rest", writes: ["a.ts"] }],
    }),
    // The run numbers revisions across all of its controllers.
    record: (r) => r.revision + 40,
    execute: async (_work, revision) => {
      dispatched.push(revision);
    },
  });
  await f.controller.complete("implementation", async () => {
    if (++attempt <= 2) throw new AttemptFailure("unfinished", ["step-a"]);
    return "done";
  });
  expect(dispatched).toEqual([41, 42]);
});
