import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  ChangeVerification,
  verificationBaselineFact,
} from "../src/change-verification.ts";
import type { ImplementPlan } from "../src/delivery-compiler.ts";
import { hash } from "../src/workflow-policy.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

function harness(
  plan: ImplementPlan,
  verifyChange: (
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
  verificationOptions: Record<string, unknown> = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-task-baseline-"));
  const baselineRevisionId = "b".repeat(64);
  const currentRevisionId = "c".repeat(64);
  const facts = new Map<string, unknown>();
  const artifacts = new Map<string, Uint8Array>();
  const materialized: string[] = [];
  const resources: any = {
    root,
    runId: "run",
    deliveryRevision: 1,
    plan,
    baselineRevisionId,
    currentRevisionId,
    baselinePromises: new Map(),
    artifacts: {
      put(bytes: Uint8Array) {
        const hash = createHash("sha256").update(bytes).digest("hex");
        artifacts.set(hash, Uint8Array.from(bytes));
        return { hash };
      },
      read(hash: string) {
        const bytes = artifacts.get(hash);
        if (!bytes) throw new Error("artifact-missing");
        return bytes;
      },
    },
    workspaces: {
      materializeAsync: async (revisionId: string, target: string) => {
        materialized.push(revisionId);
        mkdirSync(target, { recursive: true });
      },
      getRevision: (revisionId: string) => ({
        revisionId,
        parentRevisionId: null,
        entries: {},
      }),
    },
  };
  const createLedger = (ledgerFacts = new Map<string, unknown>()) => ({
    facts: ledgerFacts,
    ledger: {
      durableFact: (key: string) => ledgerFacts.get(key),
      putDurableFact: (key: string, value: unknown) => {
        if (
          ledgerFacts.has(key) &&
          JSON.stringify(ledgerFacts.get(key)) !== JSON.stringify(value)
        )
          throw new Error("ledger-fact-conflict");
        ledgerFacts.set(key, structuredClone(value));
        return value;
      },
    },
  });
  const ledger = createLedger(facts).ledger;
  resources.baselineLedger = ledger;
  const services = {
    prepareResources: async () => resources,
    ledger: () => ledger,
    revalidatePhasePolicy: async () => undefined,
    run: () => resources,
  } as any;
  const openVerifier = () =>
    new ChangeVerification(
      { verifyChange, ...verificationOptions } as any,
      services,
    );
  const verifier = openVerifier();
  return {
    root,
    resources,
    ledger,
    verifier,
    materialized,
    facts,
    baselineRevisionId,
    currentRevisionId,
    openVerifier,
    createLedger,
  };
}

function twoTaskPlan(): ImplementPlan {
  const { plan, check } = verificationFixturePlan("lazy-task-baseline");
  plan.tasks[0]!.baselineVerification = check(
    "task-one-baseline",
    "test/existing-one.mjs",
  );
  const second = structuredClone(plan.tasks[0]!);
  second.taskId = "second-task";
  second.objective = "Verify the independent second task";
  second.context.contract = "approved second task fixture";
  second.scheduling.resources = ["second-value"];
  second.baselineVerification = check(
    "task-two-baseline",
    "test/existing-two.mjs",
  );
  second.affectedVerification = check("task-two-affected", "test/new-two.mjs");
  second.repairVerification = check("task-two-repair", "test/new-two.mjs");
  plan.tasks.push(second);
  plan.tracking.taskIds.push(second.taskId);
  return plan;
}

it("captures only the requested task baseline, retains sibling successes, and fills the final baseline lazily", async () => {
  const plan = twoTaskPlan();
  const calls: Array<{
    scope: string;
    taskId?: string;
    verificationId: string;
  }> = [];
  let secondUnavailable = true;
  let environmentIdentity = "1".repeat(64);
  const value = harness(
    plan,
    async (input) => {
      const verification = input.verification as { id: string };
      calls.push({
        scope: String(input.scope),
        ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
        verificationId: verification.id,
      });
      if (
        input.scope === "baseline-task-affected" &&
        input.taskId === "second-task" &&
        secondUnavailable
      ) {
        return {
          ok: false,
          kind: "verification-adapter",
          code: "runner-missing",
          inputObservation: {
            path: "test/untrusted-message.mjs",
            kind: "unsafe",
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        classification: "expected-green",
        failureIdentities: [],
      };
    },
    { verificationEnvironment: async () => environmentIdentity },
  );
  try {
    value.resources.originalBaselineRevisionId = "a".repeat(64);
    value.resources.workspaces.materializeAsync = async (
      revisionId: string,
      target: string,
    ) => {
      value.materialized.push(revisionId);
      mkdirSync(path.join(target, "test"), { recursive: true });
      for (const name of ["existing-one.mjs", "existing-two.mjs", "health.mjs"])
        writeFileSync(path.join(target, "test", name), "// existing\n");
    };
    const first = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      taskId: "real-task",
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      ok: true,
      baseline: { affected: [{ taskId: "real-task" }] },
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "baseline-task-affected",
          taskId: "real-task",
          verificationId: "task-one-baseline",
        }),
        expect.objectContaining({
          scope: "baseline-full-suite",
          verificationId: "real-baseline",
        }),
      ]),
    );
    expect(calls.some((call) => call.taskId === "second-task")).toBe(false);

    const failed = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      taskId: "second-task",
      signal: new AbortController().signal,
    });
    expect(failed).toMatchObject({
      ok: false,
      outcome: {
        code: "runner-missing",
        prerequisite: {
          kind: "verification-prerequisite",
          scope: "baseline-task-affected",
          cause: "capability",
          taskId: "second-task",
          verificationId: "task-two-baseline",
          originalRevisionId: "a".repeat(64),
          environmentIdentity: "1".repeat(64),
        },
      },
    });
    const afterFailure = calls.length;
    value.resources.baselinePromises = new Map();
    const reopened = value.openVerifier();
    await expect(
      reopened.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "second-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(failed);
    expect(calls).toHaveLength(afterFailure);
    plan.tasks[1]!.baselineVerification!.id = "renamed-task-two-baseline";
    value.resources.baselinePromises = new Map();
    await expect(
      value.openVerifier().ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "second-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      outcome: {
        code: "runner-missing",
        prerequisite: { verificationId: "renamed-task-two-baseline" },
      },
    });
    expect(calls).toHaveLength(afterFailure);
    value.resources.baselinePromises.clear();
    await expect(
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(calls).toHaveLength(afterFailure);

    environmentIdentity = "2".repeat(64);
    secondUnavailable = false;
    await expect(
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "second-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    const beforeFinal = calls.length;
    const complete = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      signal: new AbortController().signal,
    });
    expect(complete).toMatchObject({
      ok: true,
      baseline: {
        affected: [{ taskId: "real-task" }, { taskId: "second-task" }],
      },
    });
    expect(calls).toHaveLength(beforeFinal + 1);
    const afterFinal = calls.length;
    value.resources.baselinePromises.clear();
    await expect(
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(calls).toHaveLength(afterFinal);
    expect(
      calls.filter((call) => call.scope === "baseline-full-suite"),
    ).toHaveLength(2);
    expect(
      calls.filter(
        (call) =>
          call.scope === "baseline-task-affected" &&
          call.taskId === "real-task",
      ),
    ).toHaveLength(2);
    expect(
      calls.filter(
        (call) =>
          call.scope === "baseline-task-affected" &&
          call.taskId === "second-task",
      ),
    ).toHaveLength(2);
    expect(value.materialized).toEqual(
      Array(value.materialized.length).fill("a".repeat(64)),
    );
    expect(value.facts.size).toBeGreaterThanOrEqual(3);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("reuses a failed baseline across delivery ledgers and task renames", async () => {
  const plan = twoTaskPlan();
  plan.tasks = [plan.tasks[0]!];
  plan.tracking.taskIds = [plan.tasks[0]!.taskId];
  plan.outputs = [
    {
      id: "future-baseline-input",
      path: "test/existing-one.mjs",
      producer: { taskId: plan.tasks[0]!.taskId, phase: "red" },
      postcondition: "regular-file",
    },
  ];
  const calls: string[] = [];
  const value = harness(plan, async (input) => {
    calls.push(String(input.scope));
    if (input.scope === "baseline-task-affected") {
      return {
        ok: false,
        kind: "verification-adapter",
        code: "runner-missing",
      };
    }
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    const first = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      taskId: "real-task",
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      ok: false,
      outcome: {
        prerequisite: {
          taskId: "real-task",
          verificationId: "task-one-baseline",
          producer: { taskId: "real-task", phase: "red" },
        },
      },
    });

    const renamed = plan.tasks[0]!;
    renamed.taskId = "renamed-task";
    renamed.baselineVerification!.id = "renamed-task-baseline";
    plan.tracking.taskIds = [renamed.taskId];
    plan.outputs[0]!.producer.taskId = renamed.taskId;
    value.resources.deliveryRevision = 2;
    value.resources.baselinePromises.clear();
    const revisionTwo = value.createLedger();
    const replayed = await value.openVerifier().ensureVerificationBaseline({
      resources: value.resources,
      ledger: revisionTwo.ledger as any,
      taskId: renamed.taskId,
      signal: new AbortController().signal,
    });

    expect(replayed).toMatchObject({
      ok: false,
      outcome: {
        prerequisite: {
          taskId: "renamed-task",
          verificationId: "renamed-task-baseline",
          producer: { taskId: "renamed-task", phase: "red" },
        },
      },
    });
    expect(calls).toEqual(["baseline-task-affected", "baseline-full-suite"]);
    expect(revisionTwo.facts.size).toBe(0);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it.each(["passed", "paused"] as const)(
  "reprojects concurrent shared baseline %s results for each task",
  async (outcome) => {
    const plan = twoTaskPlan();
    plan.tasks[1]!.baselineVerification = structuredClone(
      plan.tasks[0]!.baselineVerification,
    );
    plan.tasks[1]!.baselineVerification!.id = "task-two-baseline";
    const calls: string[] = [];
    const value = harness(plan, async (input) => {
      calls.push(String(input.scope));
      if (input.scope === "baseline-task-affected" && outcome === "paused") {
        return {
          ok: false,
          kind: "verification-adapter",
          code: "runner-missing",
        };
      }
      return {
        ok: true,
        exitCode: 0,
        classification: "expected-green",
        failureIdentities: [],
      };
    });
    try {
      const [first, second] = await Promise.all([
        value.verifier.ensureVerificationBaseline({
          resources: value.resources,
          ledger: value.ledger as any,
          taskId: "real-task",
          signal: new AbortController().signal,
        }),
        value.verifier.ensureVerificationBaseline({
          resources: value.resources,
          ledger: value.ledger as any,
          taskId: "second-task",
          signal: new AbortController().signal,
        }),
      ]);
      if (outcome === "passed") {
        expect(first).toMatchObject({
          ok: true,
          baseline: {
            affected: [
              {
                taskId: "real-task",
                observation: { verificationId: "task-one-baseline" },
              },
            ],
          },
        });
        expect(second).toMatchObject({
          ok: true,
          baseline: {
            affected: [
              {
                taskId: "second-task",
                observation: { verificationId: "task-two-baseline" },
              },
            ],
          },
        });
      } else {
        expect(first).toMatchObject({
          ok: false,
          outcome: {
            prerequisite: {
              taskId: "real-task",
              verificationId: "task-one-baseline",
            },
          },
        });
        expect(second).toMatchObject({
          ok: false,
          outcome: {
            prerequisite: {
              taskId: "second-task",
              verificationId: "task-two-baseline",
            },
          },
        });
      }
      expect(
        calls.filter((scope) => scope === "baseline-task-affected"),
      ).toHaveLength(1);
      expect(
        calls.filter((scope) => scope === "baseline-full-suite"),
      ).toHaveLength(1);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  },
);

it("does not share baseline ownership across distinct task phase boundaries", async () => {
  const plan = twoTaskPlan();
  plan.tasks[1]!.baselineVerification = structuredClone(
    plan.tasks[0]!.baselineVerification,
  );
  plan.tasks[1]!.baselineVerification!.id = "task-two-baseline";
  for (const boundary of Object.values(plan.tasks[1]!.phases)) {
    boundary.read = boundary.read.map((entry) =>
      entry === "value.txt" ? "second-value.txt" : entry,
    );
    boundary.write = boundary.write.map((entry) =>
      entry === "value.txt" ? "second-value.txt" : entry,
    );
  }
  const calls: string[] = [];
  const value = harness(plan, async (input) => {
    calls.push(String(input.scope));
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    const [first, second] = await Promise.all([
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "second-task",
        signal: new AbortController().signal,
      }),
    ]);
    expect(first).toMatchObject({
      ok: true,
      baseline: { affected: [{ taskId: "real-task" }] },
    });
    expect(second).toMatchObject({
      ok: true,
      baseline: { affected: [{ taskId: "second-task" }] },
    });
    expect(
      calls.filter((scope) => scope === "baseline-task-affected"),
    ).toHaveLength(2);
    expect(
      calls.filter((scope) => scope === "baseline-full-suite"),
    ).toHaveLength(1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("reads an unchanged legacy baseline failure without rewriting it", async () => {
  const plan = twoTaskPlan();
  plan.tasks = [plan.tasks[0]!];
  plan.tracking.taskIds = [plan.tasks[0]!.taskId];
  let verifierCalls = 0;
  const value = harness(plan, async (input) => {
    if (input.scope === "baseline-task-affected") {
      verifierCalls += 1;
      return {
        ok: false,
        kind: "verification-adapter",
        code: "runner-missing",
      };
    }
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    const first = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      taskId: "real-task",
      signal: new AbortController().signal,
    });
    if (first.ok) throw new Error("baseline failure unavailable");
    if (first.outcome.kind !== "paused" || !first.outcome.prerequisite)
      throw new Error("baseline prerequisite unavailable");
    const [newKey] = [...value.facts].find(([key]) =>
      key.startsWith("verification-baseline-failure-"),
    )!;
    const prerequisite = first.outcome.prerequisite;
    const legacyKey = `verification-baseline-failure-${hash(
      prerequisite.originalRevisionId,
      prerequisite.contractIdentity,
      prerequisite.scope,
      prerequisite.taskId!,
      prerequisite.environmentIdentity,
      "legacy",
    ).slice(0, 40)}`;
    value.facts.delete(newKey);
    const revisionTwo = value.createLedger();
    revisionTwo.facts.set(legacyKey, {
      kind: "baseline-observation-failure-v1",
      policyIdentity: hash("verification-failure-policy-v1", "legacy"),
      code: first.outcome.code,
      prerequisite,
    });
    const before = structuredClone({
      baseline: [...value.facts],
      revisionTwo: [...revisionTwo.facts],
    });
    value.resources.deliveryRevision = 2;
    value.resources.baselinePromises.clear();

    await expect(
      value.openVerifier().ensureVerificationBaseline({
        resources: value.resources,
        ledger: revisionTwo.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(first);
    expect(verifierCalls).toBe(1);
    expect({
      baseline: [...value.facts],
      revisionTwo: [...revisionTwo.facts],
    }).toEqual(before);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("derives baseline prerequisite causes only from the materialized original inputs", async () => {
  const cases = [
    {
      label: "future",
      path: "test/future.mjs",
      code: "runner-missing",
      cause: "future-output",
      materialized: "absent",
      output: true,
      expected: {
        input: { path: "test/future.mjs", kind: "absent" },
        producer: { taskId: "real-task", phase: "red" },
      },
    },
    {
      label: "missing",
      path: "test/missing.mjs",
      code: "runner-missing",
      cause: "missing-input",
      materialized: "absent",
      output: false,
      expected: { input: { path: "test/missing.mjs", kind: "absent" } },
    },
    {
      label: "unsafe",
      path: "test/unsafe.mjs",
      code: "runner-missing",
      cause: "unsafe-input",
      materialized: "unsafe",
      output: true,
      expected: { input: { path: "test/unsafe.mjs", kind: "unsafe" } },
    },
    {
      label: "unknown",
      path: "test/safe.mjs",
      code: "unclassified-runtime-failure",
      cause: "unknown",
      materialized: "file",
      output: false,
      expected: {},
    },
    {
      label: "sandbox",
      path: "test/safe.mjs",
      code: "sandbox-runtime-unavailable",
      cause: "capability",
      materialized: "file",
      output: false,
      expected: {},
    },
  ] as const;
  for (const fixture of cases) {
    const { plan, check } = verificationFixturePlan(
      `baseline-prerequisite-${fixture.label}`,
    );
    plan.tasks[0]!.baselineVerification = check(
      `baseline-${fixture.label}`,
      fixture.path,
    );
    plan.outputs = fixture.output
      ? [
          {
            id: `${fixture.label}-output`,
            path: fixture.path,
            producer: { taskId: "real-task", phase: "red" },
            postcondition: "regular-file",
          },
        ]
      : [];
    let verifierCalls = 0;
    const value = harness(plan, async (input) => {
      if (input.scope === "baseline-task-affected") {
        verifierCalls += 1;
        return {
          ok: false,
          kind: "environment",
          code: fixture.code,
          inputObservation: {
            path: "test/untrusted-message.mjs",
            kind: fixture.materialized === "file" ? "absent" : "unsafe",
          },
        };
      }
      return {
        ok: true,
        exitCode: 0,
        classification: "expected-green",
        failureIdentities: [],
      };
    });
    value.resources.workspaces.materializeAsync = async (
      _revisionId: string,
      target: string,
    ) => {
      mkdirSync(path.join(target, "test"), { recursive: true });
      if (fixture.materialized === "file") {
        writeFileSync(path.join(target, fixture.path), "// safe input\n");
      } else if (fixture.materialized === "unsafe") {
        symlinkSync("outside.mjs", path.join(target, fixture.path));
      }
    };
    try {
      const result = await value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        ok: false,
        outcome: {
          code: fixture.code,
          prerequisite: {
            kind: "verification-prerequisite",
            scope: "baseline-task-affected",
            cause: fixture.cause,
            taskId: "real-task",
            verificationId: `baseline-${fixture.label}`,
            originalRevisionId: value.baselineRevisionId,
            environmentIdentity: "unobserved",
            ...fixture.expected,
          },
        },
      });
      value.resources.baselinePromises.clear();
      await expect(
        value.openVerifier().ensureVerificationBaseline({
          resources: value.resources,
          ledger: value.ledger as any,
          taskId: "real-task",
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(result);
      expect(verifierCalls).toBe(1);
      if (fixture.label === "unknown") {
        const failureKey = [...value.facts.keys()].find((key) =>
          key.startsWith("verification-baseline-failure-"),
        );
        if (!failureKey) throw new Error("failure-fact-missing");
        const malformed = structuredClone(value.facts.get(failureKey)) as any;
        if (malformed.kind === "baseline-observation-failure-v1") {
          malformed.prerequisite.originalRevisionId = "f".repeat(64);
        } else {
          malformed.originalRevisionId = "f".repeat(64);
        }
        value.facts.set(failureKey, malformed);
        value.resources.baselinePromises.clear();
        await expect(
          value.openVerifier().ensureVerificationBaseline({
            resources: value.resources,
            ledger: value.ledger as any,
            taskId: "real-task",
            signal: new AbortController().signal,
          }),
        ).rejects.toThrow("workflow-verification-baseline-failure-invalid");
        expect(verifierCalls).toBe(1);
      }
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  }
});

it("does not exempt a cumulative new-test failure from a different full-suite baseline", async () => {
  const { plan, check } = verificationFixturePlan(
    "cumulative-new-test-attribution",
  );
  plan.tasks[0]!.baselineVerification = check(
    "task-existing-baseline",
    "test/existing.mjs",
  );
  plan.verification.baseline.fullSuite = check(
    "existing-full-baseline",
    "test/existing.mjs",
  );
  plan.verification.change.fullSuite = check(
    "new-test-cumulative",
    "test/new-regression.mjs",
  );
  const failure = "e".repeat(64);
  const value = harness(plan, async (input) => {
    if (
      input.scope === "baseline-full-suite" ||
      input.scope === "change-full-suite"
    ) {
      return {
        ok: false,
        kind: "verification",
        code: "verification-rejected",
        failureIdentities: [failure],
      };
    }
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    await expect(
      value.verifier.verify({
        runId: "run",
        deliveryRevision: 1,
        plan,
        currentWorkspaceRevisionId: value.currentRevisionId,
        baselineRevisionId: value.baselineRevisionId,
        taskEvidence: [],
        signal: new AbortController().signal,
      } as any),
    ).resolves.toMatchObject({
      kind: "paused",
      code: "verification-attribution-unresolved",
      verification: {
        scope: "change-full-suite",
        attribution: "unresolved",
        failureIdentities: [failure],
      },
    });
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("coalesces concurrent requests for the same owned baseline observation", async () => {
  const plan = twoTaskPlan();
  const calls: Array<{ scope: string; verificationId: string }> = [];
  const failure = "a".repeat(64);
  const value = harness(plan, async (input) => {
    const verification = input.verification as { id: string };
    calls.push({ scope: String(input.scope), verificationId: verification.id });
    if (input.scope === "baseline-task-affected") {
      return {
        ok: false,
        kind: "verification",
        code: "verification-rejected",
        failureIdentities: [failure],
      };
    }
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    const [first, second] = await Promise.all([
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
    ]);
    expect(first).toMatchObject({
      ok: true,
      baseline: { affected: [{ taskId: "real-task" }] },
    });
    expect(second).toMatchObject({
      ok: true,
      baseline: { affected: [{ taskId: "real-task" }] },
    });
    expect(
      calls.filter((call) => call.scope === "baseline-task-affected"),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.scope === "baseline-full-suite"),
    ).toHaveLength(1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("recaptures readable legacy evidence that lacks a comparable contract identity", async () => {
  const plan = twoTaskPlan();
  const calls: string[] = [];
  const value = harness(plan, async (input) => {
    calls.push(String(input.scope));
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    value.ledger.putDurableFact(
      "verification-baseline",
      verificationBaselineFact(
        {
          revisionId: value.baselineRevisionId,
          targetContracts: [],
          affected: plan.tasks.map((task) => ({
            taskId: task.taskId,
            observation: {
              status: "passed",
              verificationId: (
                task.baselineVerification ?? task.affectedVerification
              ).id,
              failureIdentities: [],
            },
          })),
          fullSuite: {
            status: "passed",
            verificationId: plan.verification.baseline.fullSuite.id,
            failureIdentities: [],
          },
        },
        value.resources.artifacts,
      ),
    );
    await expect(
      value.verifier.ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        taskId: "real-task",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(calls.sort()).toEqual(
      ["baseline-full-suite", "baseline-task-affected"].sort(),
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("settles every launched observation before propagating an unexpected capture error", async () => {
  const plan = twoTaskPlan();
  const value = harness(plan, async () => ({
    ok: true,
    exitCode: 0,
    classification: "expected-green",
    failureIdentities: [],
  }));
  let materializations = 0;
  let releaseSlow: (() => void) | undefined;
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  value.resources.workspaces.materializeAsync = async (
    _revisionId: string,
    target: string,
  ) => {
    materializations += 1;
    mkdirSync(target, { recursive: true });
    if (materializations === 2) throw new Error("synthetic-materialize-error");
    await slow;
  };
  try {
    let rejected = false;
    const pending = value.verifier
      .ensureVerificationBaseline({
        resources: value.resources,
        ledger: value.ledger as any,
        signal: new AbortController().signal,
      })
      .catch((error: unknown) => {
        rejected = true;
        throw error;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(materializations).toBe(3);
    expect(rejected).toBe(false);
    releaseSlow?.();
    await expect(pending).rejects.toThrow("synthetic-materialize-error");
  } finally {
    releaseSlow?.();
    rmSync(value.root, { recursive: true, force: true });
  }
});

it("keeps a new test in task affected, cumulative, and post-apply verification", async () => {
  const { plan, check } = verificationFixturePlan("new-test-retained");
  plan.tasks[0]!.baselineVerification = check(
    "existing-regression-baseline",
    "test/existing.mjs",
  );
  plan.tasks[0]!.affectedVerification = check(
    "new-regression-affected",
    "test/new-regression.mjs",
  );
  plan.verification.change.fullSuite = check(
    "new-regression-cumulative",
    "test/new-regression.mjs",
  );
  plan.verification.change.postApply = check(
    "new-regression-post-apply",
    "test/new-regression.mjs",
  );
  const calls: Array<{ scope: string; script: string }> = [];
  const value = harness(plan, async (input) => {
    const verification = input.verification as {
      runner: { script: string };
    };
    calls.push({
      scope: String(input.scope),
      script: verification.runner.script,
    });
    return {
      ok: true,
      exitCode: 0,
      classification: "expected-green",
      failureIdentities: [],
    };
  });
  try {
    const captured = await value.verifier.ensureVerificationBaseline({
      resources: value.resources,
      ledger: value.ledger as any,
      taskId: "real-task",
      signal: new AbortController().signal,
    });
    if (!captured.ok) throw new Error("baseline-unavailable");
    await expect(
      value.verifier.verifyTaskAffected({
        resources: value.resources,
        baseline: captured.baseline,
        task: plan.tasks[0]!,
        revisionId: value.currentRevisionId,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ kind: "verified" });
    await expect(
      value.verifier.verify({
        runId: "run",
        deliveryRevision: 1,
        plan,
        currentWorkspaceRevisionId: value.currentRevisionId,
        baselineRevisionId: value.baselineRevisionId,
        taskEvidence: [],
        signal: new AbortController().signal,
      } as any),
    ).resolves.toMatchObject({ kind: "verified" });
    await expect(
      value.verifier.verifyPostApply(
        value.resources,
        value.root,
        new AbortController().signal,
        "transaction",
      ),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual(
      expect.arrayContaining([
        { scope: "baseline-task-affected", script: "test/existing.mjs" },
        { scope: "task-affected", script: "test/new-regression.mjs" },
        {
          scope: "change-task-affected",
          script: "test/new-regression.mjs",
        },
        { scope: "change-full-suite", script: "test/new-regression.mjs" },
        { scope: "post-apply", script: "test/new-regression.mjs" },
      ]),
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
