/** Production registrar, fake Pi + typed owner observations. Real HTTP/PTY in separate lanes. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import register from "../src/index.ts";
import type {
  Action,
  Command,
  ContextVersion,
  CurrentView,
  Receipt,
} from "../src/service-contract.ts";
import { TerminalEntryLatch } from "../src/task-shell.ts";

const injected = vi.hoisted(() => ({ connection: null as any }));
vi.mock("../src/native-client.ts", async (original) => ({
  ...(await original<typeof import("../src/native-client.ts")>()),
  NativeConnection: class {
    private delegate = injected.connection;
    get client() {
      return this.delegate.client;
    }
    get session() {
      return this.delegate.session;
    }
    attach(cwd: string) {
      return this.delegate.attach(cwd);
    }
    detach() {
      return this.delegate.detach();
    }
    refresh() {
      return this.delegate.refresh();
    }
    compatible(safety?: boolean) {
      return this.delegate.compatible(safety);
    }
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const complete = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
} as const;
function service() {
  const storeId = randomUUID(),
    workspaceId = randomUUID(),
    epoch = randomUUID();
  const context: ContextVersion = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    controlRev: 1,
    workspaceId,
    cwdId: randomUUID(),
    model: {
      sourceSelectionId: randomUUID(),
      provider: "owner",
      model: "exact",
      api: "openai-completions",
      thinking: "off",
    },
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: "1".repeat(64), complete: true },
    task: null,
  };
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ].map((role, i) => ({ role, sha256: String(i + 1).repeat(64) }));
  let plan = "",
    graph: any = null,
    available = true;
  const commands: Command[] = [],
    runs: any[] = [];
  const receipts = new Map<string, Receipt>();
  const ok = (value: any) => ({ kind: "ok", value });
  const current = (): CurrentView => ({
    request: { storeId, taskId: context.task?.id ?? null },
    workspaceId,
    epoch,
    committedSeq: "1",
    context: available
      ? { status: "available", version: structuredClone(context) }
      : {
          status: "unavailable",
          workspaceId,
          taskId: context.task?.id ?? null,
          error: { code: "unavailable", effect: "none", recovery: "observe" },
        },
    task: context.task && {
      id: context.task.id,
      kind: context.task.kind,
      revision: context.task.revision,
      identity: context.task.identity,
    },
    roles: roles as CurrentView["roles"],
    readablePlan: context.task
      ? {
          source: "current-v1",
          text: plan,
          editable: true,
          coverage: { ...complete, omissions: [] },
        }
      : null,
    savedGraph: graph
      ? {
          status: "saved",
          request: {
            storeId,
            scope: { kind: "task", id: context.task!.id },
            snapshotSeq: "1",
            graph: {
              recordId: graph.plan.recordId,
              revision: graph.revision,
              sha256: "8".repeat(64),
            },
          },
          planRevision: graph.planRevision,
        }
      : { status: "none" },
  });
  const execute = vi.fn(async (command: Command) => {
    commands.push(structuredClone(command));
    const a = command.action;
    const receipt: Receipt = {
      commandId: command.commandId,
      operationId: randomUUID(),
      runId: null,
      admission: "accepted",
      committedSeq: "1",
      execution: null,
      settlement: null,
      created: null,
      publication: "published",
    };
    if (a.kind === "create") {
      context.task = {
        id: randomUUID(),
        kind: a.taskKind,
        revision: 1,
        identity: "2".repeat(64),
        graphRevision: null,
        graphIdentity: null,
      };
      receipt.created = {
        kind: "task",
        taskId: context.task.id,
        state: "published",
      };
    } else if (a.kind === "save-plan") {
      plan = a.plan;
      graph = a.graph;
      Object.assign(context.task!, {
        revision: context.task!.revision + 1,
        identity: "3".repeat(64),
        graphRevision: graph.revision,
        graphIdentity: "8".repeat(64),
      });
    } else if (
      a.kind === "start" ||
      a.kind === "generate-plan" ||
      a.kind === "check"
    ) {
      receipt.runId = randomUUID();
      runs.push({
        taskId: context.task!.id,
        runId: receipt.runId,
        operationId: receipt.operationId,
        epoch,
        kind: a.kind,
        stage: "active",
      });
    }
    context.controlRev++;
    receipts.set(receipt.commandId, receipt);
    return ok(receipt);
  });
  const client: any = {
    workspace: vi.fn(async () =>
      ok({
        storeId,
        workspaceId,
        epoch,
        committedSeq: "1",
        rootLabel: "/isolated",
        models: [context.model],
        context: current().context,
      }),
    ),
    current: vi.fn(async () => ok(current())),
    currentChanges: vi.fn(async () =>
      ok({
        request: current().request,
        workspaceId,
        epoch,
        committedSeq: "1",
        context: current().context,
        task: current().task,
        observation: { ...context.observation, checkoutGeneration: 0 },
        text: "Pre-existing dirt 中文 🧪",
        git: false,
        coverage: complete,
      }),
    ),
    preflight: vi.fn(async (expected: ContextVersion, action: Action) =>
      ok({
        grant: randomUUID(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        preview: {
          version: structuredClone(expected),
          action,
          rootLabel: "/isolated",
          cwdLabel: "/isolated",
          readablePlan: action.kind === "save-plan" ? action.plan : plan,
          graph: action.kind === "save-plan" ? action.graph : graph,
          activeRunId: null,
          issues: [],
          configuredChecks: [],
          checksRevision: 0,
          reviewRunId: null,
          ...(action.kind === "check"
            ? { checkEnvironmentPolicy: "service-launch-ordinary/1" }
            : {}),
        },
      }),
    ),
    create: execute,
    savePlan: execute,
    generatePlan: execute,
    start: execute,
    check: execute,
    review: execute,
    graph: vi.fn(async (request: any) => ok({ request, graph })),
    receipt: vi.fn(async (id: string) =>
      receipts.has(id)
        ? { status: "found", receipt: receipts.get(id) }
        : { status: "absent" },
    ),
    activeRuns: vi.fn(async () =>
      ok({
        storeId,
        workspaceId,
        epoch,
        status: "complete",
        runs: structuredClone(runs),
      }),
    ),
    cancel: vi.fn(async (command: any) => {
      runs.length = 0;
      return ok({
        commandId: command.commandId,
        operationId: randomUUID(),
        runId: command.runId,
        admission: "accepted",
        committedSeq: "1",
        execution: "unknown",
        settlement: null,
        created: null,
        publication: "uncertain",
      });
    }),
    checkObligations: vi.fn(async (taskId: string) =>
      ok({ taskId, revision: 0, definitions: [] }),
    ),
  };
  const session = {
    storeId,
    epoch,
    capabilities: { actions: true, manualChecks: true, history: true },
    authority: "local",
  };
  const connection = {
    client,
    session,
    attach: vi.fn(async () => client),
    detach: vi.fn(async () => {}),
    refresh: vi.fn(async () => session),
    compatible: vi.fn(() => true),
  };
  injected.connection = connection;
  return {
    connection,
    client,
    commands,
    runs,
    context,
    current,
    unavailable: () => {
      available = false;
    },
    changePlan: () => {
      plan += " ";
      context.task!.identity = "9".repeat(64);
    },
  };
}
function host() {
  // Every NativeConnection here is the one fake; the panel's readonly owner
  // feed is covered by agent-panel-cadence.test.ts, not this shell.
  vi.stubEnv("CADENCE_AGENT_PANEL", "off");
  const s = service(),
    cwd = mkdtempSync(join(tmpdir(), "cadence-native-host-"));
  const handlers = new Map<string, ((...args: any[]) => any)[]>(),
    commands = new Map<string, any>();
  const pi = {
    events: { on: () => () => {}, emit() {} },
    on(event: string, fn: any) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };
  const rawHandlers = new Set<(text: string) => unknown>();
  let editor = "/cadence";
  const selections: (
      | string
      | undefined
      | ((title: string, options: string[]) => string | undefined)
    )[] = [],
    edits: (string | undefined)[] = [],
    notices: string[] = [],
    shown: string[] = [];
  let confirm: ((title: string) => Promise<boolean>) | undefined;
  let onCustom: ((component: any, label: string) => void) | undefined;
  const ctx: any = {
    cwd,
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    isProjectTrusted: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "one" },
    model: { provider: "pi-independent", id: "chat" },
    thinkingLevel: "off",
    modelRegistry: { getApiKeyAndHeaders: vi.fn() },
    ui: {
      onTerminalInput(fn: any) {
        rawHandlers.add(fn);
        return () => rawHandlers.delete(fn);
      },
      getEditorText: () => editor,
      setWidget: vi.fn(),
      select: vi.fn(async (title: string, options: string[]) => {
        const item = selections.shift();
        const result = typeof item === "function" ? item(title, options) : item;
        if (result !== undefined) expect(options).toContain(result);
        return result;
      }),
      editor: vi.fn(async () => edits.shift()),
      input: vi.fn(async () => "printf 'native'"),
      confirm: vi.fn(async (title: string, message: string) => {
        shown.push(message);
        return confirm ? confirm(title) : true;
      }),
      notify: (text: string) => notices.push(text),
      custom: async (factory: any) =>
        new Promise((resolve) => {
          let component: any;
          const done = (result: any) => {
            component?.dispose?.();
            resolve(result);
          };
          component = factory(
            { terminal: { rows: 12 }, requestRender() {} },
            {},
            {},
            done,
          );
          const lines = component.render(32);
          for (const line of lines)
            expect(visibleWidth(line)).toBeLessThanOrEqual(32);
          shown.push(lines.join("\n"));
          if (lines[0].startsWith("Cadence review")) {
            component.handleInput("\x1b[F");
            shown.push(component.render(32).join("\n"));
            component.handleInput("\x1b[H");
          }
          onCustom?.(component, lines[0]);
          if (lines[0].startsWith("Cadence review"))
            component.handleInput("\x1b");
        }),
    },
  };
  register(pi as any);
  const emit = async (event: string) => {
    const results = [];
    for (const fn of handlers.get(event) ?? []) results.push(await fn({}, ctx));
    return results;
  };
  return {
    ...s,
    cwd,
    ctx,
    commands: s.commands,
    registrations: commands,
    handlers,
    selections,
    edits,
    notices,
    shown,
    emit,
    enter(text = "/cadence") {
      editor = text;
      for (const fn of rawHandlers) fn("\r");
    },
    input(text: string) {
      for (const fn of rawHandlers) fn(text);
    },
    confirm(fn: typeof confirm) {
      confirm = fn;
    },
    custom(fn: typeof onCustom) {
      onCustom = fn;
    },
    invoke(args = "") {
      return commands.get("cadence")?.handler(args, ctx);
    },
  };
}
async function setup(kind = "code") {
  const h = host();
  await h.emit("session_start");
  h.selections.push("New", kind);
  h.edits.push("Goal 中文 🧪");
  return h;
}
const planAndStart = (h: ReturnType<typeof host>) => {
  h.selections.push(
    "Plan / assignments",
    "Save plan",
    "Start / Continue",
    "Return",
    "Return",
  );
  h.edits.push("Inspect and edit one file.");
};

it("source registers only cadence; startup/ordinary/replayed/quoted/paste/busy/nonterminal/child remain inert", async () => {
  const h = host();
  expect([...h.registrations.keys()]).toEqual(["cadence"]);
  await h.emit("session_start");
  await h.invoke();
  h.enter("quote /cadence");
  await h.invoke();
  h.input("\x1b[200~/cadence\r\x1b[201~");
  await h.invoke();
  for (const mode of ["rpc", "json", "print"]) {
    h.ctx.mode = mode;
    h.enter();
    await h.invoke();
  }
  h.ctx.mode = "tui";
  for (const key of ["isIdle", "isProjectTrusted", "hasPendingMessages"]) {
    const old = h.ctx[key];
    h.ctx[key] = () => key === "hasPendingMessages";
    h.enter();
    await h.invoke();
    h.ctx[key] = old;
  }
  h.ctx.hasUI = false;
  h.enter();
  await h.invoke();
  expect(h.connection.attach).not.toHaveBeenCalled();
  expect(existsSync(join(h.cwd, ".cadence"))).toBe(false);
  vi.stubEnv("CADENCE_SUBAGENT_CHILD", "1");
  const child = host();
  expect(child.registrations.size).toBe(0);
  expect(child.handlers.size).toBe(0);
});
it("raw latch is under 1500ms, consumed once, exact argument bound and cleared by other input/paste", () => {
  const l = new TerminalEntryLatch();
  l.input("\r", "/cadence goal", true, 100);
  expect(l.consume("goal", 1599)).toBe(true);
  expect(l.consume("goal", 1599)).toBe(false);
  l.input("\r", "/cadence", true, 100);
  expect(l.consume("", 1600)).toBe(false);
  l.input("\r", "/cadence", true);
  l.input("a", "/cadence", true);
  expect(l.consume("")).toBe(false);
  l.input("\x1b[200~", "/cadence", true);
  l.input("\r", "/cadence", true);
  expect(l.consume("")).toBe(false);
  l.input("\x1b[201~", "/cadence", true);
  l.input("\r", "/cadence x", true);
  expect(l.consume("y")).toBe(false);
});
it("new/prefill is inert until readable plan and fresh Start; uses exact OWNER choice, never parent authentication", async () => {
  const h = await setup();
  planAndStart(h);
  h.enter("/cadence prefill");
  await h.invoke("prefill");
  expect(h.ctx.ui.editor.mock.calls[0][1]).toBe("prefill");
  expect(h.commands.map((c) => c.action.kind)).toEqual([
    "create",
    "save-plan",
    "start",
  ]);
  expect(h.commands.at(-1)?.expected.model).toEqual(h.context.model);
  expect(h.ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
  expect(h.runs).toHaveLength(1);
  expect(h.connection.detach).toHaveBeenCalled();
  await h.invoke();
  expect(h.commands).toHaveLength(3);
});
it("empty code plan refuses Start, and unavailable exact owner context never falls back to Pi auth", async () => {
  const h = await setup();
  h.selections.push("Start / Continue", "Return", "Return");
  h.enter();
  await h.invoke();
  expect(h.commands.map((c) => c.action.kind)).toEqual(["create"]);
  expect(h.notices.join(" ")).toContain("plan first");
  const other = await setup();
  other.unavailable();
  other.enter();
  await other.invoke();
  expect(other.commands).toHaveLength(0);
  expect(other.ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
});
for (const change of [
  "navigation",
  "model",
  "cwd",
  "session",
  "busy",
  "queue",
]) {
  it(`stale native ${change} confirmation refuses Start without canceling accepted work`, async () => {
    const h = await setup();
    planAndStart(h);
    h.confirm(async (title) => {
      if (title === "Confirm start now?") {
        if (change === "navigation") await h.emit("session_before_switch");
        if (change === "model") h.ctx.model = { id: "changed" };
        if (change === "cwd") h.ctx.cwd += "/changed";
        if (change === "session")
          h.ctx.sessionManager.getSessionId = () => "two";
        if (change === "busy") h.ctx.isIdle = () => false;
        if (change === "queue") h.ctx.hasPendingMessages = () => true;
      }
      return true;
    });
    h.enter();
    await h.invoke();
    expect(h.commands.some((c) => c.action.kind === "start")).toBe(false);
    expect(h.client.cancel).not.toHaveBeenCalled();
    expect(h.notices.join(" ")).toContain("stale");
  });
}
it("Escape/No before native Start confirmation cannot admit a late worker", async () => {
  const h = await setup();
  planAndStart(h);
  h.confirm(async (title) => title !== "Confirm start now?");
  h.enter();
  await h.invoke();
  expect(h.commands.some((c) => c.action.kind === "start")).toBe(false);
  expect(h.client.cancel).not.toHaveBeenCalled();
});
it("dialog input/tools/bash are guarded; navigation/shutdown detach accepted run and do NOT wait/cancel it", async () => {
  const h = await setup();
  planAndStart(h);
  // Inspect synchronously from the post-Start task menu; the async hook is joined below.
  let guarded: Promise<any> | undefined;
  h.selections.splice(5, 1, (_title, options) => {
    guarded = (async () => {
      expect(await h.emit("input")).toContainEqual({ action: "handled" });
      expect((await h.emit("tool_call"))[0].block).toBe(true);
      expect((await h.emit("user_bash"))[0].result.exitCode).toBe(1);
      expect(await h.emit("session_before_tree")).toEqual([undefined]);
    })();
    return options.includes("Return") ? "Return" : undefined;
  });
  h.enter();
  await h.invoke();
  await guarded;
  await h.emit("session_shutdown");
  expect(h.runs).toHaveLength(1);
  expect(h.client.cancel).not.toHaveBeenCalled();
  expect(await h.emit("tool_call")).toEqual([undefined]);
});
for (const kind of ["research", "diagnosis"]) {
  it(`${kind} goal-only Start retains readonly kind and offers no shell checks`, async () => {
    const h = await setup(kind);
    h.selections.push(
      (title, options) => {
        expect(options).not.toContain("Checks");
        expect(title).toContain(kind);
        return "Start / Continue";
      },
      "Return",
      "Return",
    );
    h.enter();
    await h.invoke();
    expect(h.commands.map((c) => c.action.kind)).toEqual(["create", "start"]);
    expect(h.commands[1].expected.task?.kind).toBe(kind);
  });
}
it("Generate is advisory only: never implicitly saves its output or Starts editing", async () => {
  const h = await setup();
  h.selections.push("Generate plan (readonly)", "Return", "Return");
  h.enter();
  await h.invoke();
  expect(h.commands.map((c) => c.action.kind)).toEqual([
    "create",
    "generate-plan",
  ]);
  expect(h.current().readablePlan?.text).toBe("");
});
it("late preflight after departure cannot consume a grant or launch", async () => {
  const h = await setup();
  planAndStart(h);
  const original = h.client.preflight.getMockImplementation();
  h.client.preflight.mockImplementation(async (expected: any, action: any) => {
    const result = await original(expected, action);
    if (action.kind === "start") await h.emit("model_select");
    return result;
  });
  h.enter();
  await h.invoke();
  expect(h.commands.some((c) => c.action.kind === "start")).toBe(false);
  expect(h.client.cancel).not.toHaveBeenCalled();
});
it("same-revision exact plan-byte change invalidates the displayed Start before command submission", async () => {
  const h = await setup();
  planAndStart(h);
  h.confirm(async (title) => {
    if (title === "Confirm start now?") h.changePlan();
    return true;
  });
  h.enter();
  await h.invoke();
  expect(h.commands.some((c) => c.action.kind === "start")).toBe(false);
  expect(h.notices.join(" ")).toContain("stale");
});
it("only explicit Cancel targets actual active IDs across tasks; unknown receipt is not successful stop", async () => {
  const h = await setup();
  planAndStart(h);
  h.selections.splice(
    6,
    0,
    "Active runs / Cancel",
    (_title, options) => options[0],
  );
  h.enter();
  await h.invoke();
  expect(h.client.cancel).toHaveBeenCalledTimes(1);
  expect(h.client.cancel.mock.calls[0][0]).toMatchObject({
    epoch: h.context.epoch,
    runId: h.commands.length ? expect.any(String) : "",
  });
  expect(h.shown.join(" ")).toContain("unknown");
});
it("lost command reply observes the same command receipt with no retry or renewed grant", async () => {
  const h = await setup("research");
  const original = h.client.start.getMockImplementation();
  h.client.start = vi.fn(async (c: Command) => {
    await original(c);
    return {
      kind: "error",
      error: { code: "unavailable", effect: "uncertain", recovery: "observe" },
    };
  });
  h.selections.push("Start / Continue", "Return", "Return");
  h.enter();
  await h.invoke();
  expect(h.client.start).toHaveBeenCalledTimes(1);
  expect(h.client.receipt).toHaveBeenCalledWith(
    h.commands[1].commandId,
    expect.any(AbortSignal),
  );
  expect(h.commands.map((c) => c.action.kind)).toEqual(["create", "start"]);
});
it("native manual check displays actual command/cwd/timeout/launch environment and uses service action", async () => {
  const h = await setup();
  h.selections.push("Checks", "Manual command", "Return", "Return");
  h.enter();
  await h.invoke();
  expect(h.commands[1].action).toMatchObject({
    kind: "check",
    check: { kind: "manual", command: "printf 'native'", timeoutMs: 120000 },
  });
  expect(h.shown.join(" ")).toContain("service-launch-ordinary/1");
});
for (const name of ["Return", "Next options page", "token=one", "token=two"]) {
  it(`configured check ${name} remains selectable separately from navigation and sanitized labels`, async () => {
    const h = await setup();
    const names = ["Return", "Next options page", "token=one", "token=two"];
    h.client.checkObligations.mockImplementation(async (taskId: string) => ({
      kind: "ok",
      value: {
        taskId,
        revision: 0,
        definitions: names.map((name, i) => ({
          selection: {
            kind: "configured",
            name,
            command: `printf 'check-${i}'`,
            timeoutMs: 1000,
          },
        })),
      },
    }));
    h.selections.push(
      "Checks",
      (_title, choices) => choices[names.indexOf(name)],
      "Return",
      "Return",
    );
    h.enter();
    await h.invoke();
    expect(h.commands[1]?.action).toMatchObject({
      kind: "check",
      check: { name },
    });
  });
}
it("pager retains Unicode-width, resize, End/Home and trailing full page rather than a 256KiB preview", async () => {
  const h = await setup();
  h.selections.push("Changes / obligations", "Return", "Return");
  const original = h.client.currentChanges.getMockImplementation();
  h.client.currentChanges.mockImplementation(async () => {
    const r = await original();
    r.value.text = `${"漢字 🧪\n".repeat(40000)}END-RETAINED`;
    return r;
  });
  let saw = false;
  h.custom((component, label) => {
    if (label.startsWith("Cadence review")) {
      component.handleInput("\x1b[F");
      component.render(18); // Actual resize recomputes the wrapped row count.
      component.handleInput("\x1b[F");
      const lines = component.render(18);
      for (const line of lines)
        expect(visibleWidth(line)).toBeLessThanOrEqual(18);
      // The sentinel precedes the small coverage/check footer. Walk upward by
      // rows, not pages, so its exact trailing bytes must actually be reachable.
      let trailing = lines.slice(1).join("");
      for (let i = 0; i < 24 && !trailing.includes("END-RETAINED"); i++) {
        component.handleInput("\x1b[A");
        trailing += component.render(18).slice(1).join("");
      }
      if (trailing.includes("END-RETAINED")) saw = true;
      component.handleInput("\x1b[H");
    }
  });
  h.enter();
  await h.invoke();
  expect(saw).toBe(true);
});

it("unsupported owner transports and incompatible builds never substitute the Pi model/provider", async () => {
  const h = host();
  await h.emit("session_start");
  h.client.models = vi.fn(async () => ({
    kind: "ok",
    value: {
      status: "complete",
      selected: null,
      version: {},
      entries: [
        {
          provider: "function-provider",
          model: "opaque",
          api: null,
          eligibility: "unsupported",
          thinking: [],
        },
      ],
    },
  }));
  h.client.chooseModel = vi.fn();
  h.selections.push("Model / thinking", (_title, choices) => choices[0]);
  h.enter();
  await h.invoke();
  expect(h.client.chooseModel).not.toHaveBeenCalled();
  expect(h.commands).toEqual([]);
  expect(h.ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
  const other = await setup();
  other.connection.compatible.mockReturnValue(false);
  other.enter();
  await other.invoke();
  expect(other.commands).toEqual([]);
  expect(other.notices.join(" ")).toContain("no embedded executor");
});
it("sanitized owner-model labels keep the exact explicitly selected entry, not the first collision", async () => {
  const h = host();
  await h.emit("session_start");
  h.client.models = vi.fn(async () => ({
    kind: "ok",
    value: {
      status: "complete",
      selected: null,
      version: {},
      entries: ["token=one", "token=two"].map((provider) => ({
        provider,
        model: "fixed",
        api: "openai-completions",
        eligibility: "candidate",
        thinking: [{ level: "off", selectable: true }],
      })),
    },
  }));
  h.client.chooseModel = vi.fn(async () => ({ kind: "ok", value: null }));
  h.selections.push(
    "Model / thinking",
    (_title, choices) => choices[1],
    "off",
    "Return",
  );
  h.enter();
  await h.invoke();
  expect(h.client.chooseModel).toHaveBeenCalledWith(
    expect.objectContaining({
      choice: expect.objectContaining({ provider: "token=two" }),
    }),
  );
  expect(h.commands).toEqual([]);
});
for (const rebind of [false, true]) {
  it(`saved assignment model IDs require explicit rebind and Save (rebind ${rebind})`, async () => {
    const h = await setup();
    h.selections.push("Plan / assignments", "Save plan", "Return", "Return");
    h.edits.push("Reviewed plan.");
    h.enter();
    await h.invoke();
    const first = h.commands[1].action;
    expect(first.kind).toBe("save-plan");
    h.context.model = {
      ...h.context.model,
      sourceSelectionId: randomUUID(),
      model: "new-exact",
    };
    h.selections.push("Current task", "Plan / assignments");
    if (rebind) h.selections.push("Apply current exact model to assignments");
    h.selections.push("Save plan", "Return", "Return");
    h.edits.push("Reviewed plan.");
    h.enter();
    await h.invoke();
    const saves = h.commands.filter((c) => c.action.kind === "save-plan");
    expect(saves).toHaveLength(rebind ? 2 : 1);
    if (rebind && saves[1].action.kind === "save-plan")
      expect(saves[1].action.graph.assignments[0].model).toEqual(
        h.context.model,
      );
    expect(h.commands.some((c) => c.action.kind === "start")).toBe(false);
  });
}
it("a missing current task never hides independent active-run Cancel behind its historical page", async () => {
  const h = await setup("research");
  h.selections.push(
    "Start / Continue",
    (_title, options) => {
      h.client.current.mockRejectedValueOnce(
        new Error("selected task unavailable"),
      );
      return options.includes("Changes / obligations")
        ? "Changes / obligations"
        : undefined;
    },
    "Active runs / Cancel",
    (_title, options) => options[0],
    "Return",
    "Return",
  );
  h.enter();
  await h.invoke();
  expect(h.client.cancel).toHaveBeenCalledTimes(1);
  expect(h.commands.filter((c) => c.action.kind === "start")).toHaveLength(1);
});
