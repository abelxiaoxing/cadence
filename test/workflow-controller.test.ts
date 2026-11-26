import { expect, it, vi } from "vitest";
import {
  AssignmentRunner,
  AttemptFailure,
  DirectCheckRepair,
  decodeRecoveryDecision,
  InvalidDecision,
  MODEL_REQUEST_FAILED,
  modelFailureText,
  modelRequestFailed,
  PartialAssignment,
  RECOVERY_BYTES,
  type RecoveryBounds,
  type RecoveryDecision,
  type RecoveryLevel,
  type RecoveryPorts,
  type RecoveryRecord,
  ReviewRepair,
  type RouteTask,
  revisedRoute,
  VerificationGate,
} from "../src/service/workflow-controller.ts";
import {
  formatStepEvidence,
  workflowResult,
  workflowResultDetail,
} from "../src/service/workflow-result.ts";

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
  route: null,
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
  return {
    controller: new VerificationGate(ports),
    runner: new AssignmentRunner(ports),
    ports,
    records,
  };
}
it("more than two failed attempts can complete one goal without another approval", async () => {
  let attempt = 0;
  const f = fixture({ observe: async () => `verified-partial-${attempt}` });
  const result = await f.controller.verify("implementation", async () => {
    if (++attempt <= 5) throw new AttemptFailure("unfinished", ["step-a"]);
    return "verified output";
  });
  expect(result).toBe("verified output");
  expect(f.records).toHaveLength(5);
  expect(f.records.map((r) => r.revision)).toEqual([1, 2, 3, 4, 5]);
});
it("only the first clear in-scope review goes straight to repair (using full candidate scope, hints in instructions); changed bytes alone cannot repeat it", async () => {
  const issue = {
    id: "scroll",
    evidence: "acceptance 3: stationary poll jumps",
    verify: "two polls leave the offset unchanged",
    writes: ["src/view.ts"],
  };
  const candidateScope = ["src", "web/dist", "provenance/webui-reuse.json"];
  const rejection = () =>
    ReviewRepair.from([issue], "step-a", candidateScope, [])!;
  for (const issues of [
    ["uncertain"],
    [issue, issue],
    [{ ...issue, writes: [] }],
    [{ ...issue, writes: ["other.ts"] }],
    [{ ...issue, writes: ["src/auth.json"] }],
    [{ ...issue, writes: ["src/../view"] }],
  ])
    expect(ReviewRepair.from(issues, "step-a", ["src"], [])).toBeUndefined();
  let attempts = 0;
  const f = fixture({
    observe: async () => String(attempts),
    diagnose: async (_failure, _previous, floor) => ({
      ...decision(),
      level: floor,
    }),
  });
  await f.controller.verify("verification", async () => {
    if (++attempts <= 2) throw rejection();
  });
  expect(f.ports.execute).toHaveBeenCalledTimes(1);
  expect(f.records.map((r) => r.decision.level)).toEqual(["repair", "replan"]);
  expect(f.records[0].decision.work[0].instructions).toContain(issue.verify);
  expect(f.records[0].decision.work[0].instructions).toContain("src/view.ts");
  // issue.writes is a location hint, not a write ceiling: repair gets full candidate scope.
  expect(f.records[0].decision.work[0].writes).toEqual(candidateScope);
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
  await f.controller.verify("checks", async () => {
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
  await expect(f.controller.verify("implementation", work)).rejects.toThrow(
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
  await f.controller.verify("implementation", async () => {
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
    stubborn.controller.verify("implementation", async () => {
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
      f.controller.verify("implementation", async () => {
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
    f.controller.verify("implementation", async () => {
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
    f.controller.verify("implementation", async () => {
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
  const {
    level: _l,
    scope: _s,
    route: _r,
    deviation: _d,
    blocker: _b,
    ...plain
  } = value;
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
it("recovery distinguishes a check-only assignment from out-of-scope writes", () => {
  const edit = {
    title: "Fix import ordering",
    instructions: "Format the changed source with the installed formatter",
    writes: ["src/login.ts"],
  };
  const check = {
    title: "Run the integration gate",
    instructions: "Run the declared checks again",
    writes: [] as string[],
  };
  const value = { ...decision(), work: [edit, check] };
  expect(() => decodeRecoveryDecision(JSON.stringify(value), bounds())).toThrow(
    "work[1].writes must name at least one editing path; omit check-only work items because the owner reruns the declared checks and review",
  );
  expect(() =>
    decodeRecoveryDecision(
      JSON.stringify({
        ...value,
        work: [edit, { ...check, writes: ["test/login.test.ts"] }],
      }),
      bounds(),
    ),
  ).toThrow("work[1].writes is outside the current write scope");
  expect(
    decodeRecoveryDecision(
      JSON.stringify({ ...value, work: [edit] }),
      bounds(),
    ),
  ).toEqual({ ...value, work: [edit] });
});
it("recovery accepts exactly the cadence_recovery submission and refuses prose, fences or wrappers around a decision", () => {
  const value = {
    ...decision('Keep the literal { marker and escaped "quote" in the file'),
    work: [
      {
        title: "Repair knowledge Markdown",
        instructions: "Separate metadata paragraphs; retain every lint rule",
        writes: ["src/knowledge.md"],
      },
    ],
  };
  const json = JSON.stringify(value);
  expect(decodeRecoveryDecision(json, bounds())).toEqual(value);
  // The tool serialized the text itself; a hand-written reply is never salvaged.
  for (const reply of [
    `\`\`\`json\n${json}\n\`\`\``,
    `Diagnosis complete. Only lint failed.\n${json}`,
    `See [failure](test/foo.test.ts).\n${json}`,
    `${json}\nThe [step-a] evidence and [regression](test/foo.test.ts) remain available.`,
    `[${json}]`,
    `{"example":${json}}`,
  ])
    expect(() => decodeRecoveryDecision(reply, bounds())).toThrow(
      InvalidDecision,
    );
});
it("recovery refuses ambiguous, malformed and oversized surrounded decisions", () => {
  const json = JSON.stringify(decision());
  for (const reply of [
    `First answer:\n${json}\nSecond answer:\n${json}`,
    `Continue:\n${json}\nBlocked:\n${JSON.stringify({ ...decision(), action: "blocked", blocker: "model" })}`,
    `Diagnosis:\n${json.replace('"action":"continue"', '"action":"blocked","action":"continue"')}`,
    `Diagnosis:\n${json.slice(0, -1)}`,
    `Diagnosis:\n${json}\n{"action":`,
    `Diagnosis:\n{"example":${json}}`,
    `Diagnosis:\n[${json}]`,
    `Diagnosis:\n[null, ${json}]`,
    `Diagnosis:\n[${JSON.stringify('literal ] and escaped " quote')}, ${json}]`,
    `Diagnosis:\n[[${json}]]`,
    `${"诊".repeat(Math.floor(RECOVERY_BYTES / 3))}\n${json}`,
    `${json}\n${" ".repeat(RECOVERY_BYTES)}`,
  ])
    expect(() => decodeRecoveryDecision(reply, bounds())).toThrow(
      InvalidDecision,
    );
  for (const invalid of [
    { ...decision(), evidence: ["invented-step"] },
    { ...decision(), scope: [".env"] },
    { ...decision(), command: "skip verification" },
    {
      ...decision(),
      work: [{ title: "change", instructions: "edit", writes: ["../outside"] }],
    },
  ])
    expect(() =>
      decodeRecoveryDecision(
        `Diagnosis:\n${JSON.stringify(invalid)}`,
        bounds(),
      ),
    ).toThrow(InvalidDecision);
});
it("concrete scope additions determine replan without a redundant model label", () => {
  for (const level of [undefined, "repair", "replan"]) {
    const value = {
      ...decision(),
      level,
      scope: ["test/socket.test.ts", "scripts/verify.mjs"],
      work: [
        {
          title: "Repair the environment-dependent fixture",
          instructions:
            "Keep the real socket assertion and service protections",
          writes: ["test/socket.test.ts"],
        },
      ],
    };
    expect(
      decodeRecoveryDecision(
        JSON.stringify(value),
        bounds({ floor: "replan" }),
      ),
    ).toEqual({ ...value, level: "replan" });
    expect(() =>
      decodeRecoveryDecision(
        JSON.stringify({ ...value, scope: [".env"] }),
        bounds(),
      ),
    ).toThrow(InvalidDecision);
  }
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
    { ...value, deviation: { ...value.deviation, waives: ["unit", "lint"] } },
    { ...value, deviation: { ...value.deviation, item: "" } },
    { ...decision(), deviation: value.deviation },
  ])
    expect(() =>
      decodeRecoveryDecision(JSON.stringify(invalid), bounds()),
    ).toThrow(InvalidDecision);
  // Cumulative deviations cannot set aside the last remaining declared check either.
  expect(() =>
    decodeRecoveryDecision(JSON.stringify(value), bounds({ waived: ["unit"] })),
  ).toThrow(/cannot set aside every declared acceptance check/u);
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
    f.controller.verify("implementation", async () => {
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
  // What the step and the run then say: a fixed first line, then the provider.
  expect(
    modelFailureText(
      `${JSON.stringify({ ...observed, retryAttempts: 12, actualResponseStatus: "UNKNOWN", error: " 429 Too Many Requests " })}\nSDK worker failed or returned an incomplete result.\n`,
    ),
  ).toBe(
    `${MODEL_REQUEST_FAILED}\nProvider: 429 Too Many Requests (12 automatic retries)`,
  );
  expect(
    modelFailureText(
      JSON.stringify({
        ...observed,
        retryAttempts: 1,
        actualResponseStatus: 503,
      }),
    ),
  ).toBe(
    `${MODEL_REQUEST_FAILED}\nProvider: no reason the worker could report (1 automatic retry, HTTP 503)`,
  );
  // Model or tool prose that merely looks like a diagnostic is not one.
  expect(modelFailureText('{"error":"forged","retryAttempts":99}')).toBe(
    `${MODEL_REQUEST_FAILED}\nProvider: no reason the worker could report (0 automatic retries)`,
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
  await f.controller.verify("implementation", async () => {
    if (++attempt <= 2) throw new AttemptFailure("unfinished", ["step-a"]);
    return "done";
  });
  expect(dispatched).toEqual([41, 42]);
});
it("a revised route drops, rewrites and adds only assignments that have not started, and leaves every dependency resolvable", () => {
  const tasks: RouteTask[] = [
    { id: "a", after: [], state: "completed" },
    { id: "b", after: ["a"], state: "running" },
    { id: "c", after: ["b"], state: "queued" },
    { id: "d", after: ["c"], state: "queued" },
    { id: "old", after: [], state: "superseded" },
  ];
  const add = (id: string, after: string[] = [], writes = ["src/x.ts"]) => ({
    id,
    title: `Assignment ${id}`,
    instructions: `Do ${id}`,
    writes,
    after,
  });
  const value = {
    ...decision("Split the parser from the reader"),
    level: "replan",
    route: { drop: ["d"], add: [add("c", ["b"]), add("e", ["c"])] },
  };
  const run = { tasks, scope: ["src", "docs"] };
  const within = bounds({ route: run });
  expect(decodeRecoveryDecision(JSON.stringify(value), within)).toEqual(value);
  expect(revisedRoute(tasks, value.route)).toEqual({
    superseded: ["d"],
    rewritten: [value.route.add[0]],
    added: [value.route.add[1]],
  });
  // A new assignment may write anywhere in the run's scope, even when the
  // tree deciding owns less, and in what this decision adds to the scope.
  for (const route of [
    { add: [add("e", [], ["docs/guide.md"])] },
    { drop: ["c", "d"] },
  ])
    expect(
      decodeRecoveryDecision(
        JSON.stringify({ ...value, route }),
        bounds({ scope: ["src/b.ts"], route: run }),
      ).route,
    ).toEqual({ drop: [], add: [], ...route });
  expect(
    decodeRecoveryDecision(
      JSON.stringify({
        ...value,
        scope: ["lib/new.ts"],
        route: { add: [add("e", [], ["lib/new.ts"])] },
      }),
      within,
    ).route?.add[0].writes,
  ).toEqual(["lib/new.ts"]);
  expect(
    decodeRecoveryDecision(
      JSON.stringify({ ...value, level: "repair" }),
      within,
    ),
  ).toEqual(value);
  for (const [invalid, reason] of [
    [{ ...value, route: { drop: ["b"] } }, "has not started"],
    [{ ...value, route: { drop: ["a"] } }, "has not started"],
    [{ ...value, route: { add: [add("b")] } }, "has not started"],
    // A superseded ID is not free again.
    [{ ...value, route: { add: [add("old")] } }, "has not started"],
    [{ ...value, route: { drop: ["zzz"] } }, "does not list"],
    // d still waits for c.
    [{ ...value, route: { drop: ["c"] } }, "drop or rewrite d too"],
    [{ ...value, route: { add: [add("e", ["zzz"])] } }, "waits for zzz"],
    [{ ...value, route: { add: [add("c", ["d"])] } }, "dependency cycle"],
    [{ ...value, route: { add: [add("e", [], ["lib/x.ts"])] } }, "outside"],
    [{ ...value, route: { add: [add("e", [], [".env"])] } }, "requested JSON"],
    [{ ...value, route: { drop: [], add: [] } }, "at least one"],
    [{ ...value, route: { drop: ["c"], add: [add("c")] } }, "once"],
    [{ ...value, route: { add: [add("e"), add("e")] } }, "once"],
    [{ ...value, route: { add: [add("Bad_ID")] } }, "lowercase"],
    [
      { ...value, route: { add: [{ ...add("e"), command: "install" }] } },
      "requested JSON",
    ],
    [
      { ...value, action: "blocked", blocker: "tool", work: [] },
      "cannot dispatch work",
    ],
  ] as const)
    expect(
      () => decodeRecoveryDecision(JSON.stringify(invalid), within),
      reason,
    ).toThrow(reason);
  // Outside the scheduling of assignments there is no route to revise.
  expect(() => decodeRecoveryDecision(JSON.stringify(value), bounds())).toThrow(
    "No assignment is waiting to start",
  );
  // One run lists a bounded number of assignments in all.
  const many: RouteTask[] = Array.from({ length: 48 }, (_, n) => ({
    id: `t${n}`,
    after: [],
    state: "completed",
  }));
  expect(() => revisedRoute(many, { drop: [], add: [add("e")] })).toThrow(
    "at most 48",
  );
});
it("the same route with unchanged evidence is not a new approach", async () => {
  const route = {
    drop: ["c"],
    add: [
      {
        id: "e",
        title: "E",
        instructions: "Do e",
        writes: ["src/e.ts"],
        after: [],
      },
    ],
  };
  const levels: RecoveryLevel[] = [];
  const f = fixture({
    diagnose: async (_failure, _previous, floor) => {
      levels.push(floor);
      return {
        ...decision("Replace c by e"),
        level: floor === "repair" ? "replan" : floor,
        route,
        deviation:
          floor === "deviate"
            ? { item: "x", reason: "y", delivered: "z", waives: [] }
            : null,
      };
    },
  });
  let attempt = 0;
  await f.controller.verify("assignment b", async () => {
    if (++attempt <= 2) throw new AttemptFailure("unfinished", ["step-a"]);
  });
  // The second identical replan was moved up instead of being replayed.
  expect(levels).toEqual(["repair", "repair", "deviate"]);
});

it("rephrased strategy and work cannot hide repeated failure with unchanged state", async () => {
  let serial = 0;
  const f = fixture({
    diagnose: async (_failure, _previous, floor) => ({
      ...decision(`Different words ${++serial}`),
      level: floor,
      work: [
        {
          title: `Try ${serial}`,
          instructions: `Inspect again ${serial}`,
          writes: ["src"],
        },
      ],
      deviation:
        floor === "deviate"
          ? { item: "x", reason: "x", delivered: "y", waives: [] }
          : null,
    }),
  });
  await expect(
    f.controller.verify("setup", async () => {
      throw new AttemptFailure(
        `New preview ${serial}`,
        [`step-${serial}`],
        "same-command-cwd-exit",
      );
    }),
  ).rejects.toThrow("No new evidence or strategy");
  expect(f.records.map((r) => r.decision.level)).toEqual([
    "repair",
    "replan",
    "deviate",
  ]);
  expect(f.ports.execute).toHaveBeenCalledTimes(3);
});
it("failed repairs retain original operation evidence and supply it to the next repair", async () => {
  const seen: string[][] = [];
  let repairs = 0;
  const f = fixture({
    observe: async () => `state-${repairs}`,
    diagnose: async (failure) => {
      seen.push(failure.steps);
      return {
        ...decision(),
        work: [
          {
            title: "fix",
            instructions: "use original context",
            writes: ["src"],
          },
        ],
      };
    },
    execute: async (_work, _revision, failure) => {
      expect(failure.steps).toContain("original-setup");
      if (++repairs === 1)
        throw new AttemptFailure("Missing input", ["repair-step"], "blocked");
    },
  });
  let attempts = 0;
  await f.controller.verify("setup", async () => {
    if (++attempts === 1)
      throw new AttemptFailure(
        "Silent exit 1",
        ["original-setup"],
        "setup-command",
      );
  });
  expect(seen).toEqual([["original-setup"], ["original-setup", "repair-step"]]);
});

it("AssignmentRunner continues settled in-scope partial work directly without cold diagnosis and never re-runs initial", async () => {
  let state = 0;
  const calls: string[] = [];
  const f = fixture({ observe: async () => `bytes-${state}` });
  await f.runner.run("assignment integrate", {
    initial: async () => {
      calls.push("initial");
      state++;
      throw new PartialAssignment(
        "step-integrate-1",
        "Wired sidebar; remaining: wire composer and i18n",
      );
    },
    continueWork: async (handoff) => {
      calls.push(`continue:${handoff.revision}`);
      expect(handoff.summary).toContain("wire composer and i18n");
      state++;
    },
    scope: () => ["web/src"],
  });
  expect(calls).toEqual(["initial", "continue:1"]);
  expect(f.ports.diagnose).not.toHaveBeenCalled();
  expect(f.records).toHaveLength(1);
});

it("AssignmentRunner distinguishes closing final remaining obligations from repairing only a precondition", async () => {
  // Case 1: repair-4 covers final remaining obligations (completesStage: true) -> closes integrate immediately without re-running initial or spawning a 5th worker.
  {
    const calls: string[] = [];
    const f = fixture({
      diagnose: async () => ({
        ...decision("Finish final remaining integration obligation"),
        work: [
          {
            title: "repair-4",
            instructions: "Finish remaining wiring",
            writes: ["web/src"],
          },
        ],
        completesStage: true,
      }),
      execute: async (work) => {
        calls.push(`execute:${work.title}`);
      },
    });
    await f.runner.run("assignment integrate", {
      initial: async () => {
        calls.push("initial");
        throw new AttemptFailure("blocked on final wiring", ["step-a"]);
      },
      continueWork: async () => {
        calls.push("continue");
      },
      scope: () => ["web/src"],
    });
    expect(calls).toEqual(["initial", "execute:repair-4"]);
  }
  // Case 2: repair-4 fixes only a precondition (completesStage: false) -> closes only the precondition and continues remaining integrate work.
  {
    const calls: string[] = [];
    const f = fixture({
      diagnose: async () => ({
        ...decision("Fix screenshot geometry precondition first"),
        work: [
          {
            title: "fix-geometry",
            instructions: "Fix helper geometry",
            writes: ["web/src"],
          },
        ],
        completesStage: false,
      }),
      execute: async (work) => {
        calls.push(`execute:${work.title}`);
      },
    });
    await f.runner.run("assignment integrate", {
      initial: async () => {
        calls.push("initial");
        throw new AttemptFailure("blocked on geometry", ["step-a"]);
      },
      continueWork: async (handoff) => {
        calls.push(`continue:${handoff.afterPrecondition ? "post" : "direct"}`);
      },
      scope: () => ["web/src"],
    });
    expect(calls).toEqual(["initial", "execute:fix-geometry", "continue:post"]);
  }
});

it("AssignmentRunner escalates stalled partial attempts with unchanged files to diagnosis", async () => {
  const f = fixture({
    observe: async () => "unchanged-tree",
    diagnose: vi.fn(async () => ({
      ...decision("Resolve underlying cause"),
      work: [{ title: "repair", instructions: "fix", writes: ["src"] }],
      completesStage: true,
    })),
  });
  let continuations = 0;
  await f.runner.run("assignment a", {
    initial: async () => {
      throw new PartialAssignment("step-1", "First partial");
    },
    continueWork: async () => {
      continuations++;
      throw new PartialAssignment(
        "step-2",
        "Second partial with no file edits",
      );
    },
    scope: () => ["src"],
  });
  expect(continuations).toBe(1);
  expect(f.ports.diagnose).toHaveBeenCalledTimes(1);
});

it("VerificationGate dispatches first-round DirectCheckRepair without diagnosis, then escalates repeated check failures", async () => {
  let runs = 0;
  const f = fixture({
    observe: async () => `tree-${runs}`,
    diagnose: vi.fn(async (_failure, _previous, floor) => ({
      ...decision("Replan after repeated check failure"),
      level: floor,
      work: [
        { title: "replan-fix", instructions: "redesign", writes: ["src"] },
      ],
    })),
  });
  await f.controller.verify("verification", async () => {
    runs++;
    if (runs <= 2) {
      throw DirectCheckRepair.from(
        "acceptance checks",
        "verify failed",
        [`check-${runs}`],
        "check:verify",
        ["src", "web/dist"],
        [],
      )!;
    }
  });
  expect(runs).toBe(3);
  expect(f.ports.diagnose).toHaveBeenCalledTimes(1);
  expect(f.ports.execute).toHaveBeenCalledTimes(2);
});

it("formatStepEvidence gives compact summaries to passing/not-run steps and preserves mid-output assertion traces for failures", () => {
  const filler = `${"ok line ".repeat(60)}\n`.repeat(20);
  const middleFailure =
    "FAIL test/web/current-plan-entry.test.tsx\nAssertionError: expected approved=false to be true\n  at web/src/components/ChatWorkspace.tsx:142\n";
  const output = formatStepEvidence(
    "00000000-0000-4000-8000-000000000001",
    [
      {
        stepId: "lint-step",
        status: "completed",
        outcome: "completed",
        exitCode: 0,
        closed: true,
        truncated: false,
        output: filler,
      },
      {
        stepId: "unit-step",
        status: "failed",
        outcome: "failed",
        exitCode: 1,
        closed: true,
        truncated: false,
        output: `${filler}${middleFailure}${filler}`,
      },
      {
        stepId: "optical-step",
        status: "not-run",
        outcome: "completed",
        exitCode: null,
        closed: true,
        truncated: false,
        output: "Stopped early after gating check failed.",
      },
    ],
    2400,
  );
  expect(Buffer.byteLength(output)).toBeLessThanOrEqual(2400);
  expect(output).toContain(
    "AssertionError: expected approved=false to be true",
  );
  expect(output).toContain("ChatWorkspace.tsx:142");
  expect(output).toContain("Not run: Stopped early");
  expect(output).toContain(
    "run 00000000-0000-4000-8000-000000000001 step unit-step",
  );
});

it("AssignmentRunner bounds consecutive direct partial continuations even when files keep changing", async () => {
  let step = 0;
  let continuations = 0;
  const f = fixture({
    observe: async () => `tree-${step}`,
    diagnose: vi.fn(async () => ({
      ...decision("Escalate repeated partials to diagnosis"),
      work: [
        { title: "diagnosed-fix", instructions: "finish", writes: ["src"] },
      ],
      completesStage: true,
    })),
  });
  await f.runner.run("assignment loop", {
    initial: async () => {
      step++;
      throw new PartialAssignment("p0", "Still working 0");
    },
    continueWork: async () => {
      continuations++;
      step++;
      throw new PartialAssignment(
        `p${continuations}`,
        `Still working ${continuations}`,
      );
    },
    scope: () => ["src"],
  });
  expect(continuations).toBe(3);
  expect(f.ports.diagnose).toHaveBeenCalledTimes(1);
});

it("AssignmentRunner skips redundant continueWork after repairing a postCheck failure", async () => {
  const calls: string[] = [];
  let linted = 0;
  const f = fixture({
    diagnose: vi.fn(async () => ({
      ...decision("Fix lint violation"),
      work: [{ title: "fix-lint", instructions: "trim file", writes: ["src"] }],
    })),
    execute: async (work) => {
      calls.push(`execute:${work.title}`);
    },
  });
  await f.runner.run("project knowledge", {
    initial: async () => {
      calls.push("initial");
    },
    continueWork: async () => {
      calls.push("continue");
    },
    postCheck: async () => {
      linted++;
      calls.push(`postCheck:${linted}`);
      if (linted === 1) throw new AttemptFailure("lint failed", ["k1"]);
    },
    scope: () => ["src"],
  });
  expect(calls).toEqual([
    "initial",
    "postCheck:1",
    "execute:fix-lint",
    "postCheck:2",
  ]);
});

it("VerificationGate calls onRepairBatchComplete only after every work item in a multi-item batch completes", async () => {
  const completedBatches: string[] = [];
  let executed = 0;
  let gateCalls = 0;
  const f = fixture({
    observe: async () => `tree-${executed}`,
    diagnose: vi.fn(async () => ({
      ...decision("Two-step architectural replan"),
      level: "replan" as const,
      work: [
        { title: "step-1", instructions: "first edit", writes: ["src"] },
        { title: "step-2", instructions: "second edit", writes: ["src"] },
      ],
    })),
    execute: async (work) => {
      executed++;
      if (work.title === "step-2" && executed === 2)
        throw new AttemptFailure("step-2 interrupted", ["r2"]);
    },
    onRepairBatchComplete: (level) => {
      completedBatches.push(level);
    },
  });
  await f.controller.verify("verification", async () => {
    gateCalls++;
    if (gateCalls === 1) throw new AttemptFailure("review failed", ["rev-1"]);
  });
  // First batch failed at step-2, so onRepairBatchComplete fired ONLY once the full replacement batch finished.
  expect(completedBatches).toEqual(["replan"]);
});

it("decodeRecoveryDecision names evidence field violations instead of misreporting valid JSON as malformed", () => {
  const step = "implementation-fixture-1234";
  const b = bounds({ evidence: [step] });
  const pattern = /evidence.*exact failed step IDs.*cause.*strategy/u;
  const reply = (evidence: unknown) =>
    JSON.stringify({
      ...decision(),
      evidence,
      work: [
        {
          title: "Finish",
          instructions: "Edit only missing behavior",
          writes: ["src"],
        },
      ],
    });
  for (const invalid of [
    [`${step}: ${"诊断说明".repeat(80)}`],
    [`${step}: failed`],
    ["other-step"],
    [],
    null,
    step,
    [null],
    Array(33).fill(step),
  ]) {
    let thrown: unknown;
    try {
      decodeRecoveryDecision(reply(invalid), b);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidDecision);
    expect((thrown as Error).message).toMatch(pattern);
    expect((thrown as Error).message).not.toContain("诊断说明");
  }
  expect(decodeRecoveryDecision(reply([step]), b).evidence).toEqual([step]);
});

it("VerificationGate delivers the field-specific evidence objection before admitting only the corrected decision", async () => {
  const step = "implementation-fixture-1234";
  const b = bounds({ evidence: [step] });
  const objections: (string | undefined)[] = [];
  let diagnoses = 0;
  let attempts = 0;
  const f = fixture({
    diagnose: vi.fn(async (_failure, _previous, _floor, objection) => {
      objections.push(objection);
      return decodeRecoveryDecision(
        JSON.stringify({
          ...decision(),
          evidence:
            ++diagnoses === 1 ? [`${step}: ${"detail ".repeat(40)}`] : [step],
          work: [
            {
              title: "Finish",
              instructions: "Edit only missing behavior",
              writes: ["src"],
            },
          ],
        }),
        b,
      );
    }),
  });
  await f.controller.verify("implementation", async () => {
    if (++attempts === 1) throw new AttemptFailure("capture failure", [step]);
  });
  expect(diagnoses).toBe(2);
  expect(objections[0]).toBeUndefined();
  expect(objections[1]).toMatch(
    /evidence.*exact failed step IDs.*cause.*strategy/u,
  );
  expect(f.records).toHaveLength(1);
  expect(f.records[0].decision.evidence).toEqual([step]);
  expect(f.ports.execute).toHaveBeenCalledTimes(1);
});

it("workflowResult and workflowResultDetail preserve JSON validity when structured step text mentions quoted token or Authorization patterns", () => {
  const payload = JSON.stringify({
    tasks: [
      {
        id: "auth-parser",
        instructions:
          'Support token="abc" and Authorization: "Bearer live-secret-value"',
      },
    ],
  });
  const stored = workflowResult(
    {
      outcome: "completed",
      closed: true,
      exitCode: 0,
      signal: null,
      durationMs: 12,
      text: payload,
      output: "",
      truncated: false,
    },
    ["live-secret-value"],
  );
  const parsedStored = JSON.parse(stored.text) as {
    tasks: { id: string; instructions: string }[];
  };
  expect(parsedStored.tasks[0].id).toBe("auth-parser");
  expect(parsedStored.tasks[0].instructions).not.toContain("live-secret-value");
  expect(parsedStored.tasks[0].instructions).toContain("[redacted]");

  const detail = workflowResultDetail(
    { stepId: "route-plan", result: stored },
    ["live-secret-value"],
  );
  const parsedDetail = JSON.parse(detail.text) as {
    stepId: string;
    result: { text: string };
  };
  const parsedAgain = JSON.parse(parsedDetail.result.text) as {
    tasks: { id: string; instructions: string }[];
  };
  expect(parsedAgain).toEqual(parsedStored);
});
