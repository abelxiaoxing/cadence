// Independent Sends and messages sent into a running reply: admission, hand-over,
// withdrawal, settlement and what a read shows. The SDK worker is replaced by
// a stand-in that takes the owner's messages and writes the session as Pi and
// the worker's boundaries would. The real worker and owner are
// `worker-inputs` and `service-conversation-inputs`.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import { decodeActivity } from "../src/service/contracts/activity.ts";
import { ContractError } from "../src/service/contracts/core.ts";
import {
  decodeWorkbenchResult,
  RUN_INPUTS,
  WAITING_INPUTS,
  type WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import {
  NOT_DELIVERED,
  UNOBSERVED,
  WITHDRAWN,
} from "../src/service/conversation-records.ts";
import type { ConversationControl } from "../src/service/conversations.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceOwner } from "../src/service/owner.ts";
import { Workbench } from "../src/service/workbench.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import type {
  launchConversation,
  WorkerInput,
} from "../src/subagent-process.ts";
import type { RunResult } from "../src/task-types.ts";
import type { CaptureFrame, NativeSettlement } from "../src/worker-public.mjs";
import { coverage, deferred } from "./helpers/service-http-fixture.ts";

type Launch = typeof launchConversation;
const child = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  launchConversation: child.launch,
}));
// The fixture directory stands for a checkout root without running Git.
vi.mock("../src/workspace.ts", async (original) => ({
  ...(await original<typeof import("../src/workspace.ts")>()),
  resolveWorkspace: (cwd: string) => ({ root: cwd, cwd }),
}));

/** The worker's side of one launch. */
class Standin {
  /** What the owner handed over, in order. */
  readonly received: WorkerInput[] = [];
  readonly result: Promise<RunResult>;
  closeOnAbort = true;
  private connected = true;
  private close!: (result: RunResult) => void;
  private readonly file: string;
  private leaf: string | null;
  private written = 0;
  /** Entry ids stay unique when a later run continues the same session. */
  private readonly prefix = randomUUID().slice(0, 4);
  constructor(
    session: Parameters<Launch>[1]["session"],
    readonly signal: AbortSignal,
    private readonly options: Parameters<Launch>[3],
    cwd: string,
  ) {
    this.result = new Promise((resolve) => {
      this.close = resolve;
    });
    this.leaf = session.head;
    this.file =
      session.file ??
      join(session.dir, `2026-11-02T00-00-00-000Z_${session.id}.jsonl`);
    if (session.file === null) {
      mkdirSync(session.dir, { recursive: true });
      writeFileSync(
        this.file,
        `${JSON.stringify({ type: "session", version: 3, id: session.id, timestamp: new Date(0).toISOString(), cwd })}\n`,
      );
    }
    options.inputs?.open((message) => {
      if (this.connected) this.received.push(message);
      return this.connected;
    });
    // Cancel and Stop reach the real worker as a signal; it closes canceled.
    signal.addEventListener("abort", () => {
      if (this.closeOnAbort) this.end("canceled");
    });
  }
  private append(entry: Record<string, unknown>): string {
    const id = `${this.prefix}${(++this.written).toString(16).padStart(4, "0")}`;
    appendFileSync(
      this.file,
      `${JSON.stringify({ ...entry, id, parentId: this.leaf, timestamp: new Date(1_800_000_000_000 + this.written).toISOString() })}\n`,
    );
    this.leaf = id;
    return id;
  }
  private frame(kind: "ready" | "final") {
    this.options.onFrame({ event: { kind } } as unknown as CaptureFrame, []);
  }
  ready() {
    this.frame("ready");
  }
  /** Pi writes a message of `command` and its reply; the worker marks both.
   * `run` names the reply a message was sent into. */
  turn(
    command: string,
    text: string,
    run?: string,
    stopReason: "stop" | "toolUse" | "error" | "aborted" | null = "stop",
  ) {
    const boundary = (userId: string) =>
      this.append({
        type: "custom",
        customType: BROWSER_COMMAND_ENTRY,
        data: { commandId: command, userId, ...(run ? { run } : {}) },
      });
    const user = this.append({
      type: "message",
      message: { role: "user", content: [{ type: "text", text }] },
    });
    boundary(user);
    if (stopReason) {
      this.append({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: `Reply to ${text}` }],
          stopReason,
          ...(stopReason === "error"
            ? { errorMessage: "provider said no" }
            : {}),
        },
      });
      boundary(user);
    }
    return user;
  }
  /** The terminal writes into the same session meanwhile. */
  terminal(text: string) {
    return this.append({
      type: "message",
      message: { role: "user", content: [{ type: "text", text }] },
    });
  }
  /** The worker's answer to a withdrawal the owner asked for. */
  withdrawn(removed: boolean) {
    const asked = this.received.at(-1);
    if (asked?.kind !== "input-cancel") throw Error("no withdrawal asked");
    this.options.inputs?.withdrawn(asked.id, removed);
  }
  end(outcome: RunResult["outcome"] = "completed") {
    if (!this.connected) return;
    this.connected = false;
    if (outcome === "completed") this.frame("final");
    const closed = outcome !== "unknown";
    this.options.onNative({
      outcome,
      closure: closed ? "direct-child-closed" : "unconfirmed",
      exitCode: outcome === "completed" ? 0 : closed ? 1 : null,
      signal: null,
      durationMs: 1,
      stdin: "delivered",
      final: outcome === "completed" ? "valid" : "missing",
      cleanup: outcome === "completed" ? "settled" : "unconfirmed",
      capture: {
        observed: "complete",
        source: "complete",
        redacted: false,
        omissions: [],
      },
    } as NativeSettlement);
    this.close({
      outcome,
      closed,
      exitCode: outcome === "completed" ? 0 : closed ? 1 : null,
      signal: null,
      durationMs: 1,
      text: "",
      output: "",
      truncated: false,
    });
  }
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const code = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    return error instanceof ContractError ? error.code : String(error);
  }
  return "ok";
};

function fixture(root = mkdtempSync(join(tmpdir(), "conversation-input-"))) {
  const cwd = join(root, "project"),
    agentDir = join(root, "agent");
  for (const path of [cwd, agentDir])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const coordination = new ServiceCoordination(cwd, join(root, "state"));
  mkdirSync(coordination.directory, { recursive: true, mode: 0o700 });
  const epoch = randomUUID();
  const version = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const selected = {
    sourceSelectionId: randomUUID(),
    provider: "fixture",
    model: "fixed",
    api: "openai-completions" as const,
    thinking: "off" as const,
  };
  const owner = new ServiceOwner(
    { assert() {}, registration: { epoch }, phase() {}, release() {} } as never,
    {
      quiesce() {},
      flush: async () => ({
        status: "committed",
        batch: {
          committedSeq: "1",
          details: [],
          ownerDetails: [],
          coverage: { ...coverage, omissions: [] },
        },
      }),
      closeListener: async () => {},
    },
  );
  const originals = vi.spyOn(owner, "trackConversation");
  const gate = new CheckoutGate(owner);
  owner.registerRuntime(() => gate.closeAdmission(), {
    assertQuiescent: () => gate.assertQuiescent(),
  });
  const prepared = { status: "prepared", prepared: {} };
  const prepareTracked = vi.fn(() => ({
    settled: Promise.resolve(),
    result: Promise.resolve(prepared),
  }));
  let secrets: string[] = [];
  const workbench = new Workbench({
    coordination,
    owner,
    models: {
      assertCurrent() {},
      workerSettings: () => undefined,
      catalog: () => ({ entries: [] }),
      prepareTracked,
    } as never,
    choice: { snapshot: () => ({ version, selected }) } as never,
    gate,
    agentDir,
    cwd,
    projectsEnabled: false,
    hostUrl: new URL("../src/service-host.mjs", import.meta.url),
    secrets: () => secrets,
  });
  const conversations = workbench.conversations;
  const launches = new Map<string, (worker: Standin) => void>();
  child.launch.mockImplementation(((
    _prepared,
    conversation,
    signal,
    options,
  ) => {
    const worker = new Standin(conversation.session, signal, options, cwd);
    launches.get(conversation.session.id)?.(worker);
    return worker.result;
  }) satisfies Launch);
  const records = conversations.records;
  const message = (
    conversationId: string,
    text = "Start",
    head: string | null = null,
  ) => ({
    kind: "send" as const,
    commandId: randomUUID(),
    conversationId,
    head,
    text,
    model: version,
  });
  return {
    root,
    conversations,
    records,
    owner,
    epoch,
    workbench,
    gate,
    holdPreparation() {
      const entered = deferred(),
        allow = deferred();
      prepareTracked.mockImplementationOnce(() => {
        entered.resolve();
        return {
          result: allow.promise.then(() => prepared),
          settled: allow.promise,
        };
      });
      return { entered: entered.promise, release: allow.resolve };
    },
    holdSettlement(settled: Promise<void>) {
      prepareTracked.mockReturnValueOnce({
        result: Promise.resolve(prepared),
        settled,
      });
    },
    message,
    get settled() {
      return originals.mock.calls.map(([original]) => original);
    },
    secrets(value: string[]) {
      secrets = value;
    },
    /** A Send whose worker has started; `control` makes it a coordinator's. */
    async start(
      conversationId: string = randomUUID(),
      text = "Start",
      head: string | null = null,
      control?: ConversationControl,
    ) {
      const command = message(conversationId, text, head);
      const launched = deferred<Standin>();
      launches.set(conversationId, launched.resolve);
      try {
        if (control) conversations.send(command, control);
        else await workbench.command(command);
        return {
          conversationId,
          commandId: command.commandId,
          worker: await launched.promise,
        };
      } finally {
        launches.delete(conversationId);
      }
    },
    input(
      run: { conversationId: string; commandId: string },
      mode: "steer" | "queue",
      text: string,
      change: {
        commandId?: string;
        epoch?: string;
        coordinator?: boolean;
      } = {},
    ) {
      const commandId = change.commandId ?? randomUUID();
      conversations.input(
        {
          kind: "conversation-input",
          commandId,
          conversationId: run.conversationId,
          turnId: run.commandId,
          epoch: change.epoch ?? epoch,
          mode,
          text,
        },
        change.coordinator ?? false,
      );
      return commandId;
    },
    withdraw(
      run: { conversationId: string; commandId: string },
      inputId: string,
    ) {
      return conversations.cancelInput({
        kind: "conversation-input-cancel",
        commandId: randomUUID(),
        conversationId: run.conversationId,
        turnId: run.commandId,
        epoch,
        inputId,
      });
    },
    head(id: string, leaf: string | null = null) {
      const head = decodeWorkbenchResult(records.conversation(id, leaf, null));
      if (head.kind !== "conversation") throw Error("head");
      return head;
    },
    steps(id: string, leaf: string | null, ordinal: number) {
      const read = decodeWorkbenchResult(
        records.turnSteps(id, leaf, ordinal, null),
      );
      if (read.kind !== "conversation-turn") throw Error("turn");
      return read;
    },
    state: (commandId: string) => records.state(commandId),
  };
}
beforeEach(() => {
  child.launch.mockReset();
});

it("two sessions run independently even while a workflow holds exclusive checkout access", async () => {
  const f = fixture();
  const a = await f.start();
  a.worker.ready();
  a.worker.turn(a.commandId, "Start", undefined, null);
  // The same gate the workbench supplies to workflows. A's worker is still
  // open: it neither holds this permit nor waits for it to make progress.
  const permit = await f.gate.acquire(
    randomUUID(),
    new AbortController().signal,
    "exclusive",
  );
  const auth = f.holdPreparation();
  const id = randomUUID();
  const launchB = f.start(id, "Run B");
  const [commandId] = f.records.index(id).commands;
  const state = () => f.records.read(f.records.path(commandId, "state.json"));
  // First durable state, before run()'s first microtask.
  expect(state()).toMatchObject({ status: "starting", user: null });
  await auth.entered;
  expect(state()).toMatchObject({ status: "starting" });
  const live = { commandId, epoch: f.epoch };
  expect(
    decodeWorkbenchResult(
      await f.workbench.read({ kind: "conversation-active" }),
    ),
  ).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({ id, status: "starting", live }),
    ]),
  });
  expect(f.head(id)).toMatchObject({
    summary: { status: "starting", live },
    turns: 1,
  });
  const view = f.steps(id, null, 0);
  expect(view).toMatchObject({
    turn: { id: commandId, status: "starting" },
    steps: [{ role: "user", text: "Run B" }],
  });
  expect(view.turn).not.toHaveProperty("activity");
  expect(f.workbench.activity().map(decodeActivity)).toMatchObject([
    { id: a.commandId, phase: "running" },
    { id: commandId, phase: "starting" },
  ]);
  expect(f.records.latestRun(id)?.settled).toBe(false);
  expect(child.launch).toHaveBeenCalledTimes(1);
  auth.release();
  const b = await launchB;
  expect(state()).toMatchObject({ status: "running" });
  b.worker.ready();
  const user = b.worker.turn(b.commandId, "Run B");
  b.worker.end();
  expect(await f.settled[1]).toEqual({ status: "settled" });
  expect(state()).toMatchObject({ status: "completed", user });
  expect(f.head(a.conversationId)).toMatchObject({
    summary: { status: "running", live: { commandId: a.commandId } },
  });
  permit.assertHeld();
  permit.release();
  a.worker.end();
  await f.settled[0];
});

it("cancel targets just its session, including while its worker is still starting", async () => {
  const f = fixture(),
    a = await f.start();
  const auth = f.holdPreparation();
  const starting = f.message(randomUUID());
  f.workbench.command(starting);
  await auth.entered;
  f.conversations.interrupt(
    starting.conversationId,
    starting.commandId,
    f.epoch,
  );
  expect(f.workbench.activity().at(-1)?.phase).toBe("stopping");
  auth.release();
  await f.settled[1];
  expect(child.launch).toHaveBeenCalledTimes(1);
  expect(f.state(starting.commandId)).toMatchObject({ status: "canceled" });

  const b = await f.start();
  f.conversations.interrupt(b.conversationId, b.commandId, f.epoch);
  await f.settled[2];
  expect(b.worker.signal.aborted).toBe(true);
  expect(f.state(b.commandId)).toMatchObject({ status: "canceled" });
  expect(a.worker.signal.aborted).toBe(false);
  a.worker.turn(a.commandId, "Start");
  a.worker.end();
  await f.settled[0];
  expect(f.state(a.commandId).status).toBe("completed");
});

it("one live run per session and the owner limit refuse independent Sends without accepting or deferring them", async () => {
  const f = fixture();
  const refused = async (id: string, code: string) => {
    const command = f.message(id);
    const attempt = Promise.resolve().then(() => f.workbench.command(command));
    await expect(attempt).rejects.toBeInstanceOf(UnacceptedConversationCommand);
    await expect(attempt).rejects.toMatchObject({ code });
    expect(f.conversations.attempted(id, command.commandId)).toBe(false);
  };
  const first = await f.start();
  await refused(first.conversationId, "conflict");
  const rest = await Promise.all(Array.from({ length: 7 }, () => f.start()));
  await refused(randomUUID(), "capacity");
  expect(f.owner.acceptedPending).toBe(8);
  for (const run of [first, ...rest]) run.worker.end();
  await f.owner.idle();
  expect(f.settled).toHaveLength(8);
  expect(child.launch).toHaveBeenCalledTimes(8);
});

it("owner Stop signals both workers and joins both originals, through auth settlement and native close", async () => {
  const f = fixture();
  const auth = deferred();
  f.holdSettlement(auth.promise);
  const a = await f.start(),
    b = await f.start();
  b.worker.closeOnAbort = false; // stop requested is not original native close
  const stop = f.owner.stop();
  for (const run of [a, b])
    expect(run.worker.signal.reason).toMatchObject({
      source: "service",
      reason: "stop",
      target: run.commandId,
    });
  expect(f.owner.acceptedPending).toBe(2);
  auth.resolve();
  await f.settled[0];
  await turn(); // let owner accounting observe that original
  expect(f.owner.state).toBe("stopping");
  expect(f.owner.acceptedPending).toBe(1);
  b.worker.end("canceled");
  expect(await stop).toMatchObject({
    state: "stopped",
    settlement: "known",
    pending: { process: 0, work: 0 },
  });
  for (const run of [a, b])
    expect(f.state(run.commandId).status).toBe("canceled");
});

it("a message for a running reply is recorded before its worker hears of it, and is handed over only once the worker listens", async () => {
  const f = fixture(),
    secret = "fabricated-input-credential";
  const run = await f.start();
  f.secrets([secret]);
  // The worker has started and is not listening yet.
  const steer = f.input(run, "steer", `Use ${secret} instead`);
  expect(run.worker.received).toEqual([]);
  expect(f.records.accepted(steer)).toMatchObject({
    command: {
      kind: "conversation-input",
      turnId: run.commandId,
      mode: "steer",
      text: "Use [redacted] instead",
    },
    session: run.conversationId,
    parent: null,
    execution: f.records.accepted(run.commandId)?.execution,
  });
  expect(f.state(steer)).toMatchObject({ status: "queued", user: null });
  expect(f.records.index(run.conversationId).commands).toEqual([
    run.commandId,
    steer,
  ]);
  run.worker.ready();
  expect(run.worker.received).toEqual([
    { kind: "input", id: steer, mode: "steer", text: "Use [redacted] instead" },
  ]);
  // Once it listens, a message is handed over as it is admitted.
  const queued = f.input(run, "queue", `Then ${"long ".repeat(100)}`);
  expect(run.worker.received.map((message) => message.id)).toEqual([
    steer,
    queued,
  ]);
  const head = f.head(run.conversationId);
  expect(head).toMatchObject({
    summary: { live: { commandId: run.commandId, epoch: f.epoch } },
    turns: 1,
    commands: [run.commandId, steer, queued],
    pending: [
      { commandId: steer, mode: "steer", text: "Use [redacted] instead" },
      { commandId: queued, mode: "queue" },
    ],
  });
  expect(head.pending?.[1].text.length).toBeLessThan(256);
  expect(head).not.toHaveProperty("undelivered");
  // A lost reply asks again: the original acceptance, nothing handed twice.
  expect(
    f.input(run, "steer", `Use ${secret} instead`, { commandId: steer }),
  ).toBe(steer);
  expect(run.worker.received).toHaveLength(2);
  expect(
    await code(() =>
      f.input(run, "steer", "Something else", { commandId: steer }),
    ),
  ).toBe("conflict");
  run.worker.end();
  await f.settled[0];
});

it("refusals admit nothing: an unknown, ended or stopping reply, another epoch, the other kind of run, and the bounds", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  const refused = async (
    expected: string,
    target: Parameters<typeof f.input>[0] = run,
    change: Parameters<typeof f.input>[3] = {},
  ) => {
    const commandId = randomUUID();
    expect(
      await code(() =>
        f.input(target, "queue", "Later", { ...change, commandId }),
      ),
    ).toBe(expected);
    // No directory, record or index entry was left behind.
    expect(f.conversations.attempted(target.conversationId, commandId)).toBe(
      false,
    );
  };
  await refused("invalid", { ...run, commandId: randomUUID() });
  await refused("stale", run, { epoch: randomUUID() });
  await refused("stale", { ...run, conversationId: randomUUID() });
  // The conversation is not in Cadence mode: this is no coordinator turn.
  await refused("conflict", run, { coordinator: true });
  // At most eight wait at a time; a delivered or withdrawn one makes room.
  const waiting = Array.from({ length: WAITING_INPUTS }, (_, n) =>
    f.input(run, "queue", `Waiting ${n}`),
  );
  await refused("capacity");
  run.worker.turn(run.commandId, "Start");
  run.worker.turn(waiting[0], "Waiting 0", run.commandId);
  const next = f.input(run, "queue", "Room after a delivery");
  await refused("capacity");
  const asked = f.withdraw(run, next);
  run.worker.withdrawn(true);
  await asked;
  f.input(run, "queue", "Room after a withdrawal");
  // A message cannot be the reply another one is sent into, nor be stopped.
  await refused("invalid", { ...run, commandId: waiting[1] });
  expect(
    await code(() =>
      f.conversations.interrupt(run.conversationId, waiting[1], f.epoch),
    ),
  ).toBe("invalid");
  // The worker's final frame: it takes nothing after it.
  run.worker.end();
  await refused("stale");
  await f.settled[0];
  await refused("stale");
  // A reply being stopped takes nothing either.
  const stopping = await f.start();
  stopping.worker.ready();
  f.conversations.interrupt(
    stopping.conversationId,
    stopping.commandId,
    f.epoch,
  );
  await refused("stale", stopping);
  await f.settled[1];
  // An owner that can no longer vouch for its work admits nothing.
  const last = await f.start();
  last.worker.ready();
  f.owner.quarantine();
  await refused("quarantine", last);
  expect(await code(() => f.withdraw(last, randomUUID()))).toBe("quarantine");
});

it("one run takes thirty-two messages in all, withdrawn ones included", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  run.worker.turn(run.commandId, "Start", undefined, "toolUse");
  for (let n = 0; n < RUN_INPUTS; n++) {
    const id = f.input(run, "steer", `Steer ${n}`);
    if (n % 2) run.worker.turn(id, `Steer ${n}`, run.commandId, "toolUse");
    else {
      const asked = f.withdraw(run, id);
      run.worker.withdrawn(true);
      await asked;
    }
  }
  expect(await code(() => f.input(run, "steer", "One more"))).toBe("capacity");
  // Every command of the run is still in the session's index.
  expect(f.records.index(run.conversationId).commands).toHaveLength(
    RUN_INPUTS + 1,
  );
  run.worker.end();
  await f.settled[0];
  expect(f.head(run.conversationId).turns).toBe(RUN_INPUTS / 2 + 1);
});

it("settlement records what Pi was given: delivered messages are turns, the newest takes the outcome, the rest were not delivered", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  const steer = f.input(run, "steer", "Steer"),
    queued = f.input(run, "queue", "Queued"),
    late = f.input(run, "queue", "Arrived as the reply ended");
  const first = run.worker.turn(run.commandId, "Start", undefined, "toolUse");
  // While the steer is in Pi's hands the run is still one turn.
  expect(f.head(run.conversationId)).toMatchObject({ turns: 1, leaf: null });
  const steered = run.worker.turn(steer, "Steer", run.commandId);
  // Delivered: the run's first message is now an ordinary turn of the branch,
  // which ends where the steer began; the steer's turn is the live one.
  const live = f.head(run.conversationId);
  expect(live).toMatchObject({
    turns: 2,
    summary: { status: "running", live: { commandId: run.commandId } },
    pending: [{ commandId: queued }, { commandId: late }],
  });
  expect(live.leaf).not.toBeNull();
  expect(f.steps(run.conversationId, live.leaf, 0)).toMatchObject({
    turn: {
      id: first,
      status: "completed",
      execution: { cwd: expect.any(String) },
    },
    steps: [{ role: "user", text: "Start" }, { role: "assistant" }],
  });
  expect(f.steps(run.conversationId, live.leaf, 1)).toMatchObject({
    turn: { id: steered, status: "running" },
    steps: [{ role: "user", text: "Steer" }, { role: "assistant" }],
  });
  // The earlier branch end no longer carries a live turn.
  expect(await code(() => f.steps(run.conversationId, null, 1))).toBe("stale");
  const queuedUser = run.worker.turn(queued, "Queued", run.commandId);
  run.worker.end();
  expect(await f.settled[0]).toEqual({ status: "settled" });
  // Earlier messages end as Pi recorded their replies; the newest one Pi was
  // given takes the run's outcome.
  expect(f.state(run.commandId)).toMatchObject({
    status: "completed",
    user: first,
  });
  expect(f.state(steer)).toMatchObject({ status: "completed", user: steered });
  expect(f.state(queued)).toMatchObject({
    status: "completed",
    user: queuedUser,
  });
  expect(f.state(late)).toEqual({
    status: "canceled",
    notice: NOT_DELIVERED,
    user: null,
    omitted: { thinking: false, media: false, other: false },
  });
  const head = f.head(run.conversationId);
  expect(head).toMatchObject({
    turns: 3,
    summary: { status: "completed" },
    attempt: null,
    undelivered: [
      {
        commandId: late,
        text: "Arrived as the reply ended",
        status: "canceled",
        notice: NOT_DELIVERED,
      },
    ],
  });
  expect(head).not.toHaveProperty("pending");
  expect(head.summary).not.toHaveProperty("live");
  expect(
    [0, 1, 2].map(
      (ordinal) =>
        f.steps(run.conversationId, head.leaf, ordinal).steps[0].text,
    ),
  ).toEqual(["Start", "Steer", "Queued"]);
  // The notice lasts until the branch moves on.
  run.worker.terminal("Typed in the terminal");
  expect(f.head(run.conversationId)).not.toHaveProperty("undelivered");
});

it("a read naming where the live run was sent from follows the run to its newest message; an exact one does not", async () => {
  const f = fixture();
  const first = await f.start();
  first.worker.turn(first.commandId, "First");
  first.worker.end();
  await f.settled[0];
  const id = first.conversationId,
    from = f.head(id).leaf;
  const run = await f.start(id, "Second", from);
  run.worker.ready();
  const steer = f.input(run, "steer", "Steer");
  // A browser that chose the branch it sent from keeps naming that entry.
  expect(f.head(id, from)).toMatchObject({ leaf: from, turns: 2 });
  run.worker.turn(run.commandId, "Second", undefined, "toolUse");
  const steered = run.worker.turn(steer, "Steer", run.commandId, null);
  const followed = f.head(id, from);
  expect(followed).toMatchObject({
    turns: 3,
    continues: true,
    summary: { live: { commandId: run.commandId } },
  });
  expect(followed.leaf).not.toBe(from);
  expect(followed.leaf).toBe(f.head(id).leaf);
  expect(f.steps(id, followed.leaf, 2).turn.id).toBe(steered);
  // A turn read names its branch exactly: that entry ends one turn.
  expect(f.steps(id, from, 0).steps[0].text).toBe("First");
  expect(await code(() => f.steps(id, from, 1))).toBe("stale");
  run.worker.end();
  await f.settled[1];
  // Settled, the chosen branch is the one that was chosen again.
  expect(f.head(id, from)).toMatchObject({ leaf: from, turns: 1 });
  expect(f.head(id)).toMatchObject({ turns: 3 });
});

it("a reply that fails or is stopped delivers nothing further, and says so for each waiting message", async () => {
  const f = fixture();
  const failed = await f.start();
  failed.worker.ready();
  const waiting = [
    f.input(failed, "steer", "Steer"),
    f.input(failed, "queue", "Queued"),
  ];
  const user = failed.worker.turn(
    failed.commandId,
    "Start",
    undefined,
    "error",
  );
  failed.worker.end("failed");
  await f.settled[0];
  expect(f.state(failed.commandId)).toMatchObject({ status: "failed", user });
  expect(f.head(failed.conversationId)).toMatchObject({
    turns: 1,
    summary: { status: "failed" },
    undelivered: waiting.map((commandId) => ({
      commandId,
      status: "canceled",
      notice: NOT_DELIVERED,
    })),
  });
  // Stop before the worker wrote anything: the run's own message is the
  // attempt, and the one sent into it is reported beside it.
  const stopped = await f.start();
  const buffered = f.input(stopped, "queue", "Never handed over");
  f.conversations.interrupt(stopped.conversationId, stopped.commandId, f.epoch);
  await f.settled[1];
  expect(stopped.worker.received).toEqual([]);
  expect(f.head(stopped.conversationId)).toMatchObject({
    turns: 0,
    attempt: { commandId: stopped.commandId, status: "canceled" },
    undelivered: [{ commandId: buffered, notice: NOT_DELIVERED }],
  });
  expect(f.owner.state).toBe("idle");
});

it("only a waiting message is withdrawn: at once while the owner alone holds it, else when the worker confirms it", async () => {
  const f = fixture();
  const run = await f.start();
  // Not handed over yet: withdrawn here, and never handed over.
  const early = f.input(run, "queue", "Withdrawn early");
  expect(f.withdraw(run, early)).toMatchObject({ kind: "accepted" });
  expect(f.state(early)).toMatchObject({
    status: "canceled",
    notice: WITHDRAWN,
  });
  run.worker.ready();
  expect(run.worker.received).toEqual([]);
  // Again: the same answer, nothing asked of the worker.
  expect(f.withdraw(run, early)).toMatchObject({ kind: "accepted" });
  const held = f.input(run, "queue", "Still waiting"),
    steered = f.input(run, "steer", "Pi has this one");
  // The worker holds it: only its answer withdraws it.
  const first = f.withdraw(run, held),
    second = f.withdraw(run, held);
  expect(run.worker.received.at(-1)).toEqual({
    kind: "input-cancel",
    id: held,
  });
  expect(
    run.worker.received.filter((message) => message.kind === "input-cancel"),
  ).toHaveLength(1);
  expect(f.state(held).status).toBe("queued");
  run.worker.withdrawn(true);
  expect(await Promise.all([first, second])).toMatchObject([
    { kind: "accepted" },
    { kind: "accepted" },
  ]);
  expect(f.state(held)).toMatchObject({
    status: "canceled",
    notice: WITHDRAWN,
  });
  // Pi already has the steer: nothing changes.
  const refused = f.withdraw(run, steered);
  run.worker.withdrawn(false);
  expect(await code(() => refused)).toBe("conflict");
  expect(f.state(steered).status).toBe("queued");
  expect(f.head(run.conversationId).pending).toMatchObject([
    { commandId: steered },
  ]);
  expect(await code(() => f.withdraw(run, randomUUID()))).toBe("invalid");
  expect(
    await code(() => f.withdraw({ ...run, commandId: randomUUID() }, held)),
  ).toBe("invalid");
  // A question the worker never answered ends with it.
  const unanswered = f.withdraw(run, steered);
  run.worker.turn(run.commandId, "Start");
  run.worker.end();
  expect(await code(() => unanswered)).toBe("conflict");
  await f.settled[0];
  expect(await code(() => f.withdraw(run, steered))).toBe("stale");
  // Withdrawn messages are not reported as undelivered; the other one is.
  expect(f.head(run.conversationId).undelivered).toMatchObject([
    { commandId: steered, notice: NOT_DELIVERED },
  ]);
  expect(f.state(early).notice).toBe(WITHDRAWN);
});

it("an unknown outcome with recorded native closure permits startup without changing or replaying the old messages", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  const queued = f.input(run, "queue", "Not delivered");
  // A sibling storage/workflow failure may quarantine the owner even though
  // this conversation's own original process has confirmed its native close.
  f.owner.quarantine();
  run.worker.end("canceled");
  expect(await f.settled[0]).toEqual({ status: "uncertain" });
  expect(f.state(run.commandId).status).toBe("unknown");
  expect(f.state(queued).status).toBe("unknown");
  const next = fixture(f.root);
  expect(() => next.conversations.assertSettled()).not.toThrow();
  expect(next.state(run.commandId).status).toBe("unknown");
  expect(next.state(queued).status).toBe("unknown");
  expect(next.settled).toHaveLength(0);
});

it("an unknown closure leaves every message of the run unknown and refuses the next start; one the owner's death cut short does not", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  const steer = f.input(run, "steer", "Steer"),
    queued = f.input(run, "queue", "Queued"),
    withdrawn = f.input(run, "queue", "Withdrawn");
  const asked = f.withdraw(run, withdrawn);
  run.worker.withdrawn(true);
  await asked;
  run.worker.turn(run.commandId, "Start", undefined, "toolUse");
  const steered = run.worker.turn(steer, "Steer", run.commandId, null);
  run.worker.end("unknown");
  expect(await f.settled[0]).toEqual({ status: "uncertain" });
  expect(f.owner.state).toBe("quarantined");
  expect(f.state(run.commandId).status).toBe("unknown");
  expect(f.state(steer)).toMatchObject({ status: "unknown", user: steered });
  expect(f.state(queued)).toMatchObject({ status: "unknown", user: null });
  // Its worker confirmed it gone before the closure was lost.
  expect(f.state(withdrawn).notice).toBe(WITHDRAWN);
  // The index ends with the withdrawn message: the run's closure still counts.
  expect(f.records.index(run.conversationId).commands.at(-1)).toBe(withdrawn);
  expect(() => fixture(f.root)).toThrow("quarantine");

  // An owner that died mid-reply never settled anything: its successor
  // starts, and reads the unfinished messages as interrupted.
  const g = fixture();
  const cut = await g.start();
  cut.worker.ready();
  const delivered = g.input(cut, "steer", "Delivered before the crash"),
    waiting = g.input(cut, "queue", "Still waiting at the crash");
  cut.worker.turn(cut.commandId, "Start", undefined, "toolUse");
  const user = cut.worker.turn(
    delivered,
    "Delivered before the crash",
    cut.commandId,
    null,
  );
  const next = fixture(g.root);
  expect(() => next.conversations.assertSettled()).not.toThrow();
  for (const commandId of [cut.commandId, delivered, waiting])
    expect(next.state(commandId)).toMatchObject({
      status: "unknown",
      notice: expect.stringContaining("Interrupted"),
    });
  const head = next.head(cut.conversationId);
  expect(head).toMatchObject({
    turns: 2,
    summary: { status: "unknown" },
    undelivered: [
      { commandId: waiting, notice: expect.stringContaining("Interrupted") },
    ],
  });
  // The delivered one is a turn, with its interruption, not a lost message.
  expect(next.steps(cut.conversationId, head.leaf, 1)).toMatchObject({
    turn: { id: user, status: "unknown" },
    steps: [{ role: "user", text: "Delivered before the crash" }],
  });
  expect(head.summary).not.toHaveProperty("live");
});

it("plan approval binds the run of the newest message: a coordinator turn takes messages and stays the approvable head once all of it settled", async () => {
  const f = fixture();
  const control: ConversationControl = {
    instructions: "Coordinate.",
    accept() {},
    onTool: async () => ({}),
    settle: async () => {},
  };
  const id = randomUUID();
  const launch = f.start(id, "Plan it", null, control);
  const [commandId] = f.records.index(id).commands;
  expect(f.records.read(f.records.path(commandId, "state.json"))).toMatchObject(
    { status: "queued" },
  );
  const run = await launch;
  run.worker.ready();
  // An ordinary conversation's message cannot join a coordinator turn.
  expect(await code(() => f.input(run, "steer", "Ordinary"))).toBe("conflict");
  const steer = f.input(run, "steer", "Also consider X", { coordinator: true }),
    queued = f.input(run, "queue", "Never delivered", { coordinator: true });
  // Live: the run is the newest, and it is not settled.
  expect(f.records.latestRun(id)).toEqual({
    commandId: run.commandId,
    settled: false,
  });
  run.worker.turn(run.commandId, "Plan it", undefined, "toolUse");
  const steered = run.worker.turn(steer, "Also consider X", run.commandId);
  run.worker.end();
  await f.settled[0];
  // The index ends with messages sent into the run; the run is still the one
  // approval binds, settled only because every one of them is.
  expect(f.records.index(id).commands).toEqual([run.commandId, steer, queued]);
  expect(f.records.latestRun(id)).toEqual({
    commandId: run.commandId,
    settled: true,
  });
  // The branch must end in the turn of the newest message Pi was given.
  const head = f.records.approvalHead(id, run.commandId);
  expect(head).toBe(f.head(id).leaf);
  expect(f.steps(id, head, 1).turn.id).toBe(steered);
  expect(await code(() => f.records.approvalHead(id, steer))).toBe("stale");
  // A terminal message after it is a newer turn: the grant no longer binds.
  run.worker.terminal("Typed in the terminal");
  expect(await code(() => f.records.approvalHead(id, run.commandId))).toBe(
    "stale",
  );

  // A message a dead owner left unsettled keeps its run from being settled.
  const g = fixture();
  const cut = await g.start(randomUUID(), "Plan it", null, control);
  cut.worker.ready();
  g.input(cut, "queue", "Queued at the crash", { coordinator: true });
  expect(fixture(g.root).records.latestRun(cut.conversationId)).toEqual({
    commandId: cut.commandId,
    settled: false,
  });
});

it("a head read stays one bounded reply with eight long undelivered messages", async () => {
  const f = fixture();
  const run = await f.start();
  run.worker.ready();
  // The longest message there is, every character of it escaped when encoded.
  const text = '"'.repeat(16 * 1024);
  for (let n = 0; n < WAITING_INPUTS; n++) f.input(run, "queue", text);
  const pending: WorkbenchResult = f.head(run.conversationId);
  expect(Buffer.byteLength(JSON.stringify(pending))).toBeLessThan(8 * 1024);
  run.worker.end("failed");
  await f.settled[0];
  const head = f.head(run.conversationId);
  expect(head.undelivered).toHaveLength(WAITING_INPUTS);
  expect(Buffer.byteLength(JSON.stringify(head))).toBeLessThan(300 * 1024);
  // An ordinary message of that length is stated whole.
  const plain = await f.start();
  plain.worker.ready();
  const whole = "a".repeat(16 * 1024);
  f.input(plain, "queue", whole);
  plain.worker.end("failed");
  await f.settled[1];
  expect(f.head(plain.conversationId).undelivered?.[0].text).toBe(whole);
});

it("the reasons recorded for an undelivered message are words the browser can say in its reader's language", () => {
  // The WebUI translates a notice by its exact text; a reworded reason would
  // silently fall back to English there.
  const translations = readFileSync(
    new URL("../web/src/i18n/zh.ts", import.meta.url),
    "utf8",
  );
  for (const notice of [NOT_DELIVERED, UNOBSERVED])
    expect(translations).toContain(`"${notice}":`);
});
