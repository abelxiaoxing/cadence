import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ChangeVerification } from "../src/change-verification.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

function resourcesFor(
  plan: ReturnType<typeof verificationFixturePlan>["plan"],
  root: string,
) {
  return {
    root,
    runId: "run",
    deliveryRevision: 1,
    plan,
    baselineRevisionId: "b".repeat(64),
    baselinePromises: new Map(),
    workspaces: {
      materializeAsync: async (_id: string, target: string) => {
        mkdirSync(target, { recursive: true });
      },
    },
  } as any;
}

it("pauses ambiguous generic failures instead of declaring a pre-existing pass or repairing unrelated code", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-attribution-"));
  const { plan } = verificationFixturePlan("attribution");
  const failure = "a".repeat(64);
  const resources: any = {
    root,
    runId: "run",
    deliveryRevision: 1,
    plan,
    workspaces: {
      materializeAsync: async (_id: string, target: string) => {
        mkdirSync(target, { recursive: true });
      },
    },
  };
  const verifier = new ChangeVerification(
    {
      verifyChange: async () => ({
        ok: false,
        kind: "verification",
        code: "verification-rejected",
        failureIdentities: [failure],
        attributionReliable: false,
      }),
    } as any,
    { run: () => resources } as any,
  );
  const baseline: any = {
    affected: [
      {
        taskId: plan.tasks[0]!.taskId,
        observation: { status: "failed", failureIdentities: [failure] },
      },
    ],
  };
  try {
    expect(
      await verifier.verifyTaskAffected({
        resources,
        baseline,
        task: plan.tasks[0]!,
        revisionId: "revision",
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "paused", code: "verification-attribution-unresolved" });
    baseline.affected[0].observation.status = "passed";
    baseline.affected[0].observation.failureIdentities = [];
    expect(
      await verifier.verifyTaskAffected({
        resources,
        baseline,
        task: plan.tasks[0]!,
        revisionId: "revision",
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ kind: "repairable", attribution: "introduced" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("does not exempt a new-test failure reported by a different baseline obligation", async () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "cadence-attribution-contract-"),
  );
  const { plan, check } = verificationFixturePlan("attribution-contract");
  plan.tasks[0]!.baselineVerification = check(
    "existing-only-baseline",
    "test/existing.mjs",
  );
  plan.tasks[0]!.affectedVerification = check(
    "existing-and-new-affected",
    "test/new-regression.mjs",
  );
  const failure = "b".repeat(64);
  const resources = resourcesFor(plan, root);
  const verifier = new ChangeVerification(
    {
      verifyChange: async () => ({
        ok: false,
        kind: "verification",
        code: "verification-rejected",
        failureIdentities: [failure],
      }),
    } as any,
    { run: () => resources } as any,
  );
  try {
    const baseline: any = {
      affected: [
        {
          taskId: plan.tasks[0]!.taskId,
          observation: {
            status: "failed",
            verificationId: "existing-only-baseline",
            failureIdentities: [failure],
            contractIdentity: "c".repeat(64),
          },
        },
      ],
    };
    expect(
      await verifier.verifyTaskAffected({
        resources,
        baseline,
        task: plan.tasks[0]!,
        revisionId: "revision",
        signal: new AbortController().signal,
      }),
    ).toEqual({
      kind: "repairable",
      attribution: "introduced",
      failureIdentities: [failure],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("reuses failure attribution when purpose metadata differs but execution semantics match", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-attribution-purpose-"));
  const { plan, check } = verificationFixturePlan("attribution-purpose");
  plan.tasks[0]!.baselineVerification = check(
    "baseline-purpose",
    "test/same-regression.mjs",
    "expected-red",
  );
  plan.tasks[0]!.affectedVerification = check(
    "affected-purpose",
    "test/same-regression.mjs",
    "expected-green",
  );
  const failure = "d".repeat(64);
  const resources = resourcesFor(plan, root);
  const facts = new Map<string, unknown>();
  const artifacts = new Map<string, Uint8Array>();
  resources.artifacts = {
    put(bytes: Uint8Array) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      artifacts.set(hash, Uint8Array.from(bytes));
      return { hash };
    },
    read(hash: string) {
      return artifacts.get(hash)!;
    },
  };
  const ledger = {
    durableFact: (key: string) => facts.get(key),
    putDurableFact: (key: string, value: unknown) => {
      facts.set(key, structuredClone(value));
      return value;
    },
  };
  const verifier = new ChangeVerification(
    {
      verifyChange: async (input: Record<string, unknown>) =>
        input.scope === "baseline-full-suite"
          ? {
              ok: true,
              exitCode: 0,
              classification: "expected-green",
              failureIdentities: [],
            }
          : {
              ok: false,
              kind: "verification",
              code: "verification-rejected",
              failureIdentities: [failure],
            },
    } as any,
    { run: () => resources } as any,
  );
  try {
    const captured = await verifier.ensureVerificationBaseline({
      resources,
      ledger: ledger as any,
      taskId: plan.tasks[0]!.taskId,
      signal: new AbortController().signal,
    });
    if (!captured.ok) throw new Error("baseline-unavailable");
    expect(captured.baseline.affected[0]!.observation.contractIdentity).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(
      await verifier.verifyTaskAffected({
        resources,
        baseline: captured.baseline,
        task: plan.tasks[0]!,
        revisionId: "revision",
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "verified", attribution: "pre-existing" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
