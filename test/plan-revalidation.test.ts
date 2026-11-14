import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ContractError, canonicalJson } from "../src/service/contracts/core.ts";
import type { ModelSelector } from "../src/service/contracts/domain.ts";
import {
  type CadenceConversation,
  decodeWorkbenchCommand,
  decodeWorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { ConversationContexts } from "../src/service/conversation-contexts.ts";
import { CONTROL_SCHEMA } from "../src/service/conversation-controls.ts";
import { ConversationWorkflow } from "../src/service/conversation-workflow.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import { Workflows } from "../src/service/workflows.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

// Real proposal/control/context persistence and admission checks. Stand-in model
// sources and settled-turn facts; no owner process, model request or worker.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "plan-revalidation-"));
  const cwd = join(dir, "project");
  mkdirSync(cwd, { mode: 0o700 });
  const coordination = new ServiceCoordination(cwd, join(dir, "state"));
  coordination.files.directory(coordination.directory, true);
  const location = { id: randomUUID(), cwd };
  const model: ModelSelector = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  };
  const turn = randomUUID();
  let leaf: string | null = "abcdef01";
  let settled = true;
  let runtime = fixtureRuntime();
  let secret: readonly string[] = [];
  const caller = {
    attachmentId: randomUUID(),
    authority: "browser" as const,
    accessGeneration: 1,
  };
  const gate = {
    acquire: vi.fn(() => {
      throw Error("must not execute");
    }),
  };
  const conversations = {
    records: {
      assertSupported() {},
      controlBound: () => true,
      hasCommand: (_id: string, id: string) => id === turn,
      latestRun: () => ({ commandId: turn, settled }),
      approvalHead: () => leaf,
    },
    send: vi.fn(() => {
      throw Error("must not send");
    }),
  };
  const boot = () => {
    const epoch = randomUUID();
    let selected: (ModelSelector & { sourceSelectionId: string }) | null = null;
    const owner = {
      state: "idle",
      lease: { assert() {}, registration: { epoch } },
      quarantine() {
        owner.state = "quarantined";
      },
    };
    const choice = {
      snapshot: () => ({
        selected: null,
        version: { epoch, accessGeneration: 1, configRev: 1, catalogId: epoch },
      }),
    };
    const models = {
      retainedSelection: (value: ModelSelector) =>
        selected && canonicalJson(value) === canonicalJson(model)
          ? selected
          : null,
      retainSelection: vi.fn((value: ModelSelector) => {
        if (canonicalJson(value) !== canonicalJson(model))
          throw new ContractError("unavailable");
        selected ??= { ...model, sourceSelectionId: randomUUID() };
        return selected;
      }),
      assertCurrent() {},
      workerSettings: () => structuredClone(runtime),
    };
    const options = {
      coordination,
      owner,
      choice,
      models,
      cwd,
      gate,
      secrets: () => secret,
    };
    const contexts = new ConversationContexts(
      options as unknown as ConstructorParameters<
        typeof ConversationContexts
      >[0],
    );
    const workflows = new Workflows({
      ...options,
      contexts,
    } as unknown as ConstructorParameters<typeof Workflows>[0]);
    const control = new ConversationWorkflow({
      ...options,
      contexts,
      workflows,
      conversations,
    } as unknown as ConstructorParameters<typeof ConversationWorkflow>[0]);
    return { epoch, owner, contexts, workflows, control, models };
  };
  const first = boot();
  const choice = first.contexts.choose(
    location,
    first.contexts.snapshot(location).version,
    model,
    false,
  );
  const proposed = first.workflows.command(randomUUID(), first.epoch, {
    action: "propose",
    model: choice.version,
    plan: { ...plan(), delivery: "working-copy" },
  });
  if (proposed.kind !== "workflow" || proposed.response.type !== "proposal")
    throw Error("fixture");
  const original = proposed.response.proposal;
  const state: CadenceConversation = {
    id: location.id,
    revision: 2,
    enabled: true,
    head: turn,
    proposal: original,
    runs: [],
  };
  coordination.files.create(
    first.control.records.path(location.id),
    canonicalJson({ schema: CONTROL_SCHEMA, state }),
  );
  const request = (live: ReturnType<typeof boot>) =>
    decodeWorkbenchCommand({
      kind: "cadence-revalidate",
      commandId: randomUUID(),
      conversationId: location.id,
      revision: state.revision,
      proposalId: original.id,
      digest: original.digest,
      head: leaf,
      context: live.contexts.records.read(location).context,
      expected: live.contexts.snapshot(location).version,
      model,
    }) as Extract<
      ReturnType<typeof decodeWorkbenchCommand>,
      { kind: "cadence-revalidate" }
    >;
  return {
    ...first,
    first,
    boot,
    original,
    state,
    location,
    model,
    caller,
    request,
    coordination,
    gate,
    conversations,
    moveLeaf: () => {
      leaf = "abcdef02";
    },
    unsettled: () => {
      settled = false;
    },
    runtime: () => {
      runtime = fixtureRuntime({ retry: { maxRetries: 40 } });
    },
    resetRuntime: () => {
      runtime = fixtureRuntime();
    },
    redact: (value: string) => {
      secret = [value];
    },
  };
}

it("a restarted owner revalidates immutable plan content without Send, a grant or execution; only fresh confirmation prepares a grant", () => {
  const f = fixture();
  const originalPath = join(
    f.coordination.directory,
    "workflows-v1",
    "proposals",
    `${f.original.id}.json`,
  );
  const originalBytes = readFileSync(originalPath);
  const previous = f.control.approval(
    {
      kind: "cadence-prepare",
      commandId: randomUUID(),
      conversationId: f.location.id,
      revision: f.state.revision,
      proposalId: f.original.id,
      digest: f.original.digest,
    },
    f.caller,
  );
  expect(previous.kind).toBe("cadence-grant");
  const restarted = f.boot();
  expect(restarted.contexts.snapshot(f.location).selected).toBeNull();
  expect(() =>
    restarted.control.approval(
      {
        kind: "cadence-prepare",
        commandId: randomUUID(),
        conversationId: f.location.id,
        revision: f.state.revision,
        proposalId: f.original.id,
        digest: f.original.digest,
      },
      f.caller,
    ),
  ).toThrow("stale");
  const command = f.request(restarted);
  const result = decodeWorkbenchResult(
    restarted.control.revalidate(command, f.caller),
  );
  if (result.kind !== "cadence-revalidated" || !result.state.proposal)
    throw Error("result");
  const fresh = result.state.proposal;
  expect(result.state).toMatchObject({
    revision: 3,
    head: f.state.head,
    runs: [],
  });
  expect(fresh).toMatchObject({
    id: command.commandId,
    epoch: restarted.epoch,
    revalidatedFrom: f.original.id,
    plan: f.original.plan,
    digest: f.original.digest,
  });
  expect(fresh.model).not.toEqual(f.original.model);
  expect(readFileSync(originalPath)).toEqual(originalBytes);
  expect(restarted.control.records.state(f.location.id)).toEqual(result.state);
  expect(restarted.models.retainSelection).toHaveBeenCalledTimes(1);
  expect(f.gate.acquire).not.toHaveBeenCalled();
  expect(f.conversations.send).not.toHaveBeenCalled();
  expect(restarted.workflows.activeRuns().runs).toEqual([]);
  expect(
    existsSync(join(f.coordination.directory, "workflows-v1", "runs")),
  ).toBe(false);
  // An old tab and a repeated validation cannot overwrite this new decision.
  expect(() => restarted.control.revalidate(command, f.caller)).toThrow(
    "stale",
  );
  expect(() =>
    restarted.control.revalidate(
      { ...command, commandId: randomUUID() },
      f.caller,
    ),
  ).toThrow("stale");
  expect(restarted.models.retainSelection).toHaveBeenCalledTimes(1);
  expect(() =>
    restarted.control.approval(
      {
        kind: "cadence-approve",
        commandId: randomUUID(),
        conversationId: f.location.id,
        revision: f.state.revision,
        proposalId: f.original.id,
        digest: f.original.digest,
        grant: previous.kind === "cadence-grant" ? previous.grant : "",
      },
      f.caller,
    ),
  ).toThrow("stale");
  const prepared = restarted.control.approval(
    {
      kind: "cadence-prepare",
      commandId: randomUUID(),
      conversationId: f.location.id,
      revision: result.state.revision,
      proposalId: fresh.id,
      digest: fresh.digest,
    },
    f.caller,
  );
  expect(prepared).toMatchObject({ kind: "cadence-grant", proposal: fresh });
  expect(f.gate.acquire).not.toHaveBeenCalled();
});

it.each([
  "head",
  "revision",
  "proposal",
  "digest",
  "context",
  "epoch",
  "caller",
  "unknown",
  "stopping",
])(
  "changed %s refuses before model restoration or proposal publication",
  (changed) => {
    const f = fixture();
    const live = f.boot();
    const command = f.request(live);
    if (changed === "head") f.moveLeaf();
    if (changed === "revision") command.revision++;
    if (changed === "proposal") command.proposalId = randomUUID();
    if (changed === "digest") command.digest = "a".repeat(64);
    if (changed === "context") command.context.revision++;
    if (changed === "epoch") command.expected.epoch = randomUUID();
    if (changed === "unknown") f.unsettled();
    if (changed === "stopping") live.owner.state = "stopping";
    expect(() =>
      live.control.revalidate(
        command,
        changed === "caller" ? undefined : f.caller,
      ),
    ).toThrow(
      changed === "caller"
        ? "forbidden"
        : changed === "stopping"
          ? "quarantine"
          : "stale",
    );
    expect(live.models.retainSelection).not.toHaveBeenCalled();
    expect(live.control.records.state(f.location.id)).toEqual(f.state);
    expect(f.gate.acquire).not.toHaveBeenCalled();
  },
);

it("changed effective settings and working-copy evidence are re-observed, not hidden behind the same plan digest", () => {
  const f = fixture();
  f.runtime();
  writeFileSync(join(f.location.cwd, "changed.txt"), "outside change");
  const live = f.boot();
  const result = live.control.revalidate(f.request(live), f.caller);
  if (result.kind !== "cadence-revalidated") throw Error("result");
  expect(result.state.proposal?.plan).toEqual(f.original.plan);
  expect(result.state.proposal?.digest).toEqual(f.original.digest);
  expect(result.state.proposal?.observation).not.toBe(f.original.observation);
  expect(result.state.proposal?.display?.runtime).not.toBe(
    f.original.display?.runtime,
  );
  expect(f.gate.acquire).not.toHaveBeenCalled();
});

it("an executor refusal after browser confirmation is genuinely effect-free, retaining both grants and no phantom approval evidence", () => {
  const f = fixture();
  const base = {
    conversationId: f.location.id,
    revision: f.state.revision,
    proposalId: f.original.id,
    digest: f.original.digest,
  };
  const command = vi.spyOn(f.workflows, "command");
  const prepared = f.control.approval(
    { kind: "cadence-prepare", commandId: randomUUID(), ...base },
    f.caller,
  );
  if (prepared.kind !== "cadence-grant") throw Error("grant");
  const native = command.mock.results[0].value;
  if (native.kind !== "workflow" || native.response.type !== "grant")
    throw Error("native grant");
  f.runtime();
  const id = randomUUID();
  const submit = () =>
    f.control.approval(
      {
        kind: "cadence-approve",
        commandId: id,
        grant: prepared.grant,
        ...base,
      },
      f.caller,
    );
  expect(submit).toThrow(UnacceptedConversationCommand);
  expect(submit).toThrow("stale");
  expect(f.control.records.state(f.location.id)).toEqual(f.state);
  expect(
    existsSync(
      join(f.control.records.root, f.location.id, "approvals", `${id}.json`),
    ),
  ).toBe(false);
  expect(f.workflows.activeRuns().runs).toEqual([]);
  f.resetRuntime();
  // Reach the admission boundary with the same grants. A stand-in recorder
  // failure stops before work, proving neither grant was consumed by refusal.
  const original = Workflows.prototype.command.bind(f.workflows);
  command.mockImplementation((id, epoch, request) =>
    original(id, epoch, request, {
      beforeAdmission: () => {
        throw Error("admission reached");
      },
    }),
  );
  expect(submit).toThrow("admission reached");
  expect(f.gate.acquire).not.toHaveBeenCalled();
});

it("revalidation retires the underlying executor grant, not just its browser wrapper", () => {
  const f = fixture();
  const command = vi.spyOn(f.workflows, "command");
  f.control.approval(
    {
      kind: "cadence-prepare",
      commandId: randomUUID(),
      conversationId: f.location.id,
      revision: f.state.revision,
      proposalId: f.original.id,
      digest: f.original.digest,
    },
    f.caller,
  );
  const native = command.mock.results[0].value;
  if (native.kind !== "workflow" || native.response.type !== "grant")
    throw Error("native grant");
  f.control.revalidate(f.request(f.first), f.caller);
  expect(() =>
    f.workflows.command(randomUUID(), f.epoch, {
      action: "execute",
      proposalId: f.original.id,
      digest: f.original.digest,
      grant: native.response.grant,
    }),
  ).toThrow("expired-grant");
  expect(f.gate.acquire).not.toHaveBeenCalled();
});

it("unavailable selected model never substitutes a default, and a newly sensitive agreement is not silently rewritten", () => {
  const f = fixture();
  const live = f.boot();
  const command = f.request(live);
  command.model.model = "missing";
  expect(() => live.control.revalidate(command, f.caller)).toThrow(
    "unavailable",
  );
  expect(live.control.records.state(f.location.id)).toEqual(f.state);
  f.redact(f.original.plan.goal);
  expect(() => live.control.revalidate(f.request(live), f.caller)).toThrow(
    "forbidden",
  );
  expect(live.control.records.state(f.location.id)).toEqual(f.state);
});
