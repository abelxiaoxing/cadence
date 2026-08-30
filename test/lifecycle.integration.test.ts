import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import { WorkflowEngine } from "../src/workflow-engine.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function workflowExpectedGreen(id: string) {
  return {
    kind: "package-script" as const,
    id,
    packageManager: "bun" as const,
    script: "check",
    command: 'node -e ""',
    args: [],
    classification: "expected-green" as const,
  };
}

function workflowPlanContracts(taskIds: string[]) {
  return {
    verification: {
      baseline: {
        target: "task-red-contracts" as const,
        affected: "task-affected-contracts" as const,
        fullSuite: workflowExpectedGreen("lifecycle-baseline-full"),
        failureIdentity: "normalized-v1" as const,
      },
      change: {
        affected: "task-affected-contracts" as const,
        fullSuite: workflowExpectedGreen("lifecycle-change-full"),
        postApply: workflowExpectedGreen("lifecycle-post-apply"),
      },
      artifactCorrection: { maxAttempts: 2 },
      repair: {
        maxAttempts: 2,
        inBoundaryOnly: true as const,
        approvalOnBoundaryExpansion: true as const,
        attribution: [
          "pre-existing",
          "introduced",
          "unresolved",
          "environment",
        ] as ["pre-existing", "introduced", "unresolved", "environment"],
      },
      agentsCheckpoint: {
        required: false as const,
        verification: null,
        operations: [],
      },
    },
    tracking: {
      path: "tasks.md" as const,
      format: "markdown-checkbox" as const,
      taskIds,
      completionOwner: "parent" as const,
    },
  };
}

function makeRoot(tag: string): string {
  const cwd = mkdtempSync(join(tmpdir(), `abel-lifecycle-${tag}-`));
  roots.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd });
  writeFileSync(join(cwd, "a.txt"), "old\n");
  mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
  mkdirSync(join(cwd, "test"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "node" },
    })}\n`,
  );
  writeFileSync(join(cwd, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(cwd, "test/expected-red.mjs"),
    'console.error("[LIFECYCLE:expected-red]\\nTests 1 failed");\nprocess.exit(1);\n',
  );
  writeFileSync(join(cwd, "node_modules/.bin/vitest"), "#!/bin/sh\n");
  chmodSync(join(cwd, "node_modules/.bin/vitest"), 0o755);
  execFileSync("git", ["add", "a.txt"], { cwd });
  execFileSync("git", ["commit", "-qm", "base"], { cwd });
  return cwd;
}
describe("durable WorkflowEngine scheduling", () => {
  it("runs independent ready tasks concurrently", async () => {
    const consumerRoot = makeRoot("durable-independent-tasks");
    mkdirSync(join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { check: 'node -e ""' } })}\n`,
    );
    writeFileSync(join(consumerRoot, "test/fixture.mjs"), "export {};\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const xdgStateHome = mkdtempSync(
      join(tmpdir(), "abel-lifecycle-parallel-state-"),
    );
    const homeDir = mkdtempSync(
      join(tmpdir(), "abel-lifecycle-parallel-home-"),
    );
    roots.push(xdgStateHome, homeDir);
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome,
      homeDir,
    });
    const phase = (taskId: string, name: "red" | "green") => ({
      read: ["package.json", "test/fixture.mjs"],
      write: [`${taskId}.txt`],
      delete: [],
      verification: {
        kind: "static-check" as const,
        id: `${taskId}-${name}`,
        runner: { kind: "node" as const, script: "test/fixture.mjs" },
        args: [],
        classification:
          name === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        ...(name === "red" ? { expectedFailure: "parallel-red" } : {}),
      },
      verificationInputs: [
        { kind: "workspace" as const, path: "test/fixture.mjs" },
      ],
      verificationLock: `${taskId}-verification`,
    });
    const task = (taskId: string) => ({
      taskId,
      dependsOn: [],
      objective: `Complete ${taskId}`,
      context: { agents: "root", contract: `approved ${taskId}` },
      roots: ["."],
      phases: {
        red: phase(taskId, "red"),
        green: phase(taskId, "green"),
      },
      scheduling: { conflicts: [], resources: [`resource-${taskId}`] },
      agents: { impact: "none" as const, managedOnly: true as const },
      approvedDependencies: [],
      impactClosure: {
        changedSurfaces: ["none" as const],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: ["test/fixture.mjs"],
      },
      affectedVerification: workflowExpectedGreen(`${taskId}-affected`),
      repairVerification: workflowExpectedGreen(`${taskId}-repair`),
    });
    const change = "durable-independent-tasks";
    const plan = {
      schemaVersion: 3 as const,
      changeId: change,
      tasks: [task("parallel-a"), task("parallel-b")],
      outputs: [],
      ...workflowPlanContracts(["parallel-a", "parallel-b"]),
    };
    let active = 0;
    let maximumActive = 0;
    const worker = {
      runAttempt: vi.fn(async ({ phase: currentPhase }: { phase: string }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          kind: "phase-committed" as const,
          artifactHash: "a".repeat(64),
          isolatedRevisionId: "b".repeat(64),
          exitCode: currentPhase === "red" ? 1 : 0,
          classification:
            currentPhase === "red"
              ? ("expected-red" as const)
              : ("expected-green" as const),
        };
      }),
      rebind: vi.fn(() => ({ ok: true as const, routeId: "inherited" })),
    };
    const engine = WorkflowEngine.open({
      consumerRoot,
      stateRoot,
      deliverySource: {
        load: vi.fn(async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "a".repeat(64),
          plan,
        })),
      },
      worker,
      changeVerifier: {
        verify: vi.fn(async () => ({
          kind: "paused" as const,
          code: "change-verification-held",
        })),
      },
    });

    try {
      await expect(
        engine.execute({
          command: "start",
          stage: "abel-implement",
          change,
          operationId: "parallel-start",
        }),
      ).resolves.toMatchObject({
        state: "paused",
        completed: false,
        pause: { code: "change-verification-held" },
      });
      expect(maximumActive).toBe(2);
    } finally {
      await engine.close();
    }
  });

  it("recovers an uncommitted running operation as an interrupted task", async () => {
    const consumerRoot = makeRoot("durable-interrupted-operation");
    mkdirSync(join(consumerRoot, "test"), { recursive: true });
    writeFileSync(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({ scripts: { check: 'node -e ""' } })}\n`,
    );
    writeFileSync(join(consumerRoot, "test/fixture.mjs"), "export {};\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const xdgStateHome = mkdtempSync(
      join(tmpdir(), "abel-lifecycle-interrupted-state-"),
    );
    const homeDir = mkdtempSync(
      join(tmpdir(), "abel-lifecycle-interrupted-home-"),
    );
    roots.push(xdgStateHome, homeDir);
    const stateRoot = resolveStateRoot({
      consumerRoot,
      xdgStateHome,
      homeDir,
    });
    const change = "durable-interrupted-operation";
    const phase = (name: "red" | "green") => ({
      read: ["package.json", "test/fixture.mjs"],
      write: ["interrupted.txt"],
      delete: [],
      verification: {
        kind: "static-check" as const,
        id: `interrupted-${name}`,
        runner: { kind: "node" as const, script: "test/fixture.mjs" },
        args: [],
        classification:
          name === "red"
            ? ("expected-red" as const)
            : ("expected-green" as const),
        ...(name === "red" ? { expectedFailure: "interrupted-red" } : {}),
      },
      verificationInputs: [
        { kind: "workspace" as const, path: "test/fixture.mjs" },
      ],
    });
    const plan = {
      schemaVersion: 3 as const,
      changeId: change,
      tasks: [
        {
          taskId: "interrupted-task",
          dependsOn: [],
          objective: "Recover the interrupted task",
          context: { agents: "root", contract: "approved interrupted task" },
          roots: ["."],
          phases: { red: phase("red"), green: phase("green") },
          scheduling: { conflicts: [], resources: [] },
          agents: { impact: "none" as const, managedOnly: true as const },
          approvedDependencies: [],
          impactClosure: {
            changedSurfaces: ["none" as const],
            searchEvidence: [],
            relatedTests: [],
            affectedSuite: ["test/fixture.mjs"],
          },
          affectedVerification: workflowExpectedGreen(
            "interrupted-task-affected",
          ),
          repairVerification: workflowExpectedGreen("interrupted-task-repair"),
        },
      ],
      outputs: [],
      ...workflowPlanContracts(["interrupted-task"]),
    };
    const services = {
      deliverySource: {
        load: vi.fn(async () => ({
          version: 2 as const,
          gate: "gate-b" as const,
          revision: 1,
          receiptHash: "a".repeat(64),
          plan,
        })),
      },
      worker: {
        runAttempt: vi.fn(async () => ({
          kind: "paused" as const,
          code: "fixture-paused",
        })),
        rebind: vi.fn(() => ({ ok: true as const, routeId: "inherited" })),
      },
      changeVerifier: {
        verify: vi.fn(async () => ({
          kind: "paused" as const,
          code: "fixture-verification-paused",
        })),
      },
    };
    let engine = WorkflowEngine.open({
      consumerRoot,
      stateRoot,
      ...services,
    });
    const started = await engine.execute({
      command: "start",
      stage: "abel-implement",
      change,
      operationId: "interrupted-start",
    });
    await engine.close();

    const store = RunStore.open(stateRoot);
    store.transition({
      runId: String(started.runId),
      to: "running",
      operationId: "simulate-process-stop",
    });
    store.close();
    const database = new DatabaseSync(stateRoot.databasePath);
    database
      .prepare(
        `UPDATE workflow_engine_operations
         SET state = 'running', outcome_json = NULL, lease_token = ?,
             lease_expires_at = ?
         WHERE run_id = ? AND operation_id = ?`,
      )
      .run("expired-lease", 0, String(started.runId), "interrupted-start");
    database
      .prepare(
        `UPDATE operations
         SET state = 'running', outcome_json = NULL, lease_token = ?,
             lease_expires_at = ?
         WHERE run_id = ? AND operation_id LIKE 'engine-%'`,
      )
      .run("expired-authoritative-lease", 0, String(started.runId));
    database
      .prepare(
        `UPDATE workflow_engine_tasks
         SET state = 'phase-running', pause_code = NULL
         WHERE run_id = ? AND task_id = 'interrupted-task'`,
      )
      .run(String(started.runId));
    database.close();

    engine = WorkflowEngine.open({
      consumerRoot,
      stateRoot,
      ...services,
    });
    try {
      await expect(
        engine.execute({
          command: "status",
          stage: "abel-implement",
          change,
        }),
      ).resolves.toMatchObject({
        runId: started.runId,
        state: "paused",
        completed: false,
        pause: { code: "operation-interrupted" },
        tasks: [
          {
            taskId: "interrupted-task",
            state: "paused",
            phase: "red",
          },
        ],
        legalCommands: expect.arrayContaining(["resume", "discard"]),
      });
    } finally {
      await engine.close();
    }
  });
});
