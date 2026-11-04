import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  ContractError,
  type ErrorCode,
} from "../src/service/contracts/core.ts";
import {
  decodeWorkbenchResult,
  type WorkbenchCommand,
  type WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import type {
  WorkflowProposal,
  WorkflowRequest,
  WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { ConversationWorkflow } from "../src/service/conversation-workflow.ts";
import type { ConversationControl } from "../src/service/conversations.ts";
import { OwnerModelChoice } from "../src/service/model-choice.ts";
import { hash, PrivateFiles } from "../src/service/private-files.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import { plan } from "./helpers/workflow-plan.ts";

// Unit seam for control-record ordering/projection only. Real SDK turns,
// workflow execution and HTTP effect reporting are covered by generated-owner tests.
type Send = Extract<WorkbenchCommand, { kind: "cadence-send" }>;
const caller = {
  attachmentId: randomUUID(),
  authority: "browser" as const,
  accessGeneration: 1,
};
function fixture(joinResearch: () => Promise<void> = async () => {}) {
  const namespace = mkdtempSync(join(tmpdir(), "cadence-control-"));
  const directory = join(namespace, "service-v1");
  const files = new PrivateFiles(namespace);
  const epoch = randomUUID();
  const model = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const owner = {
    state: "idle" as "idle" | "quarantined",
    lease: { assert() {}, registration: { epoch } },
    quarantine() {
      owner.state = "quarantined";
    },
  };
  const links = new Set<string>();
  const turns = new Map<string, string[]>();
  const receipts = new Set<string>();
  const controls = new Map<string, ConversationControl>();
  let hasTurnCalls = 0;
  let ioFault: string | undefined;
  const conversations = {
    controlBound: (id: string) => {
      if (ioFault)
        throw Object.assign(new Error(`${ioFault} (simulated)`), {
          code: ioFault,
        });
      return links.has(id);
    },
    controlKey: (id: string) => (links.has(id) ? "bound" : "absent"),
    bindControl: (id: string) => links.add(id),
    hasCommand: (id: string, turn: string) => {
      ++hasTurnCalls;
      return turns.get(id)?.includes(turn) ?? false;
    },
    receipt: (input: { commandId: string }) =>
      receipts.has(input.commandId)
        ? { kind: "accepted", commandId: input.commandId }
        : undefined,
    send(
      input: { commandId: string; conversationId: string },
      control: ConversationControl,
      beforeAccept?: () => void,
    ) {
      beforeAccept?.();
      // The real owner records the turn before the control state commits.
      turns.set(input.conversationId, [
        ...(turns.get(input.conversationId) ?? []),
        input.commandId,
      ]);
      receipts.add(input.commandId);
      control.accept();
      controls.set(input.commandId, control);
      return { kind: "accepted", commandId: input.commandId };
    },
    latestCommand: (id: string) => {
      const commandId = turns.get(id)?.at(-1);
      return commandId ? { commandId, status: "completed" } : null;
    },
  };
  const runs = new Map<string, WorkflowRun>();
  const active: WorkflowRun[] = [];
  let refuseExecute: ErrorCode | undefined;
  const run = (id: string, phase: WorkflowRun["phase"]): WorkflowRun => ({
    id,
    epoch,
    goal: "g",
    status: "running",
    phase,
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  });
  const workflows = {
    view(id: string): WorkbenchResult {
      const r = runs.get(id);
      if (!r) throw new ContractError("unavailable");
      return {
        kind: "workflow",
        commandId: null,
        response: { type: "run", run: r },
      };
    },
    activeRuns: () => ({ kind: "workflow-active" as const, runs: active }),
    join: joinResearch,
    command(commandId: string, _epoch: string, r: WorkflowRequest) {
      if (r.action === "propose") {
        const proposal: WorkflowProposal = {
          id: commandId,
          epoch,
          digest: hash(JSON.stringify(r.plan)),
          observation: hash("observation"),
          model,
          plan: r.plan,
          cwd: "/project",
        };
        return {
          kind: "workflow",
          commandId,
          response: { type: "proposal", proposal },
        };
      }
      if (r.action === "prepare")
        return {
          kind: "workflow",
          commandId,
          response: {
            type: "grant",
            proposal: {} as WorkflowProposal,
            grant: randomUUID(),
            expiresAt: Date.now() + 120000,
          },
        };
      if (r.action === "execute" && refuseExecute)
        throw new ContractError(refuseExecute);
      if (r.action === "cancel") return workflows.view(r.runId);
      const created = run(
        commandId,
        r.action === "research" ? "research" : "implementing",
      );
      runs.set(commandId, created);
      return {
        kind: "workflow",
        commandId,
        response: { type: "run", run: created },
      };
    },
  };
  const cw = new ConversationWorkflow({
    coordination: { directory, files },
    owner,
    choice: { snapshot: () => ({ version: model, selected: null }) },
    conversations: {
      ...conversations,
      records: {
        assertSupported() {},
        controlBound: conversations.controlBound,
        controlKey: conversations.controlKey,
        hasCommand: conversations.hasCommand,
        latestCommand: conversations.latestCommand,
        approvalHead: () => null,
      },
    },
    workflows,
    secrets: () => [],
  } as unknown as ConstructorParameters<typeof ConversationWorkflow>[0]);
  const root = join(directory, "conversation-workflows-v1");
  const send = (
    id: string,
    intent: Send["intent"] = "message",
    text = "hello",
  ) => {
    const commandId = randomUUID();
    cw.send({
      kind: "cadence-send",
      commandId,
      conversationId: id,
      head: turns.get(id)?.at(-1) ?? null,
      text,
      model,
      revision: cw.records.state(id).revision,
      intent,
    });
    return commandId;
  };
  const tool = async (turn: string, name: string, args: unknown) =>
    controls
      .get(turn)
      ?.onTool(name, args, new AbortController().signal) as Promise<
      Record<string, unknown>
    >;
  const settle = (turn: string) => controls.get(turn)?.settle();
  return {
    cw,
    model,
    root,
    files,
    owner,
    links,
    turns,
    runs,
    active,
    run,
    send,
    tool,
    settle,
    hasTurnCalls: () => hasTurnCalls,
    ioFault(code?: string) {
      ioFault = code;
    },
    refuseExecute(code?: ErrorCode) {
      refuseExecute = code;
    },
  };
}
function plant(root: string, id: string, state: unknown) {
  mkdirSync(join(root, id), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(root, id, "state.json"),
    typeof state === "string"
      ? state
      : JSON.stringify({ schema: "cadence-conversation-workflow/1", state }),
    { mode: 0o600 },
  );
}
const snapshot = (root: string) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => [
      join(e.parentPath, e.name),
      readFileSync(join(e.parentPath, e.name), "utf8"),
    ]);

it("one unusable control record degrades only its conversation and is never repaired", async () => {
  const f = fixture();
  const good = randomUUID();
  const turn = f.send(good, "enter", "/cadence");
  await f.settle(turn);
  const dangling = randomUUID(),
    unbound = randomUUID(),
    corrupt = randomUUID(),
    linkOnly = randomUUID();
  const runId = randomUUID();
  f.runs.set(runId, f.run(runId, "implementing"));
  f.active.push(f.runs.get(runId) as WorkflowRun);
  // A partial control record never authorizes execution.
  for (const id of [dangling, corrupt, linkOnly]) f.links.add(id);
  plant(f.root, dangling, {
    id: dangling,
    revision: 3,
    enabled: true,
    head: randomUUID(),
    proposal: null,
    runs: [runId],
  });
  plant(f.root, unbound, { ...f.cw.records.state(good), id: unbound });
  plant(f.root, corrupt, "{");
  writeFileSync(join(f.root, "not-a-record.txt"), "junk", { mode: 0o600 });
  const before = snapshot(f.root);
  for (const id of [dangling, unbound, corrupt, linkOnly]) {
    const state = f.cw.records.state(id);
    expect(state.notice, id).toBeTruthy();
    expect(state).toMatchObject({ enabled: true, proposal: null });
    expect(f.cw.records.observe(id).notice).toBeTruthy();
    expect(() =>
      f.cw.send({
        kind: "cadence-send",
        commandId: randomUUID(),
        conversationId: id,
        head: null,
        text: "x",
        model: f.model,
        revision: state.revision,
        intent: "message",
      }),
    ).toThrow("corrupt-selected");
    expect(() =>
      f.cw.approval(
        {
          kind: "cadence-prepare",
          commandId: randomUUID(),
          conversationId: id,
          revision: state.revision,
          proposalId: randomUUID(),
          digest: hash("x"),
        },
        caller,
      ),
    ).toThrow(UnacceptedConversationCommand);
  }
  // Missing durable membership is not reconstructed by scanning old state.
  expect(f.cw.links([runId])).toEqual([]);
  expect(f.cw.records.state(good)).toMatchObject({ enabled: true, head: turn });
  expect(f.cw.records.state(good).notice).toBeUndefined();
  expect(snapshot(f.root)).toEqual(before);
  // A projection notice is never accepted back as retained state.
  plant(f.root, unbound, {
    ...f.cw.records.state(good),
    id: unbound,
    notice: "forged",
  });
  f.links.add(unbound);
  expect(f.cw.records.state(unbound).notice).not.toBe("forged");
});

it("a displayed plan survives discussion, exit retires it, and research is refused only behind an implementation", async () => {
  const f = fixture();
  const id = randomUUID();
  let turn = f.send(id, "enter", "/cadence plan");
  const implementation = randomUUID();
  f.runs.set(implementation, f.run(implementation, "implementing"));
  f.active.push(f.runs.get(implementation) as WorkflowRun);
  // Another workflow does not block publishing; approval re-binds observation.
  const published = await f.tool(turn, "cadence_plan", plan());
  expect(published).toMatchObject({ proposalId: expect.any(String) });
  const busy = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["q"],
  });
  expect(busy).toMatchObject({ refused: "checkout-busy" });
  const invalid = await f.tool(turn, "cadence_plan", { ...plan(), checks: [] });
  expect(invalid).toMatchObject({ refused: "invalid-plan" });
  await f.settle(turn);
  const proposal = f.cw.records.state(id).proposal;
  expect(proposal?.id).toBe(published.proposalId);
  // Investigations queue behind other investigations, not an implementation.
  f.active.splice(0, 1, f.run(randomUUID(), "research"));
  turn = f.send(id, "message", "what does task b do?");
  expect(f.cw.records.state(id).proposal).toEqual(proposal);
  const research = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["q"],
  });
  expect(research).toMatchObject({ phase: "research" });
  expect(f.cw.records.state(id).runs).toHaveLength(1);
  await f.settle(turn);
  f.send(id, "exit", "exit cadence");
  expect(f.cw.records.state(id)).toMatchObject({
    enabled: false,
    proposal: null,
  });
});

it("one browser Send can investigate more than two batches and still publish a plan", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence investigate");
  for (let i = 0; i < 4; i++)
    expect(
      await f.tool(turn, "cadence_research", {
        goal: "g",
        questions: [`question ${i}`],
      }),
    ).toMatchObject({ phase: "research" });
  expect(f.cw.records.state(id).runs).toHaveLength(4);
  expect(await f.tool(turn, "cadence_plan", plan())).toMatchObject({
    proposalId: expect.any(String),
  });
  await f.settle(turn);
  expect(() => f.send(id)).not.toThrow();
});

it("settlement retains an in-flight investigation after earlier calls have completed", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(() => pending);
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence investigate");
  await f.tool(turn, "cadence_status", {});
  const investigation = f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["q"],
  });
  let settled = false;
  const settling = f.settle(turn)!.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(() => f.send(id)).toThrow("conflict");
  release();
  await investigation;
  await settling;
  expect(() => f.send(id)).not.toThrow();
});

it("coordinator turns are per conversation, and a lost cadence-send reply observes its receipt", async () => {
  const f = fixture();
  const a = randomUUID(),
    b = randomUUID();
  const first = f.send(a, "enter", "/cadence");
  f.send(b, "enter", "/cadence");
  expect(() => f.send(a)).toThrow("conflict");
  // Same command ID after acceptance: receipt, even though revision moved on.
  expect(
    f.cw.send({
      kind: "cadence-send",
      commandId: first,
      conversationId: a,
      head: null,
      text: "/cadence",
      model: f.model,
      revision: 0,
      intent: "enter",
    }),
  ).toEqual({ kind: "accepted", commandId: first });
  await f.settle(first);
  expect(() => f.send(a)).not.toThrow();
});

it("approval admits before consuming the plan: a definite refusal keeps it, and only one tab admits", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence plan");
  await f.tool(turn, "cadence_plan", plan());
  await f.settle(turn);
  const approve = async (refuse?: ErrorCode) => {
    const s = f.cw.records.state(id);
    if (!s.proposal) throw Error("proposal");
    const base = {
      conversationId: id,
      revision: s.revision,
      proposalId: s.proposal.id,
      digest: s.proposal.digest,
    };
    const grant = f.cw.approval(
      { kind: "cadence-prepare", commandId: randomUUID(), ...base },
      caller,
    );
    if (grant.kind !== "cadence-grant") throw Error("grant");
    f.refuseExecute(refuse);
    return { ...base, kind: "cadence-approve" as const, grant: grant.grant };
  };
  const refused = await approve("stale");
  expect(() =>
    f.cw.approval({ ...refused, commandId: randomUUID() }, caller),
  ).toThrow("stale");
  expect(f.cw.records.state(id).proposal?.id).toBe(refused.proposalId);
  expect(f.cw.records.state(id).runs).toEqual([]);
  expect(f.runs.size).toBe(0);
  // Two tabs with separate grants: the first admission bumps the revision.
  const tab1 = await approve(),
    tab2 = await approve();
  const runId = randomUUID();
  expect(f.cw.approval({ ...tab1, commandId: runId }, caller)).toMatchObject({
    kind: "workflow",
    commandId: runId,
  });
  expect(() =>
    f.cw.approval({ ...tab2, commandId: randomUUID() }, caller),
  ).toThrow(UnacceptedConversationCommand);
  expect(f.cw.records.state(id)).toMatchObject({
    proposal: null,
    runs: [runId],
  });
  // The same approval command observes its run instead of executing again.
  expect(f.cw.approval({ ...tab1, commandId: runId }, caller)).toMatchObject({
    kind: "workflow",
    commandId: runId,
  });
  expect(f.runs.size).toBe(1);
});

it("list and link projections decode a record once per change and stay bounded", () => {
  const f = fixture();
  const id = randomUUID();
  f.send(id, "enter", "/cadence");
  f.cw.records.observe(id);
  const calls = f.hasTurnCalls();
  for (let i = 0; i < 5; i++)
    expect(f.cw.records.observe(id).enabled).toBe(true);
  expect(f.hasTurnCalls()).toBe(calls);
  f.send(id, "exit", "exit cadence");
  expect(f.cw.records.observe(id).enabled).toBe(false);
  const result = decodeWorkbenchResult({
    kind: "workflow-active",
    runs: [],
    links: [],
  });
  expect(result).toEqual({ kind: "workflow-active", runs: [], links: [] });
  // Older owners without links still decode, with no link inferred.
  expect(decodeWorkbenchResult({ kind: "workflow-active", runs: [] })).toEqual({
    kind: "workflow-active",
    runs: [],
    links: [],
  });
  expect(() =>
    decodeWorkbenchResult({
      kind: "workflow-active",
      runs: [],
      links: [{ runId: randomUUID(), conversationId: id }],
    }),
  ).toThrow();
});

it("an unremembered model preference never turns an installed choice into a failure", () => {
  const epoch = randomUUID();
  const choice = new OwnerModelChoice({
    owner: {
      lease: { assert() {}, registration: { epoch } },
      assertQuiescent() {},
      configurationInstalled() {},
    },
    writer: {
      configurationRevisionFloor: 0,
      quarantined: false,
      pendingWrites: 0,
      accounting: {
        owner: { leases: 0 },
        children: [],
        episodes: { count: 0 },
      },
    },
    models: {
      pending: 0,
      loading: false,
      replaceSelection: (selector: object, current: () => void) => {
        current();
        return { ...selector, sourceSelectionId: randomUUID() };
      },
    },
    access: { assertCurrent() {}, generation: 1 },
    remember() {
      throw new Error("Unsupported Cadence preferences");
    },
  } as unknown as ConstructorParameters<typeof OwnerModelChoice>[0]);
  const selector = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions" as const,
    thinking: "off" as const,
  };
  const chosen = choice.choose({
    expected: choice.snapshot().version,
    choice: selector,
  });
  expect(chosen.selected).toMatchObject(selector);
  expect(choice.snapshot()).toEqual(chosen);
});

it("the catalog shows a remembered preference read only, only when it is still offered", () => {
  const epoch = randomUUID();
  const selector = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions" as const,
    thinking: "off" as const,
  };
  let saved: unknown = selector;
  let installs = 0;
  const choice = new OwnerModelChoice({
    owner: {
      lease: { assert() {}, registration: { epoch } },
      assertQuiescent() {},
      configurationInstalled() {},
    },
    models: {
      pending: 0,
      loading: false,
      assertCurrent() {},
      catalog: () => ({
        status: "complete",
        withheld: 0,
        entries: [
          {
            provider: "fixture",
            model: "fixed",
            api: "openai-completions",
            thinking: [{ level: "off", selectable: true }],
            eligibility: "candidate",
          },
        ],
      }),
      replaceSelection: () => {
        installs++;
        throw new Error("not installed by reading");
      },
    },
    access: { assertCurrent() {}, generation: 1 },
    recall: () => {
      if (saved instanceof Error) throw saved;
      return saved;
    },
  } as unknown as ConstructorParameters<typeof OwnerModelChoice>[0]);
  expect(choice.catalog()).toMatchObject({
    selected: null,
    remembered: selector,
  });
  for (const value of [
    { ...selector, model: "gone" },
    { ...selector, thinking: "high" },
    new Error("Unsupported Cadence preferences"),
    null,
  ]) {
    saved = value;
    expect(choice.catalog().remembered).toBeNull();
  }
  expect(installs).toBe(0);
  expect(choice.snapshot().selected).toBeNull();
});

it("retained control directories never impose a lifetime conversation cap", () => {
  const f = fixture();
  const existing = randomUUID();
  f.send(existing, "enter", "/cadence");
  writeFileSync(join(f.root, "stray.txt"), "junk", { mode: 0o600 });
  for (let i = 0; i < 300; i++)
    mkdirSync(join(f.root, randomUUID()), { mode: 0o700 });
  expect(() => f.send(randomUUID(), "enter", "/cadence")).not.toThrow();
  expect(f.cw.records.state(randomUUID())).toMatchObject({ enabled: false });
  expect(f.cw.records.observe(existing).enabled).toBe(true);
  expect(() => f.send(existing, "exit", "exit cadence")).not.toThrow();
});

it("a refusal before admission never consumes the browser grant", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence plan");
  await f.tool(turn, "cadence_plan", plan());
  await f.settle(turn);
  const s = f.cw.records.state(id);
  if (!s.proposal) throw Error("proposal");
  const base = {
    conversationId: id,
    revision: s.revision,
    proposalId: s.proposal.id,
    digest: s.proposal.digest,
  };
  const prepared = f.cw.approval(
    { kind: "cadence-prepare", commandId: randomUUID(), ...base },
    caller,
  );
  if (prepared.kind !== "cadence-grant") throw Error("grant");
  const approve = { ...base, kind: "cadence-approve" as const };
  const grant = prepared.grant;
  // Another attachment presenting the grant is refused without consuming it.
  expect(() =>
    f.cw.approval(
      { ...approve, grant, commandId: randomUUID() },
      { ...caller, attachmentId: randomUUID() },
    ),
  ).toThrow(UnacceptedConversationCommand);
  // The recent 200-run projection is not an admission cap. Its oldest link
  // remains in the independent link store; the grant remains exact.
  const record = join(f.root, id, "state.json");
  const full = JSON.parse(readFileSync(record, "utf8"));
  full.state.runs = Array.from({ length: 200 }, () => randomUUID());
  writeFileSync(record, JSON.stringify(full));
  const linkDirectory = join(
    f.root,
    "..",
    "conversations-v1",
    "workflow-links",
  );
  mkdirSync(linkDirectory, { recursive: true, mode: 0o700 });
  for (const runId of full.state.runs)
    writeFileSync(
      join(linkDirectory, `${runId}.json`),
      JSON.stringify({ runId, conversationId: id }),
      { mode: 0o600 },
    );
  const runId = randomUUID();
  expect(
    f.cw.approval({ ...approve, grant, commandId: runId }, caller),
  ).toMatchObject({ kind: "workflow", commandId: runId });
  // Admission consumes it: the same grant cannot admit a second command.
  expect(() =>
    f.cw.approval({ ...approve, grant, commandId: randomUUID() }, caller),
  ).toThrow();
  expect(f.runs.size).toBe(1);
  expect(f.cw.records.state(id).runs).toHaveLength(200);
  expect(f.cw.records.state(id).runs.at(-1)).toBe(runId);
  expect(f.cw.links([full.state.runs[0], runId])).toEqual([
    { runId: full.state.runs[0], conversationId: id },
    { runId, conversationId: id },
  ]);
});

it("a transient read failure is reported as unavailable and never remembered", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence");
  await f.tool(turn, "cadence_research", { goal: "g", questions: ["q"] });
  await f.settle(turn);
  const [runId] = f.cw.records.state(id).runs;
  f.ioFault("EMFILE");
  // First observation of the record fails with an I/O error, not bad content.
  expect(() => f.cw.records.state(id)).toThrow("unavailable");
  expect(f.cw.records.observe(id).notice).toMatch(
    /could not be read just now/u,
  );
  expect(f.cw.links([runId])).toEqual([{ runId, conversationId: id }]);
  f.ioFault();
  // Unchanged record bytes: the next read is a fresh, usable observation.
  expect(f.cw.records.observe(id)).toMatchObject({ enabled: true });
  expect(f.cw.records.observe(id).notice).toBeUndefined();
  expect(f.cw.records.state(id).notice).toBeUndefined();
  expect(f.cw.links([runId])).toEqual([{ runId, conversationId: id }]);
});
