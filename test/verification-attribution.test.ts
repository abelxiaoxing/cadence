import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ChangeVerification } from "../src/change-verification.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

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
