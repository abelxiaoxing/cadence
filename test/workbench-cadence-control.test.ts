import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  ContractError,
  type ErrorCode,
} from "../src/service/contracts/core.ts";
import {
  decodeDesign,
  designMessage,
  designSummary,
  newDesign,
  reviseDesign,
} from "../src/service/contracts/design.ts";
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
import {
  BROWSER_COORDINATOR_INSTRUCTIONS,
  buildCoordinatorContext,
  COORDINATOR_CONTEXT_BYTES,
  ConversationWorkflow,
} from "../src/service/conversation-workflow.ts";
import type { ConversationControl } from "../src/service/conversations.ts";
import { OwnerModelChoice } from "../src/service/model-choice.ts";
import { hash, PrivateFiles } from "../src/service/private-files.ts";
import { Workbench } from "../src/service/workbench.ts";
import { WorkbenchFiles } from "../src/service/workbench-files.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import { workflowResultDetail } from "../src/service/workflow-result.ts";
import {
  canonicalJson,
  decodeWorkerPublicRequest,
  LIMITS,
} from "../src/worker-public.mjs";
import { designQuestionsFixture } from "./helpers/design-questions.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

// Unit seam for control-record ordering/projection only. Real SDK turns,
// workflow execution and HTTP effect reporting are covered by generated-owner tests.
type Send = Extract<WorkbenchCommand, { kind: "cadence-send" }>;
const caller = {
  attachmentId: randomUUID(),
  authority: "browser" as const,
  accessGeneration: 1,
};
function fixture(
  joinResearch: (run: WorkflowRun) => Promise<void> = async () => {},
  project: { cwd?: string; secrets?: () => readonly string[] } = {},
) {
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
    attempted: (_id: string, commandId: string) => receipts.has(commandId),
    receipt: (input: { commandId: string }) =>
      receipts.has(input.commandId)
        ? { kind: "accepted", commandId: input.commandId }
        : undefined,
    send(
      input: { commandId: string; conversationId: string },
      control: ConversationControl | undefined,
      beforeAccept?: () => void,
      _claimImages?: unknown,
      afterAccept?: () => void,
    ) {
      beforeAccept?.();
      // The real owner records the turn before the control state commits.
      turns.set(input.conversationId, [
        ...(turns.get(input.conversationId) ?? []),
        input.commandId,
      ]);
      receipts.add(input.commandId);
      control?.accept();
      afterAccept?.();
      if (control) controls.set(input.commandId, control);
      return { kind: "accepted", commandId: input.commandId };
    },
    latestRun: (id: string) => {
      const commandId = turns.get(id)?.at(-1);
      return commandId ? { commandId, settled: true } : null;
    },
  };
  const runs = new Map<string, WorkflowRun>();
  const results = new Map<
    string,
    { text: string; output: string; truncated: boolean }
  >();
  const detailReads: string[] = [];
  const active: WorkflowRun[] = [];
  /** Investigation identities the owner holds an answer under. */
  const recorded = new Set<string>();
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
    detail(runId: string, stepId: string): WorkbenchResult {
      detailReads.push(runId);
      const result = results.get(stepId);
      if (!runs.get(runId)?.steps.some((step) => step.id === stepId) || !result)
        throw new ContractError("unavailable");
      return {
        kind: "file",
        path: `workflow/${runId}/${stepId}`,
        ...workflowResultDetail({ stepId, result }, project.secrets?.() ?? []),
      };
    },
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
    investigationSummary: (investigation: string) => ({
      investigation,
      answer: "retained fixture",
    }),
    investigated: (id: string) => recorded.has(id),
    join: (id: string) => joinResearch(runs.get(id) as WorkflowRun),
    command(
      commandId: string,
      _epoch: string,
      r: WorkflowRequest,
      options?: { beforeAdmission?(): void },
    ) {
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
      if (r.action === "execute") options?.beforeAdmission?.();
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
        latestRun: conversations.latestRun,
        approvalHead: () => null,
      },
    },
    workflows,
    secrets: project.secrets ?? (() => []),
    ...(project.cwd
      ? {
          cwd: project.cwd,
          files: new WorkbenchFiles(
            project.cwd,
            [],
            project.secrets ?? (() => []),
          ),
        }
      : {}),
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
    results,
    detailReads,
    active,
    recorded,
    run,
    send,
    tool,
    settle,
    conversations,
    controls,
    instructions: (turn: string) => controls.get(turn)?.instructions ?? "",
    context: (
      turn: string,
      execution: { cwd: string; checkoutRoot: string } = {
        cwd: project.cwd ?? "/fixture/project",
        checkoutRoot: project.cwd ?? "/fixture/project",
      },
    ) => controls.get(turn)?.context?.(execution) ?? "",
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
  // Unrelated conversation state remains readable without a history link scan.
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

it("a displayed plan survives discussion and another conversation's implementation does not block research", async () => {
  const f = fixture();
  const id = randomUUID();
  let turn = f.send(id, "enter", "/cadence plan");
  const implementation = randomUUID();
  f.runs.set(implementation, f.run(implementation, "implementing"));
  f.active.push(f.runs.get(implementation) as WorkflowRun);
  // Another workflow does not block publishing; approval re-binds observation.
  const published = await f.tool(turn, "cadence_plan", plan());
  expect(published).toMatchObject({ proposalId: expect.any(String) });
  const concurrent = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["q"],
  });
  expect(concurrent).toMatchObject({
    id: expect.any(String),
    status: "running",
  });
  const invalid = await f.tool(turn, "cadence_plan", { ...plan(), checks: [] });
  expect(invalid).toMatchObject({ refused: "invalid-plan" });
  // The refusal names the field and asks for the same plan again, corrected.
  expect(invalid.notice).toMatch(/^checks: needs at least one/u);
  expect(invalid.notice).toContain("publish the same plan again in this turn");
  await f.settle(turn);
  const proposal = f.cw.records.state(id).proposal;
  expect(proposal?.id).toBe(published.proposalId);
  // Independent investigations can also overlap.
  f.active.splice(0, 1, f.run(randomUUID(), "research"));
  turn = f.send(id, "message", "what does task b do?");
  expect(f.cw.records.state(id).proposal).toEqual(proposal);
  const research = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["q"],
  });
  expect(research).toMatchObject({
    id: expect.any(String),
    questions: [{ question: 1, status: "not-asked" }],
  });
  expect(f.cw.records.state(id).runs).toHaveLength(2);
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
    ).toMatchObject({ questions: [{ question: 1 }] });
  expect(f.cw.records.state(id).runs).toHaveLength(4);
  expect(await f.tool(turn, "cadence_plan", plan())).toMatchObject({
    proposalId: expect.any(String),
  });
  await f.settle(turn);
  expect(() => f.send(id)).not.toThrow();
});

it("a refused plan names the field at fault and is never steered into a smaller plan", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence plan");
  const instructions = f.instructions(turn);
  expect(instructions).toContain("correct exactly that and call again");
  expect(instructions).toContain("There is one plan.");
  expect(instructions).not.toContain("do not retry automatically");
  const investigation = randomUUID(),
    step = `research-2-${randomUUID()}`,
    unrecorded = randomUUID();
  f.recorded.add(investigation);
  f.recorded.add(step.slice("research-2-".length));
  const reading = (research: string) => ({
    ...plan(),
    reviewReads: [{ research, reason: "What the change must keep" }],
  });
  // The reported case: a research step's own id where an identity was wanted.
  // It names the same answer, so the plan is published with its identity.
  const byStep = await f.tool(turn, "cadence_plan", reading(step));
  expect(byStep).toMatchObject({ proposalId: expect.any(String) });
  expect(f.cw.records.state(id).proposal?.plan.reviewReads).toEqual([
    {
      research: step.slice("research-2-".length),
      reason: "What the change must keep",
    },
  ]);
  expect(
    await f.tool(turn, "cadence_plan", reading(investigation)),
  ).toMatchObject({ proposalId: expect.any(String) });
  for (const [args, said] of [
    [
      reading("research-2"),
      /^reviewReads\[0\]\.research: "research-2" is not an investigation/u,
    ],
    [
      reading(unrecorded),
      /^reviewReads\[0\]\.research: no answer is recorded under/u,
    ],
    [{ ...plan(), goal: "" }, /^goal: must not be empty/u],
    [
      { ...plan(), tasks: [{ ...plan().tasks[0], dependsOn: ["b"] }] },
      /^tasks\[0\]: has no field "dependsOn"; its fields are id, title, instructions, writes, after, reads/u,
    ],
    [
      {
        ...plan(),
        tasks: [{ ...plan().tasks[0], instructions: "指".repeat(2731) }],
      },
      /^tasks\[0\]\.instructions: is 8193 bytes; at most 8192/u,
    ],
    [
      { ...plan(), design: "x".repeat(20000), acceptance: "y".repeat(13000) },
      /^plan: goal, design, decisions, assumptions and acceptance are \d+ bytes together \(goal \d+, design 20000, decisions \d+, assumptions 0, acceptance 13000\); together at most 32768/u,
    ],
  ] as const) {
    const refused = await f.tool(turn, "cadence_plan", args);
    expect(refused, JSON.stringify(refused)).toMatchObject({
      refused: "invalid-plan",
    });
    expect(refused.notice).toMatch(said);
    expect(refused.notice).toContain(
      "do not shorten, split or otherwise reduce it",
    );
    expect(refused.notice).not.toContain("oversize");
  }
  await f.settle(turn);
});

it("a plan may leave out what is empty, and an investigation takes what a model plausibly sends", async () => {
  const f = fixture();
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence plan");
  const full = plan();
  const brief = {
    goal: full.goal,
    design: full.design,
    acceptance: full.acceptance,
    tasks: full.tasks.map(({ id, title, instructions, writes }) => ({
      id,
      title,
      instructions,
      writes,
    })),
    checks: full.checks,
    delivery: full.delivery,
    assumptions: null,
  };
  expect(await f.tool(turn, "cadence_plan", brief)).toMatchObject({
    proposalId: expect.any(String),
  });
  expect(f.cw.records.state(id).proposal?.plan).toEqual({
    ...full,
    decisions: "",
  });
  // Blank and repeated questions are dropped, an unknown field is ignored and
  // a lone question need not be a list.
  for (const [args, count] of [
    [{ goal: "g", questions: [" first ", "", "first", "second"] }, 2],
    [{ goal: "g", questions: "only one", parallel: 4, roots: [] }, 1],
    [
      { goal: "g", questions: Array.from({ length: 32 }, (_, i) => `q${i}`) },
      32,
    ],
  ] as const) {
    const result = await f.tool(turn, "cadence_research", args);
    expect(result.questions, JSON.stringify(result)).toHaveLength(count);
  }
  for (const [args, said] of [
    [
      { goal: "g", questions: Array.from({ length: 33 }, (_, i) => `q${i}`) },
      /^questions: has 33 questions; one investigation takes at most 32/u,
    ],
    [{ goal: "g", questions: ["", "  "] }, /^questions: needs at least one/u],
    [{ goal: "g", questions: [1] }, /^questions\[0\]: must be text/u],
    [{ questions: ["q"] }, /^goal: is missing/u],
  ] as const) {
    const refused = await f.tool(turn, "cadence_research", args);
    expect(refused).toMatchObject({ refused: "invalid" });
    expect(refused.notice).toMatch(said);
    expect(refused.notice).toContain("No investigation was started");
  }
  await f.settle(turn);
});

it("a research result has one entry per question: its last step, and the identity only of an answer", async () => {
  const child = randomUUID(),
    reusedStep = randomUUID();
  const step = (
    id: string,
    status: WorkflowRun["steps"][number]["status"],
    text: string,
    childRunId?: string,
  ): WorkflowRun["steps"][number] => ({
    id,
    ...(childRunId ? { childRunId } : {}),
    kind: "research",
    status,
    text,
    exitCode: status === "completed" ? 0 : 1,
    truncated: false,
  });
  const f = fixture(async (run) => {
    run.status = "completed";
    run.notice =
      "2 of 3 questions were answered; an unanswered one was asked a second time first.";
    run.steps = [
      step(
        `research-1-${randomUUID()}`,
        "failed",
        "first attempt",
        randomUUID(),
      ),
      step(
        `research-2-${reusedStep}`,
        "completed",
        "Reused recorded investigation",
      ),
      step(
        `research-3-${randomUUID()}`,
        "failed",
        "first attempt",
        randomUUID(),
      ),
      // Asked again, alone, after the others.
      step(`research-1-${randomUUID()}`, "completed", "A".repeat(5000), child),
      step(
        `research-3-${randomUUID()}`,
        "failed",
        "The model request failed and automatic retries did not recover it.\nProvider: 429 rate limit (12 automatic retries)",
        randomUUID(),
      ),
    ];
  });
  const id = randomUUID();
  const turn = f.send(id, "enter", "/cadence investigate");
  const result = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["one", "two", "three"],
  });
  expect(result).toEqual({
    id: expect.any(String),
    status: "completed",
    notice: expect.stringContaining("2 of 3 questions were answered"),
    questions: [
      {
        question: 1,
        status: "completed",
        investigation: child,
        text: expect.stringMatching(/^A{100}/u),
        truncated: true,
        result: { runId: result.id, stepId: expect.any(String) },
      },
      {
        question: 2,
        status: "completed",
        investigation: reusedStep,
        text: "Reused recorded investigation",
        truncated: false,
        result: { runId: result.id, stepId: expect.any(String) },
      },
      {
        question: 3,
        status: "failed",
        text: expect.stringContaining("Provider: 429 rate limit"),
        truncated: false,
        result: { runId: result.id, stepId: expect.any(String) },
      },
    ],
  });
  expect(
    Buffer.byteLength((result.questions as { text: string }[])[0].text),
  ).toBeLessThanOrEqual(4096);
  await f.settle(turn);
});

it("coordinators can read the retained answer past its preview without another investigation", async () => {
  const secrets = ["private-canary"];
  const stepId = `research-1-${randomUUID()}`;
  // Escapes and astral characters exercise encoded IPC bounds and page edges.
  const answer =
    '"\\\n😀'.repeat(18000) +
    " The requested conclusion is at the end. private-canary";
  const f = fixture(
    async (run) => {
      run.status = "completed";
      run.steps = [
        {
          id: stepId,
          kind: "research",
          status: "completed",
          text: answer.slice(0, 16384),
          exitCode: 0,
          truncated: true,
        },
      ];
    },
    { secrets: () => secrets },
  );
  f.results.set(stepId, { text: answer, output: "", truncated: true });
  const turn = f.send(randomUUID(), "enter");
  const research = await f.tool(turn, "cadence_research", {
    goal: "g",
    questions: ["one"],
  });
  const question = (
    research.questions as { text: string; result: Record<string, unknown> }[]
  )[0];
  expect(question.text).not.toContain("requested conclusion");
  expect(question.result).toEqual({ runId: research.id, stepId });
  const explicitFirst = { ...question.result, offset: 0, digest: "" };
  const initial = await f.tool(turn, "cadence_status", explicitFirst);
  expect(initial).toMatchObject({
    offset: 0,
    next: { digest: initial.digest },
  });
  expect(await f.tool(turn, "cadence_status", explicitFirst)).toEqual(initial);
  let request: Record<string, unknown> = explicitFirst;
  let retained = "";
  let first: Record<string, unknown> | undefined;
  for (;;) {
    const page = await f.tool(turn, "cadence_status", request);
    first ??= page;
    expect(
      Buffer.byteLength(
        JSON.stringify({ id: 1, ok: true, text: JSON.stringify(page) }),
      ),
    ).toBeLessThan(384 * 1024);
    expect(page.limited).toBe(true); // A retained capture limit never becomes complete.
    const text = page.text as string;
    expect(text).not.toMatch(/[\ud800-\udfff]/u);
    expect(text).not.toContain("private-canary");
    retained += text;
    if (!page.next) break;
    request = page.next as Record<string, unknown>;
  }
  expect(JSON.parse(retained).result.text).toContain(
    "requested conclusion is at the end",
  );
  expect(f.runs.size).toBe(1);
  const other = randomUUID();
  f.runs.set(other, f.run(other, "research"));
  const reads = f.detailReads.length;
  expect(
    await f.tool(turn, "cadence_status", { runId: other, stepId }),
  ).toMatchObject({ refused: "invalid" });
  expect(f.detailReads.length).toBe(reads);
  expect(
    await f.tool(turn, "cadence_status", { ...question.result, offset: 1 }),
  ).toMatchObject({ refused: "invalid" });
  expect(
    await f.tool(turn, "cadence_status", { ...question.result, offset: 1 }),
  ).toMatchObject({ restarted: true, offset: 0, next: first!.next });
  secrets.push("requested conclusion");
  expect(await f.tool(turn, "cadence_status", first!.next)).toMatchObject({
    refused: "changed-result",
  });
  const fresh = await f.tool(turn, "cadence_status", question.result);
  expect(fresh.digest).not.toBe(first!.digest);
  expect(
    await f.tool(turn, "cadence_status", {
      ...question.result,
      stepId: "unknown",
    }),
  ).toMatchObject({ refused: "unavailable" });
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER])
    expect(
      await f.tool(turn, "cadence_status", {
        ...question.result,
        offset,
        digest: fresh.digest,
      }),
    ).toMatchObject({ refused: "invalid" });
  f.results.set(stepId, {
    text: "Whole retained answer",
    output: "",
    truncated: false,
  });
  expect(await f.tool(turn, "cadence_status", question.result)).toMatchObject({
    limited: false,
    next: null,
  });
  await f.settle(turn);
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
  f.active.push(f.runs.get(runId) as WorkflowRun);
  // The same conversation cannot replace its accepted task. Another
  // conversation still publishes and prepares its independent plan.
  const followup = f.send(id);
  expect(
    await f.tool(followup, "cadence_research", {
      goal: "another goal",
      questions: ["q"],
    }),
  ).toMatchObject({ refused: "checkout-busy" });
  await f.tool(followup, "cadence_plan", plan());
  await f.settle(followup);
  await expect(approve()).rejects.toThrow("conflict");
  const other = randomUUID();
  const otherTurn = f.send(other, "enter", "/cadence parallel");
  await f.tool(otherTurn, "cadence_plan", plan());
  await f.settle(otherTurn);
  const state = f.cw.records.state(other);
  expect(
    f.cw.approval(
      {
        kind: "cadence-prepare",
        commandId: randomUUID(),
        conversationId: other,
        revision: state.revision,
        proposalId: state.proposal!.id,
        digest: state.proposal!.digest,
      },
      caller,
    ),
  ).toMatchObject({ kind: "cadence-grant" });
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
      workerSettings: () => fixtureRuntime(),
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
      workerSettings: () => fixtureRuntime(),
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
  // Historical links are no longer an activity attribution index. They remain
  // untouched; the owner's immutable execution context supplies live attribution.
  expect(
    readFileSync(join(linkDirectory, `${full.state.runs[0]}.json`), "utf8"),
  ).toBe(JSON.stringify({ runId: full.state.runs[0], conversationId: id }));
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
  expect(f.cw.records.observe(id).notice).toBeDefined();
  f.ioFault();
  // Unchanged record bytes: the next read is a fresh, usable observation.
  expect(f.cw.records.observe(id)).toMatchObject({ enabled: true });
  expect(f.cw.records.observe(id).notice).toBeUndefined();
  expect(f.cw.records.state(id).notice).toBeUndefined();
  expect(f.cw.records.state(id).runs).toContain(runId);
});

it("a turn that reaches the coordinator carries the project's route table; leaving reads neither it nor the owner's secrets", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cadence-route-table-"));
  mkdirSync(join(cwd, ".cadence"), { recursive: true });
  writeFileSync(
    join(cwd, ".cadence/project.md"),
    "# Project knowledge\n\n## Routes\n\n- `src/search` -> `engineering/search.md#Tokens` — how text is split\n",
  );
  let available = true,
    asked = 0;
  const f = fixture(undefined, {
    cwd,
    // What the owner knows as secret comes from its model context, which may
    // be unusable when the user only wants to leave.
    secrets: () => {
      asked++;
      if (!available) throw new ContractError("stale");
      return [];
    },
  });
  const id = randomUUID();
  const entered = f.send(id, "enter", "/cadence");
  expect(f.instructions(entered)).not.toContain("engineering/search.md#Tokens");
  expect(f.context(entered)).toContain(
    "PROJECT ROUTE TABLE (.cadence/project.md",
  );
  expect(f.context(entered)).toContain(
    "`src/search` -> `engineering/search.md#Tokens`",
  );
  available = false;
  asked = 0;
  const left = f.send(id, "exit", "exit cadence");
  expect(f.cw.records.state(id).enabled).toBe(false);
  expect(asked).toBe(0);
  // The shared policy stays static; leaving attaches no dynamic context and reads no route table.
  expect(f.instructions(left)).not.toContain("engineering/search.md#Tokens");
  expect(f.context(left)).toBe("");
});

it("a batch survives refresh, refuses stale edits and grants, and starts no work on submission", async () => {
  const f = fixture(),
    id = randomUUID();
  const read = () => f.cw.records.state(id);
  const start = f.send(id, "enter");
  const [firstQuestion, dependent, lastQuestion] = designQuestionsFixture;
  for (const [when, field] of [
    [{ question: firstQuestion.id, option: "" }, "option"],
    [{ question: "", option: "frames" }, "question"],
    [{ question: lastQuestion.id, option: "quiet" }, "question"],
    [{ question: firstQuestion.id, option: "missing" }, "option"],
  ] as const) {
    expect(
      await f.tool(start, "cadence_design", {
        questions: [firstQuestion, { ...dependent, when }, lastQuestion],
      }),
    ).toMatchObject({
      refused: "invalid",
      notice: expect.stringContaining(`questions[1].when.${field}:`),
    });
    expect(read().design).toBeUndefined();
  }
  // A strict provider supplied both empty strings on every independent question.
  expect(
    await f.tool(start, "cadence_design", {
      questions: [
        { ...firstQuestion, when: { question: "", option: "" } },
        dependent,
        { ...lastQuestion, when: null },
      ],
    }),
  ).toMatchObject({ designId: expect.any(String) });
  expect(read().design?.questions).toEqual(designQuestionsFixture);
  expect(read().design?.at).toEqual(expect.any(Number));
  expect(await f.tool(start, "cadence_plan", plan())).toMatchObject({
    refused: "design-pending",
  });
  await f.settle(start);
  const first = read();
  expect(first.design?.submitted).toBe(false);
  const edit = (
    state: typeof first,
    answers: NonNullable<typeof first.design>["answers"],
  ) =>
    f.cw.editDesign(
      {
        kind: "cadence-design-edit",
        commandId: randomUUID(),
        conversationId: id,
        revision: state.revision,
        designId: state.design!.id,
        answers,
      },
      caller,
    );
  edit(first, [
    { question: "surface", option: "everywhere" },
    { question: "blur", option: "heavy" },
    { question: "motion", other: "Keep keyboard focus still" },
  ]);
  expect(() => edit(first, [])).toThrow("stale");
  const before = read();
  edit(before, [
    { question: "surface", option: "frames" },
    ...before.design!.answers.slice(1),
  ]);
  const changed = read().design!;
  expect(changed.answers).toEqual([
    { question: "surface", option: "frames" },
    { question: "motion", other: "Keep keyboard focus still" },
  ]);
  expect(f.turns.get(id)).toEqual([start]);
  expect(() => f.send(id, "design", "stale client summary")).toThrow("stale");
  const submitted = f.send(
    id,
    "design",
    designSummary(reviseDesign(changed, changed.answers, true)),
  );
  expect(read().design?.submitted).toBe(true);
  expect(await f.tool(submitted, "cadence_status", {})).toMatchObject({
    design: read().design,
  });
  expect(f.instructions(submitted)).not.toContain("Keep keyboard focus still");
  expect(f.context(submitted)).not.toContain("Keep keyboard focus still");
  await f.tool(submitted, "cadence_plan", plan());
  await f.settle(submitted);
  const shown = read();
  expect(shown.proposal).toBeTruthy();
  expect(f.runs.size).toBe(0);
  const binding = {
    conversationId: id,
    revision: shown.revision,
    proposalId: shown.proposal!.id,
    digest: shown.proposal!.digest,
  };
  const grant = f.cw.approval(
    { kind: "cadence-prepare", commandId: randomUUID(), ...binding },
    caller,
  );
  if (grant.kind !== "cadence-grant") throw Error("grant");
  edit(shown, [{ question: "surface", other: "Opaque" }]);
  expect(read().proposal).toBeNull();
  expect(() =>
    f.cw.approval(
      {
        kind: "cadence-approve",
        commandId: randomUUID(),
        ...binding,
        grant: grant.grant,
      },
      caller,
    ),
  ).toThrow("stale");
  const recommended = f.send(id, "message", "按你推荐的来");
  expect(read().design?.submitted).toBe(true);
  expect(read().design?.answers).toContainEqual({
    question: "motion",
    option: "quiet",
  });
  await f.tool(recommended, "cadence_plan", plan());
  await f.settle(recommended);
  expect(f.runs.size).toBe(0);
  const ready = read();
  const readyBinding = {
    conversationId: id,
    revision: ready.revision,
    proposalId: ready.proposal!.id,
    digest: ready.proposal!.digest,
  };
  const nextGrant = f.cw.approval(
    { kind: "cadence-prepare", commandId: randomUUID(), ...readyBinding },
    caller,
  );
  if (nextGrant.kind !== "cadence-grant") throw Error("grant");
  f.cw.approval(
    {
      kind: "cadence-approve",
      commandId: randomUUID(),
      ...readyBinding,
      grant: nextGrant.grant,
    },
    caller,
  );
  expect(read().proposal).toBeNull();
  expect(read().design).toBeUndefined();
  expect(() => edit(ready, [])).toThrow("stale");
});

it("design decoding stays backward compatible with undated records and active execution blocks submitted design edits", async () => {
  const undated = newDesign(randomUUID(), {
    questions: designQuestionsFixture,
  });
  expect(undated.at).toBeUndefined();
  expect(decodeDesign(undated)).toEqual(undated);
  const dated = newDesign(
    randomUUID(),
    { questions: designQuestionsFixture },
    undefined,
    1_700_000_000_000,
  );
  expect(decodeDesign(dated)).toEqual(dated);
  expect(() => decodeDesign({ ...dated, at: -1 })).toThrow("invalid");
  expect(() => decodeDesign({ ...dated, at: "now" })).toThrow("invalid");

  // Legacy persisted state from before retirement-on-approval may still carry
  // a submitted design while an implementation run is active: edits refuse.
  const f = fixture(),
    id = randomUUID(),
    turn = f.send(id, "enter");
  await f.tool(turn, "cadence_design", { questions: designQuestionsFixture });
  await f.settle(turn);
  const submitTurn = f.send(id, "message", "按你推荐的来");
  await f.settle(submitTurn);
  const current = f.cw.records.state(id);
  const runId = randomUUID();
  f.active.push({
    id: runId,
    goal: "Legacy running implementation",
    status: "running",
    phase: "implementing",
    notice: "",
    steps: [],
  } as unknown as WorkflowRun);
  writeFileSync(
    f.cw.records.path(id),
    canonicalJson({
      schema: "cadence-conversation-workflow/1",
      state: { ...current, runs: [runId] },
    }),
  );
  expect(() =>
    f.cw.editDesign(
      {
        kind: "cadence-design-edit",
        commandId: randomUUID(),
        conversationId: id,
        revision: current.revision,
        designId: current.design!.id,
        answers: [],
      },
      caller,
    ),
  ).toThrow("conflict");
});

it("a coordinator reads current project sections without a research run", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "read-knowledge-"));
  const doc = join(cwd, "AGENTS.md");
  writeFileSync(
    doc,
    "# Project\n## Themes\nKeep contrast. secret-canary\n## Delivery\nUnrelated detail.\n",
  );
  const f = fixture(undefined, { cwd, secrets: () => ["secret-canary"] });
  const turn = f.send(randomUUID(), "enter");
  const read = () =>
    f.tool(turn, "cadence_knowledge", { path: "AGENTS.md", section: "Themes" });
  const first = await read();
  expect(first).toMatchObject({
    section: "Themes",
    digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    limited: false,
  });
  expect(first.excerpt).toContain("Keep contrast.");
  expect(first.excerpt).not.toMatch(/secret-canary|Unrelated/);
  writeFileSync(doc, "## Themes\nPrefer solid text surfaces.");
  expect((await read()).digest).not.toBe(first.digest);
  const source = "reference.css";
  writeFileSync(
    join(cwd, source),
    "/* secret-canary */\n:root {\n  --glass-bg: light-dark(white, black);\n}\n",
  );
  const fact = await f.tool(turn, "cadence_knowledge", {
    path: source,
    match: "--glass-bg",
  });
  expect(fact).toMatchObject({
    line: 3,
    firstLine: 1,
    limited: false,
    digest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(fact.excerpt).toContain("--glass-bg: light-dark(white, black)");
  expect(fact.excerpt).not.toContain("secret-canary");
  writeFileSync(
    join(cwd, source),
    Array.from(
      { length: 20 },
      (_, n) => `.menu-${n} { background: var(--menu-bg); }`,
    ).join("\n"),
  );
  const uses = await f.tool(turn, "cadence_knowledge", {
    path: source,
    match: "--menu-bg",
  });
  expect(uses.matchingLines).toBe(20);
  expect(uses.matches).toHaveLength(16);
  expect(uses.matches).toContainEqual({
    line: 16,
    text: ".menu-15 { background: var(--menu-bg); }",
  });
  writeFileSync(join(cwd, "auth.json"), '{"secret":"private contents"}');
  expect(
    await f.tool(turn, "cadence_knowledge", {
      path: "auth.json",
      match: "secret",
    }),
  ).not.toHaveProperty("excerpt");
  expect(
    await f.tool(turn, "cadence_knowledge", {
      path: source,
      match: "--glass-bg",
      section: "ignored",
    }),
  ).toMatchObject({ refused: "invalid" });
  expect(f.runs.size).toBe(0);
  await f.settle(turn);
});

it("observes Git placement and local dependency links without a research worker or repository-wide cleanliness prerequisite", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "checkout-facts-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=work");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=local@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "base",
  );
  // An unrelated untracked file is harmless to plan publication.
  writeFileSync(join(cwd, "unrelated"), "");
  mkdirSync(join(cwd, "web"));
  const dependency = mkdtempSync(join(tmpdir(), "private-dependency-"));
  symlinkSync(dependency, join(cwd, "node_modules"), "junction");
  const f = fixture(undefined, { cwd });
  const turn = f.send(randomUUID(), "enter");
  const read = (checkout: string[]) =>
    f.tool(turn, "cadence_knowledge", { checkout });
  const result = await read(["node_modules", "web", "web/node_modules"]);
  expect(result).toMatchObject({
    checkout: cwd,
    branch: "refs/heads/work",
    head: git("rev-parse", "HEAD"),
    entries: [
      { path: "node_modules", kind: "symlink" },
      { path: "web", kind: "directory" },
      { path: "web/node_modules", kind: "absent" },
    ],
  });
  expect(JSON.stringify(result)).not.toContain(dependency);
  expect(await read(["node_modules/inner"])).toMatchObject({
    refused: "unavailable",
    notice: expect.stringContaining("linked ancestor"),
  });
  expect(await read(["../secret"])).toMatchObject({ refused: "invalid" });
  expect(await read([".git"])).toMatchObject({ refused: "invalid" });
  git("checkout", "--quiet", "--detach", "HEAD");
  expect(await read([])).toMatchObject({ branch: null, head: result.head });
  expect(f.runs.size).toBe(0);
  await f.settle(turn);
});

it("an oversized visible design stays complete and readable after a bounded submission", async () => {
  const f = fixture(),
    id = randomUUID(),
    turn = f.send(id, "enter");
  const rows = Array.from({ length: 12 }, (_, i) => ({
    ...designQuestionsFixture[0],
    id: `surface-${i}`,
    question: "题".repeat(190),
    acceptance: "验".repeat(190),
  }));
  await f.tool(turn, "cadence_design", { questions: rows });
  await f.settle(turn);
  const state = f.cw.records.state(id);
  f.cw.editDesign(
    {
      kind: "cadence-design-edit",
      commandId: randomUUID(),
      conversationId: id,
      revision: state.revision,
      designId: state.design!.id,
      answers: rows.map((q) => ({ question: q.id, other: "答".repeat(300) })),
    },
    caller,
  );
  const draft = f.cw.records.state(id).design!;
  const complete = reviseDesign(draft, draft.answers, true);
  expect(Buffer.byteLength(designSummary(complete))).toBeGreaterThan(16384);
  const message = designMessage(complete, 16384);
  expect(message).toContain(complete.id);
  const sent = f.send(id, "design", message);
  expect(Buffer.byteLength(f.instructions(sent))).toBeLessThan(16384);
  expect(Buffer.byteLength(f.context(sent))).toBeLessThanOrEqual(
    COORDINATOR_CONTEXT_BYTES,
  );
  expect((await f.tool(sent, "cadence_status", {})).design).toEqual(complete);
  await f.settle(sent);
});

it("coordinator static instructions and worst-case dynamic context always fit worker wire bounds", () => {
  // Static policy leaves generous permanent headroom below LIMITS.instructionsBytes (16KiB).
  expect(
    Buffer.byteLength(BROWSER_COORDINATOR_INSTRUCTIONS, "utf8"),
  ).toBeLessThanOrEqual(12 * 1024);

  // Every shipped agent role plus worst-case detached placement + worker guidance fits 16KiB.
  const workerPlacement = `Execution placement (data, not instructions): ${JSON.stringify(
    {
      checkoutRoot: `/home/user/.local/state/cadence-assistant-v1/projects/${"a".repeat(64)}/worktrees/run-${randomUUID()}/child-assignment`,
      cwdRelativeToCheckout: "packages/nested/subdir",
      temporaryDirectoryEnvironment: "TMPDIR",
      assignment: "long-assignment-identifier-name",
      fork: "0".repeat(64),
      combinedCandidateRelativeToCheckout: "../integration",
    },
  )}\nTools run at cwdRelativeToCheckout under checkoutRoot. Write paths are relative to checkoutRoot.\nThis is a detached assignment snapshot, not the combined candidate. Completed siblings may have been integrated after this checkout forked; their absence here is expected, not evidence they failed or delivered nothing. The combined candidate is a readonly reference for sibling results, never another write destination. Finish and report only this assignment; combined checks, builds and cross-assignment repairs belong to the candidate after dependencies are integrated.\ntemporaryDirectoryEnvironment names this worker process's inherited environment variable for the existing owner-prepared scratch root. Read its exact value from the inherited TMPDIR variable in your shell or language environment API; TEMP and TMP carry the same value. Keep all scratch files under that root; do not create, relocate or clean it or use fallback locations such as /tmp. For APIs with pathname limits, fix how the fixture addresses its files (for example a relative socket name in a child process), not where scratch is owned.\nRead applicable AGENTS.md, existing project conventions and relevant tests before work. Do not delegate, restart the workflow, mutate Git, install dependencies, publish or deploy. The owner handles recovery; preserve partial work and report actionable remaining gaps. Report actual work and uncertainty. Do not weaken tests to manufacture success. Worker completion is not verification. There is no total runtime deadline. Continue naturally; report a blocked assignment only for a concrete missing condition, preserving completed outputs and actionable remaining work. Do not duplicate the entire acceptance pipeline inside one worker.`;
  for (const file of [
    "design-explorer.md",
    "diagnosis-worker.md",
    "implementation-worker.md",
  ]) {
    const roleBody = readFileSync(
      new URL(`../agents/${file}`, import.meta.url),
      "utf8",
    );
    expect(
      Buffer.byteLength(`${roleBody}\n${workerPlacement}`, "utf8"),
    ).toBeLessThanOrEqual(LIMITS.instructionsBytes);
  }

  // Full 4KiB multibyte route table + 8 runs + displayed plan + submitted design
  // + long paths + max 32KiB user prompt must decode cleanly within LIMITS.publicRequestBytes.
  const cwd = mkdtempSync(join(tmpdir(), "cadence-budget-"));
  mkdirSync(join(cwd, ".cadence"), { recursive: true });
  writeFileSync(
    join(cwd, ".cadence/project.md"),
    `# Project knowledge\n\n## Routes\n\n${"- `src/模块` -> `engineering/架构说明.md#约束` — 中文路由说明条目\n".repeat(120)}`,
  );
  const longPath = `${cwd}/${"nested-workspace/".repeat(40)}app`;
  const context = buildCoordinatorContext({
    execution: { cwd: longPath, checkoutRoot: cwd },
    runs: Array.from({ length: 12 }, () => randomUUID()),
    proposal: {
      id: randomUUID(),
      epoch: randomUUID(),
      digest: "a".repeat(64),
      observation: "b".repeat(64),
      model: {
        epoch: randomUUID(),
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
      plan: { ...plan(), goal: "目".repeat(256) },
      cwd: longPath,
    },
    design: {
      id: randomUUID(),
      revision: 3,
      submitted: true,
      questions: [],
      answers: [],
    },
    projectRoot: cwd,
    secrets: [],
  });
  expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(
    COORDINATOR_CONTEXT_BYTES,
  );
  expect(context).toContain("PROJECT ROUTE TABLE (.cadence/project.md");
  expect(context).toContain(`cwd ${longPath}; checkout root ${cwd}`);
  const request = decodeWorkerPublicRequest({
    protocol: 2,
    taskId: randomUUID(),
    taskKind: "research",
    runId: randomUUID(),
    childRunId: randomUUID(),
    assignmentId: "conversation",
    purpose: "research",
    model: {
      sourceSelectionId: randomUUID(),
      provider: "openai",
      model: "gpt-5",
      api: "openai-responses",
      thinking: "high",
    },
    role: {
      role: "design-explorer",
      sha256: hash(BROWSER_COORDINATOR_INSTRUCTIONS),
    },
    context,
    instructions: BROWSER_COORDINATOR_INSTRUCTIONS,
    prompt: "p".repeat(32768),
    handoff: { graphRevision: 1, inputs: [] },
  });
  expect(Buffer.byteLength(canonicalJson(request), "utf8")).toBeLessThanOrEqual(
    LIMITS.publicRequestBytes,
  );

  // Tight context budget clips route table safely without throwing or breaking UTF-8.
  const tight = buildCoordinatorContext({
    execution: { cwd, checkoutRoot: cwd },
    runs: [randomUUID()],
    proposal: null,
    projectRoot: cwd,
    secrets: [],
    maxBytes: 900,
  });
  expect(Buffer.byteLength(tight, "utf8")).toBeLessThanOrEqual(900);
  expect(tight).toContain("[Route table truncated to context budget.]");
  expect(tight).not.toContain("\uFFFD");
});

it("browser model padding selects the actual reader; direct owner requests remain closed", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "lookup-"));
  writeFileSync(join(cwd, "notes.md"), "## One\nkeep\n## Two\nother\n");
  writeFileSync(join(cwd, "package.json"), '" verify "\n"verify"\n');
  mkdirSync(join(cwd, "node_modules"));
  const f = fixture(undefined, { cwd }),
    turn = f.send(randomUUID(), "enter");
  const lookup = vi.spyOn(f.cw, "knowledge");
  const padded = {
    checkout: [],
    path: "",
    section: "",
    match: "",
    investigation: "",
  };
  const call = (args: object) =>
    f.tool(turn, "cadence_knowledge", { ...padded, ...args });
  expect((await call({ path: "notes.md" })).excerpt).toContain("other");
  expect(
    (await call({ path: "notes.md", section: "One" })).excerpt,
  ).not.toContain("other");
  expect(await call({ path: "package.json", match: " verify " })).toMatchObject(
    { matchingLines: 1, match: " verify " },
  );
  expect(await call({ checkout: ["node_modules"] })).toMatchObject({
    entries: [{ path: "node_modules", kind: "directory" }],
    notice: expect.stringContaining("plan.links"),
  });
  expect(await call({ investigation: randomUUID() })).toMatchObject({
    answer: "retained fixture",
  });
  lookup.mockClear();
  for (const [args, field] of [
    [{ other: "" }, "other"],
    [{ match: "x" }, "path"],
    [{ path: "a", checkout: ["deps"] }, "checkout"],
    [{ investigation: 5 }, "investigation"],
  ] as const)
    expect(await call(args)).toMatchObject({
      refused: "invalid",
      notice: expect.stringContaining(field),
    });
  expect(lookup).not.toHaveBeenCalled();
  const owner = Object.assign(Object.create(Workbench.prototype), {
    cadence: f.cw,
    o: { owner: f.owner },
  });
  const read = (source: object) =>
    owner.read({ kind: "project-knowledge", source });
  expect(() =>
    read({ ...padded, path: "package.json", match: "verify" }),
  ).toThrow("invalid");
  expect(() => read({ checkout: [], extra: "" })).toThrow("invalid");
  expect(lookup).not.toHaveBeenCalled();
  expect(
    JSON.parse((await read({ path: "package.json", match: " verify " })).text),
  ).toMatchObject({ matchingLines: 1 });
  expect(lookup).toHaveBeenCalledOnce();
  await f.settle(turn);
});

it("an ordinary send with exitRevision atomically exits Cadence, retires plan/design, keeps runs and refuses stale or active states without effect", async () => {
  const f = fixture();
  const id = randomUUID();
  const enterTurn = f.send(id, "enter");
  // Publish a design draft and research run, submit design, then publish a plan.
  await f.tool(enterTurn, "cadence_design", {
    questions: designQuestionsFixture,
  });
  await f.tool(enterTurn, "cadence_research", {
    goal: "check",
    questions: ["q1"],
  });
  await f.settle(enterTurn);
  const draftDesign = f.cw.records.state(id).design!;
  const planTurn = f.send(
    id,
    "design",
    designSummary(reviseDesign(draftDesign, draftDesign.answers, true)),
  );
  await f.tool(planTurn, "cadence_plan", plan());
  const before = f.cw.records.state(id);
  expect(before.enabled).toBe(true);
  expect(before.design?.submitted).toBe(true);
  expect(before.proposal).not.toBeNull();
  expect(before.runs).toHaveLength(1);

  const ordinary = (
    overrides: Partial<Extract<WorkbenchCommand, { kind: "send" }>> = {},
  ): Extract<WorkbenchCommand, { kind: "send" }> => ({
    kind: "send",
    commandId: randomUUID(),
    conversationId: id,
    head: null,
    text: "handle directly",
    model: f.model,
    exitRevision: before.revision,
    ...overrides,
  });

  // Active coordinator turn refuses with conflict and changes nothing.
  expect(() => f.cw.exitAndSend(ordinary())).toThrow("conflict");
  expect(f.cw.records.state(id)).toEqual(before);

  await f.settle(planTurn);

  // Stale exitRevision refuses without changing state.
  expect(() =>
    f.cw.exitAndSend(ordinary({ exitRevision: before.revision - 1 })),
  ).toThrow("stale");
  expect(f.cw.records.state(id)).toEqual(before);

  // Ordinary send WITHOUT exitRevision still refuses via Workbench.send.
  const workbench = Object.assign(Object.create(Workbench.prototype), {
    o: { owner: f.owner },
    cadence: f.cw,
    conversations: f.conversations,
    images: { claim: () => [] },
  }) as Workbench;
  const plain = ordinary();
  delete plain.exitRevision;
  expect(() => workbench.command(plain)).toThrow(UnacceptedConversationCommand);
  expect(f.cw.records.state(id).enabled).toBe(true);

  // Atomic exit-and-send succeeds as an ordinary turn (no coordinator control).
  const cmd = ordinary();
  const accepted = workbench.command(cmd);
  expect(accepted).toEqual({ kind: "accepted", commandId: cmd.commandId });
  const after = f.cw.records.state(id);
  expect(after).toEqual({
    id,
    revision: before.revision + 1,
    enabled: false,
    head: cmd.commandId,
    proposal: null,
    runs: before.runs,
  });
  expect(after.design).toBeUndefined();
  expect(f.controls.has(cmd.commandId)).toBe(false);

  // Lost-reply retry observes its receipt idempotently.
  expect(workbench.command(cmd)).toEqual({
    kind: "accepted",
    commandId: cmd.commandId,
  });

  // Already-exited conversation refuses another exitRevision send with effect:none.
  expect(() =>
    workbench.command(ordinary({ exitRevision: after.revision })),
  ).toThrow(UnacceptedConversationCommand);
});
