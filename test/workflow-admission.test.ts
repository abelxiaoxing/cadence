import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { WorkflowRequest } from "../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import {
  UnacceptedWorkflowCommand,
  Workflows,
} from "../src/service/workflows.ts";
import { canonicalJson } from "../src/worker-public.mjs";
import * as workspace from "../src/workspace.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

/** Admission only: the checkout gate never opens, so nothing runs. */
function owner() {
  const dir = mkdtempSync(join(tmpdir(), "workflow-admission-"));
  const root = join(dir, "project");
  mkdirSync(root, { mode: 0o700 });
  const coordination = new ServiceCoordination(root, join(dir, "state"));
  coordination.files.directory(coordination.directory, true);
  const epoch = randomUUID(),
    sourceSelectionId = randomUUID();
  const version = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const host = {
    state: "idle" as string,
    lease: { assert() {}, registration: { epoch } },
    quarantine() {
      host.state = "quarantined";
    },
    trackConversation() {},
  };
  let runtime = fixtureRuntime();
  const models = {
    workerSettings: vi.fn(() => structuredClone(runtime)),
    assertCurrent() {},
  };
  const workflows = new Workflows({
    coordination,
    owner: host,
    models,
    choice: {
      snapshot: () => ({
        version,
        selected: {
          sourceSelectionId,
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    },
    gate: {
      // The gate never opens; cancellation settles only this queued original.
      acquire: (_id: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(Error("stale"));
          else
            signal.addEventListener("abort", () => reject(Error("stale")), {
              once: true,
            });
        }),
    },
    cwd: root,
    secrets: () => [],
  } as unknown as ConstructorParameters<typeof Workflows>[0]);
  const research = (goal = "Inspect"): WorkflowRequest => ({
    action: "research",
    goal,
    questions: ["Read files"],
    model: version,
  });
  return {
    workflows,
    host,
    epoch,
    version,
    research,
    coordination,
    models,
    setRuntime: (next: typeof runtime) => {
      runtime = next;
    },
  };
}
it("execution checks resolve a shared checkout/cwd once but still validate an independent conversation directory", () => {
  const { workflows, coordination } = owner();
  const root = coordination.store.root;
  execFileSync("git", ["init", "-q"], { cwd: root });
  const cwd = join(root, "scoped");
  mkdirSync(cwd);
  const check = workflows as unknown as {
    assertRunning(live: {
      abort: AbortController;
      execution: { cwd: string };
    }): void;
  };
  const resolved = vi.spyOn(workspace, "resolveWorkspace");
  const abort = new AbortController();
  try {
    check.assertRunning({ abort, execution: { cwd: root } });
    expect(resolved.mock.calls).toEqual([[root]]);
    resolved.mockClear();
    check.assertRunning({ abort, execution: { cwd } });
    expect(resolved.mock.calls).toEqual([[root], [cwd]]);
    renameSync(cwd, join(root, "removed-scope"));
    expect(() => check.assertRunning({ abort, execution: { cwd } })).toThrow();
  } finally {
    resolved.mockRestore();
  }
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw Error("not refused");
};

it("native workflow refusals are definite only without any prior record, admission or quarantine", () => {
  const { workflows, host, epoch, version, research } = owner();
  const definite = { definite: true };
  // A stale epoch before any record of the identity: provably no effect.
  const stale = refusal(() =>
    workflows.command(
      randomUUID(),
      randomUUID(),
      { action: "propose", plan: plan(), model: version },
      definite,
    ),
  );
  expect(stale).toBeInstanceOf(UnacceptedWorkflowCommand);
  expect(stale).toMatchObject({ code: "stale" });
  // The same refusal for a caller that already recorded evidence stays ordinary.
  const ordinary = refusal(() =>
    workflows.command(randomUUID(), randomUUID(), research()),
  );
  expect(ordinary).not.toBeInstanceOf(UnacceptedConversationCommand);
  // Four admitted runs wait on the gate; the fifth is refused before admission.
  const admitted = Array.from({ length: 4 }, () => randomUUID());
  for (const id of admitted)
    expect(workflows.command(id, epoch, research(), definite)).toMatchObject({
      kind: "workflow",
    });
  const capacity = refusal(() =>
    workflows.command(randomUUID(), epoch, research(), definite),
  );
  expect(capacity).toBeInstanceOf(UnacceptedWorkflowCommand);
  expect(capacity).toMatchObject({ code: "capacity" });
  // A retried identity with a different request observes its original record.
  const changed = refusal(() =>
    workflows.command(admitted[0], epoch, research("Different"), definite),
  );
  expect(changed).toMatchObject({ code: "conflict" });
  expect(changed).not.toBeInstanceOf(UnacceptedConversationCommand);
  // A quarantined owner never reports a refusal as definitely without effect.
  host.state = "quarantined";
  const quarantined = refusal(() =>
    workflows.command(randomUUID(), epoch, research(), definite),
  );
  expect(quarantined).toMatchObject({ code: "quarantine" });
  expect(quarantined).not.toBeInstanceOf(UnacceptedConversationCommand);
  // Cancel stays available while quarantined.
  expect(
    workflows.command(
      randomUUID(),
      epoch,
      { action: "cancel", runId: admitted[1] },
      definite,
    ),
  ).toMatchObject({ kind: "workflow" });
});

it("a refused native execute leaves its grant usable; retained non-conforming proposals refuse cleanly", {
  tags: ["slow"],
}, async () => {
  const { workflows, epoch, version, research, coordination } = owner();
  const definite = { definite: true };
  const direct = plan();
  direct.delivery = "working-copy";
  const proposed = workflows.command(
    randomUUID(),
    epoch,
    { action: "propose", plan: direct, model: version },
    definite,
  );
  if (proposed.kind !== "workflow" || proposed.response.type !== "proposal")
    throw Error("proposal");
  const p = proposed.response.proposal;
  const prepared = workflows.command(
    randomUUID(),
    epoch,
    { action: "prepare", proposalId: p.id, digest: p.digest },
    definite,
  );
  if (prepared.kind !== "workflow" || prepared.response.type !== "grant")
    throw Error("grant");
  const busy = Array.from({ length: 4 }, () => randomUUID());
  for (const id of busy) workflows.command(id, epoch, research(), definite);
  const execute: WorkflowRequest = {
    action: "execute",
    proposalId: p.id,
    digest: p.digest,
    grant: prepared.response.grant,
  };
  const capacity = refusal(() =>
    workflows.command(randomUUID(), epoch, execute, definite),
  );
  expect(capacity).toBeInstanceOf(UnacceptedWorkflowCommand);
  expect(capacity).toMatchObject({ code: "capacity" });
  workflows.command(randomUUID(), epoch, { action: "cancel", runId: busy[0] });
  await workflows.join(busy[0]);
  const admitted = workflows.command(randomUUID(), epoch, execute, definite);
  expect(admitted).toMatchObject({
    kind: "workflow",
    response: { type: "run" },
  });
  // A retained 2.0.21 proposal with a 49-character task ID still reads, but
  // cannot be prepared under the current rules.
  const old = structuredClone(p);
  old.id = randomUUID();
  old.plan.tasks[0].id = `a${"b".repeat(48)}`;
  coordination.files.create(
    join(coordination.directory, "workflows-v1", "proposals", `${old.id}.json`),
    canonicalJson(old, 384 * 1024),
    384 * 1024,
  );
  expect(workflows.proposal(old.id).plan.tasks[0].id).toHaveLength(49);
  const outdated = refusal(() =>
    workflows.command(
      randomUUID(),
      epoch,
      { action: "prepare", proposalId: old.id, digest: old.digest },
      definite,
    ),
  );
  expect(outdated).toBeInstanceOf(UnacceptedWorkflowCommand);
  expect(outdated).toMatchObject({ code: "invalid" });
  expect((outdated as UnacceptedWorkflowCommand).detail).toContain(
    "predates self-revising delivery",
  );
});

it("approval binds Pi preferences; a changed tool/settings snapshot needs fresh confirmation", () => {
  const f = owner();
  const p = f.workflows.command(randomUUID(), f.epoch, {
    action: "propose",
    plan: { ...plan(), delivery: "working-copy" },
    model: f.version,
  });
  if (p.kind !== "workflow" || p.response.type !== "proposal")
    throw Error("proposal");
  const proposal = p.response.proposal;
  expect(proposal.display?.runtime).toContain("Pi runtime:");
  const prepared = f.workflows.command(randomUUID(), f.epoch, {
    action: "prepare",
    proposalId: proposal.id,
    digest: proposal.digest,
  });
  if (prepared.kind !== "workflow" || prepared.response.type !== "grant")
    throw Error("grant");
  const grant = prepared.response.grant;
  f.setRuntime(fixtureRuntime({ retry: { maxRetries: 11 } }));
  const id = randomUUID();
  expect(() =>
    f.workflows.command(
      id,
      f.epoch,
      {
        action: "execute",
        proposalId: proposal.id,
        digest: proposal.digest,
        grant,
      },
      { definite: true },
    ),
  ).toThrow("stale");
  expect(f.workflows.activeRuns().runs).toEqual([]);
  expect(
    f.coordination.files.directory(
      join(f.coordination.directory, "workflows-v1", "runs", id),
    ),
  ).toBe(false);
  expect(f.workflows.proposal(proposal.id)).toEqual(proposal);
});
it("queued admission retains its Pi snapshot rather than consulting later preferences", async () => {
  const f = owner();
  const id = randomUUID();
  f.workflows.command(id, f.epoch, f.research());
  const live = (
    f.workflows as unknown as {
      active: Map<string, { runtime: ReturnType<typeof fixtureRuntime> }>;
    }
  ).active.get(id);
  const original = canonicalJson(live?.runtime);
  f.setRuntime(
    fixtureRuntime({ defaultTools: ["read"], compaction: { enabled: false } }),
  );
  expect(canonicalJson(live?.runtime)).toBe(original);
  expect(f.models.workerSettings).toHaveBeenCalledOnce();
  f.workflows.command(randomUUID(), f.epoch, { action: "cancel", runId: id });
  await f.workflows.join(id);
});
