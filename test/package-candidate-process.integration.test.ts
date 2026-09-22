import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifact-store.ts";
import {
  inspectCandidateArtifact,
  sealCandidateArtifact,
} from "../src/candidate-artifact.ts";
import { revisionChanges, runGitApply } from "../src/candidate-workspace.ts";
import type { DurableWorkflowEngineOptions } from "../src/durable-contracts.ts";
import type { ParentModelSource } from "../src/model-source.ts";
import { proposeProcessPackageCandidate } from "../src/package-candidate-process.ts";
import { type BeginCandidateInput, TaskLedger } from "../src/task-ledger.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  delete process.env.CADENCE_PI_EXECUTABLE;
});

type CandidateInput = Parameters<
  DurableWorkflowEngineOptions["proposeCandidate"]
>[0];

function verification() {
  return {
    kind: "static-check" as const,
    id: "candidate-process-check",
    classification: "expected-green" as const,
    runner: { kind: "node" as const, script: "check" },
    args: [],
  };
}

function task(): CandidateInput["task"] {
  const phase = {
    read: ["changed.txt", "deleted.txt"],
    write: ["changed.txt"],
    delete: ["deleted.txt"],
    verification: verification(),
    verificationInputs: [],
  };
  return {
    taskId: "task-process",
    dependsOn: [],
    objective: "Update the disposable fixture",
    context: { agents: "", contract: "approved fixture boundary" },
    roots: ["."],
    phases: { red: phase, green: phase },
    scheduling: { conflicts: [], resources: [] },
    agents: { impact: "none", managedOnly: true },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    },
    affectedVerification: verification(),
    repairVerification: verification(),
  };
}

function fakePi(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-candidate-pi-"));
  roots.push(root);
  const executable = path.join(root, "pi");
  writeFileSync(
    executable,
    `#!/bin/sh
cat >/dev/null
printf 'child-edit\\n' > "$PWD/changed.txt"
rm -f "$PWD/deleted.txt"
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"candidate prepared"}]}}'
`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

const context: ParentModelSource = {
  modelRegistry: {
    getProvider: () => undefined,
    getApiKeyAndHeaders: async () => ({ ok: false as const }),
  },
};

describe("process-backed candidate adapter", () => {
  it("captures, seals, and applies child edits and deletions exactly once", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-candidate-root-"));
    roots.push(root);
    const workspace = path.join(root, "proposal");
    const ledgerRoot = path.join(root, "ledger");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "changed.txt"), "baseline\n");
    writeFileSync(path.join(workspace, "deleted.txt"), "remove me\n");

    const executable = fakePi();
    process.env.CADENCE_PI_EXECUTABLE = executable;
    const artifacts = new ArtifactStore(path.join(ledgerRoot, "artifacts"));
    const ledger = new TaskLedger({ root: ledgerRoot, artifacts });
    const identity: BeginCandidateInput = {
      candidateId: "candidate-process",
      runId: "run-process",
      deliveryRevision: 1,
      taskId: "task-process",
      phase: "green",
      attemptId: "attempt-process",
      approvedPaths: ["changed.txt", "deleted.txt"],
      isolatedRevisionId: "a".repeat(64),
      verificationId: "candidate-process-check",
      routeId: "pi-process",
      routeFingerprint: "b".repeat(64),
    };
    const input = {
      runId: "run-process",
      operationId: "operation-process",
      deliveryRevision: 1,
      taskId: "task-process",
      phase: "green" as const,
      task: task(),
      workspaceRoot: workspace,
      ledgerProjection: {},
      candidateArtifact: {
        ledger,
        identity,
        workspaceRoot: workspace,
        writePaths: ["changed.txt"],
        deletePaths: ["deleted.txt"],
      },
      signal: new AbortController().signal,
      onHeaders: () => undefined,
      onProgress: () => undefined,
    } as unknown as CandidateInput;

    try {
      const proposal = await proposeProcessPackageCandidate(input, context, {
        content: "implementation fixture",
      });
      expect(proposal.kind).toBe("candidate");
      if (proposal.kind !== "candidate") throw new Error("candidate-missing");

      // The adapter restores the proposal root before returning. This is the
      // parent-side invariant that prevents applying the generated patch twice.
      expect(readFileSync(path.join(workspace, "changed.txt"), "utf8")).toBe(
        "baseline\n",
      );
      expect(existsSync(path.join(workspace, "deleted.txt"))).toBe(true);

      const inspected = inspectCandidateArtifact({
        ledger,
        identity,
        proposal,
        approvedPaths: identity.approvedPaths,
      });
      expect(inspected).toMatchObject({
        ok: true,
        paths: ["changed.txt", "deleted.txt"],
      });
      if (!inspected.ok) throw new Error("candidate-inspection-failed");
      const signal = new AbortController().signal;
      expect(await runGitApply(workspace, inspected.bytes, true, signal)).toBe(
        "ok",
      );
      expect(await runGitApply(workspace, inspected.bytes, false, signal)).toBe(
        "ok",
      );
      expect(readFileSync(path.join(workspace, "changed.txt"), "utf8")).toBe(
        "child-edit\n",
      );
      expect(existsSync(path.join(workspace, "deleted.txt"))).toBe(false);

      const sealed = sealCandidateArtifact({
        ledger,
        identity,
        proposal,
        bytes: inspected.bytes,
      });
      expect(sealed).toMatchObject({ ok: true });
      expect(revisionChanges(workspace, identity.approvedPaths)).toEqual({
        "changed.txt": {
          kind: "file",
          bytes: Buffer.from("child-edit\n"),
          mode: expect.any(Number),
        },
        "deleted.txt": { kind: "absent" },
      });
    } finally {
      ledger.close();
    }
  });
});
