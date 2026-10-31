import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { WorkflowRequest } from "../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import {
  UnacceptedWorkflowCommand,
  Workflows,
} from "../src/service/workflows.ts";
import { canonicalJson } from "../src/worker-public.mjs";
import { plan } from "./helpers/workflow-plan.ts";

/** Admission only: the checkout gate never opens, so nothing runs. */
function owner() {
  const dir = mkdtempSync(join(tmpdir(), "workflow-admission-"));
  const root = join(dir, "project");
  mkdirSync(root, { mode: 0o700 });
  const coordination = new ServiceCoordination(root, join(dir, "state"));
  coordination.files.directory(coordination.directory, true);
  const epoch = randomUUID();
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
  const workflows = new Workflows({
    coordination,
    owner: host,
    models: { assertCurrent() {} },
    choice: {
      snapshot: () => ({
        version,
        selected: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    },
    actions: {
      // The gate never opens; cancellation still releases a queued run.
      scheduler: {
        conversationBarrier: (_id: string, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(Error("stale")), {
              once: true,
            }),
          ),
      },
      conversationBoundary() {},
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
  return { workflows, host, epoch, version, research, coordination };
}
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

it("a refused native execute leaves its grant usable; retained non-conforming proposals refuse cleanly", async () => {
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
    "predates the current plan rules",
  );
});
