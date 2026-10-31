/** Production registrar, fake Pi + typed owner observations. Real HTTP/PTY in separate lanes. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalEntryLatch } from "../src/history-shell.ts";
import register from "../src/index.ts";

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
function service() {
  const storeId = randomUUID(),
    workspaceId = randomUUID(),
    epoch = randomUUID();
  const ok = (value: any) => ({ kind: "ok", value });
  const client: any = {
    workspace: vi.fn(async () =>
      ok({ storeId, workspaceId, epoch, committedSeq: "1" }),
    ),
    activeRuns: vi.fn(async () =>
      ok({ storeId, workspaceId, epoch, status: "complete", runs: [] }),
    ),
    receipt: vi.fn(async () => ({ status: "absent" })),
    workbenchRead: vi.fn(async () =>
      ok({ kind: "workflow-history", entries: [], next: null }),
    ),
    preflight: vi.fn(),
    create: vi.fn(),
    savePlan: vi.fn(),
    start: vi.fn(),
    check: vi.fn(),
    review: vi.fn(),
    generatePlan: vi.fn(),
    cancel: vi.fn(),
    chooseModel: vi.fn(),
    workbenchCommand: vi.fn(),
  };
  const session = {
    storeId,
    epoch,
    authority: "local",
    capabilities: { actions: false, manualChecks: false, history: true },
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
  return { connection, client, commands: [], epoch };
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
    registerTool() {},
    getActiveTools: () => ["read", "write", "bash"],
    setActiveTools() {},
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };
  const rawHandlers = new Set<(text: string) => unknown>();
  let editor = "/cadence-history";
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
    sessionManager: { getSessionId: () => "one", getBranch: () => [] },
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
      setStatus: vi.fn(),
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
          if (lines[0].startsWith("Cadence history")) {
            component.handleInput("\x1b[F");
            shown.push(component.render(32).join("\n"));
            component.handleInput("\x1b[H");
          }
          onCustom?.(component, lines[0]);
          if (lines[0].startsWith("Cadence history"))
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
    enter(text = "/cadence-history") {
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
      return commands.get("cadence-history")?.handler(args, ctx);
    },
  };
}
it("source registers conversation mode and readonly history, never the retired inspector; startup/ordinary/replayed/quoted/paste/busy/nonterminal/child remain inert", async () => {
  const h = host();
  expect([...h.registrations.keys()]).toEqual(["cadence-history", "cadence"]);
  await h.emit("session_start");
  await h.invoke();
  h.enter("quote /cadence-history");
  await h.invoke();
  h.input("\x1b[200~/cadence-history\r\x1b[201~");
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
  const l = new TerminalEntryLatch("cadence-history");
  l.input("\r", "/cadence-history goal", true, 100);
  expect(l.consume("goal", 1599)).toBe(true);
  expect(l.consume("goal", 1599)).toBe(false);
  l.input("\r", "/cadence-history", true, 100);
  expect(l.consume("", 1600)).toBe(false);
  l.input("\r", "/cadence-history", true);
  l.input("a", "/cadence-history", true);
  expect(l.consume("")).toBe(false);
  l.input("\x1b[200~", "/cadence-history", true);
  l.input("\r", "/cadence-history", true);
  expect(l.consume("")).toBe(false);
  l.input("\x1b[201~", "/cadence-history", true);
  l.input("\r", "/cadence-history x", true);
  expect(l.consume("y")).toBe(false);
});

it("history is available without a model and offers no task, plan, check, review or model mutations", async () => {
  const h = host();
  await h.emit("session_start");
  h.selections.push(
    (_title, options) => {
      expect(options).toEqual([
        "Workflow runs",
        "Retained task history",
        "Enter workflow ID",
        "Command receipt",
        "Service status / guidance",
        "Return",
      ]);
      return "Workflow runs";
    },
    "Return",
    "Service status / guidance",
    "Return",
  );
  h.enter();
  await h.invoke();
  expect(h.registrations.has("cadence-inspect")).toBe(false);
  expect(h.client.workbenchRead).toHaveBeenCalledWith(
    { kind: "workflow-history", after: null },
    expect.any(AbortSignal),
  );
  for (const method of [
    "preflight",
    "create",
    "savePlan",
    "start",
    "check",
    "review",
    "generatePlan",
    "cancel",
    "chooseModel",
    "workbenchCommand",
  ])
    expect(h.client[method]).not.toHaveBeenCalled();
  expect(h.ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
  expect(h.connection.detach).toHaveBeenCalled();
  expect(existsSync(join(h.cwd, ".cadence"))).toBe(false);
});
it("full workflow results are readable without model calls, including narrow Unicode pages and the retained tail", async () => {
  const h = host();
  await h.emit("session_start");
  const id = randomUUID();
  const run = {
    id,
    epoch: h.epoch,
    goal: "Goal",
    status: "failed",
    phase: "finished",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [
      {
        id: "check",
        kind: "check",
        status: "failed",
        text: "preview",
        truncated: true,
        exitCode: 1,
      },
    ],
  };
  h.client.workbenchRead.mockImplementation(async (request: any) => ({
    kind: "ok",
    value:
      request.kind === "workflow"
        ? { kind: "workflow", commandId: null, response: { type: "run", run } }
        : {
            kind: "file",
            path: `workflow/${id}/check`,
            text: `${"漢字 🧪\n".repeat(40000)}END-RETAINED`,
            limited: false,
          },
  }));
  h.selections.push((_t, choices) => choices[0], "Full result", "Return");
  let tail = false;
  h.custom((component, label) => {
    if (!label.startsWith("Cadence history")) return;
    component.render(18);
    component.handleInput("\x1b[F");
    const lines = component.render(18);
    for (const line of lines)
      expect(visibleWidth(line)).toBeLessThanOrEqual(18);
    if (lines.slice(1).join("").includes("END-RETAINED")) tail = true;
  });
  h.enter(`/cadence-history ${id}`);
  await h.invoke(id);
  expect(tail).toBe(true);
  expect(h.client.workbenchCommand).not.toHaveBeenCalled();
});
it("departure invalidates late reads and detaches without canceling or replaying work", async () => {
  const h = host();
  await h.emit("session_start");
  h.client.workbenchRead.mockImplementation(async () => {
    await h.emit("session_before_tree");
    return {
      kind: "ok",
      value: { kind: "workflow-history", entries: [], next: null },
    };
  });
  h.selections.push("Workflow runs");
  h.enter();
  await h.invoke();
  expect(h.notices.join(" ")).toContain("stale");
  expect(h.client.cancel).not.toHaveBeenCalled();
  expect(h.client.workbenchCommand).not.toHaveBeenCalled();
  await h.emit("session_shutdown");
});
it("modal input/tools/bash stay guarded, then ordinary host tools are restored", async () => {
  const h = host();
  await h.emit("session_start");
  let guarded: Promise<unknown> | undefined;
  h.selections.push(() => {
    guarded = (async () => {
      const input = h.emit("input"),
        tool = h.emit("tool_call"),
        bash = h.emit("user_bash");
      expect(await input).toContainEqual({ action: "handled" });
      expect((await tool)[0]).toMatchObject({ block: true });
      expect((await bash)[0]).toMatchObject({ result: { exitCode: 1 } });
    })();
    return "Return";
  });
  h.enter();
  await h.invoke();
  await guarded;
  expect((await h.emit("tool_call")).every((r) => r === undefined)).toBe(true);
});

it("workflow listing distinguishes scan progress and continues only the same ID boundary", async () => {
  const h = host();
  await h.emit("session_start");
  const scan = randomUUID();
  h.client.workbenchRead.mockImplementationOnce(async () => ({
    kind: "ok",
    value: { kind: "workflow-history-progress", after: null, scan },
  }));
  h.selections.push("Workflow runs", "Continue scanning", "Return", "Return");
  h.enter();
  await h.invoke();
  expect(h.client.workbenchRead).toHaveBeenNthCalledWith(
    2,
    { kind: "workflow-history", after: null, scan },
    expect.any(AbortSignal),
  );
  expect(h.client.workbenchCommand).not.toHaveBeenCalled();
  expect(h.client.chooseModel).not.toHaveBeenCalled();
});
