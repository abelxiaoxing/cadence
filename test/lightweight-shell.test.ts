import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import register from "../src/index.ts";
import { TerminalEntryLatch } from "../src/task-shell.ts";

const worker = vi.hoisted(() => vi.fn());
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  runWorker: worker,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  worker.mockReset();
});

function host() {
  const cwd = mkdtempSync(join(tmpdir(), "cadence-lw-host-"));
  vi.stubEnv(
    "XDG_STATE_HOME",
    mkdtempSync(join(tmpdir(), "cadence-lw-host-private-")),
  );
  const handlers = new Map<string, ((...args: any[]) => any)[]>();
  const commands = new Map<string, any>();
  const pi = {
    on(event: string, handler: any) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };
  const raw = vi.fn();
  let rawHandler: ((data: string) => void) | undefined;
  let editor = "/cadence";
  const selections: (string | undefined)[] = [];
  const edits: (string | undefined)[] = [];
  const notices: string[] = [];
  let onConfirm: (() => Promise<boolean>) | undefined;
  let onCustom: ((component: any, label: string) => void) | undefined;
  const ctx: any = {
    cwd,
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    isProjectTrusted: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "session-one" },
    thinkingLevel: "off",
    model: {
      id: "fixture",
      provider: "fixture",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 128,
    },
    modelRegistry: {
      getRegisteredProviderConfig: () => undefined,
      getRegisteredNativeProvider: () => undefined,
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: "fabricated-host-key",
      }),
    },
    ui: {
      onTerminalInput(handler: any) {
        rawHandler = handler;
        raw(handler);
        return () => {
          rawHandler = undefined;
        };
      },
      getEditorText: () => editor,
      select: vi.fn(async () => selections.shift()),
      editor: vi.fn(async () => edits.shift()),
      input: vi.fn(async () => "echo test"),
      confirm: vi.fn(async () => (onConfirm ? onConfirm() : true)),
      notify: (text: string) => notices.push(text),
      custom: async (factory: any) =>
        new Promise<void>((resolve, reject) => {
          let component: any;
          const done = () => {
            component?.dispose?.();
            resolve();
          };
          try {
            component = factory(
              { terminal: { rows: 12 }, requestRender() {} },
              {},
              {},
              done,
            );
            const lines = component.render(32);
            for (const line of lines)
              expect(visibleWidth(line)).toBeLessThanOrEqual(32);
            const label = lines[0];
            onCustom?.(component, label);
            if (label.startsWith("Cadence review"))
              component.handleInput("\x1b");
          } catch (error) {
            reject(error);
          }
        }),
    },
  };
  register(pi as any);
  const emit = async (event: string) => {
    const values = [];
    for (const handler of handlers.get(event) ?? [])
      values.push(await handler({}, ctx));
    return values;
  };
  return {
    cwd,
    commands,
    handlers,
    ctx,
    selections,
    edits,
    notices,
    emit,
    enter(text = "/cadence") {
      editor = text;
      rawHandler?.("\r");
    },
    input(data: string) {
      rawHandler?.(data);
    },
    confirm(fn: () => Promise<boolean>) {
      onConfirm = fn;
    },
    custom(fn: (component: any, label: string) => void) {
      onCustom = fn;
    },
    invoke(args = "") {
      return commands.get("cadence")?.handler(args, ctx);
    },
  };
}
it("source entry registers only cadence; startup/ordinary/replayed/quoted/paste/busy/nonterminal/child remain inert", async () => {
  const h = host();
  expect([...h.commands.keys()]).toEqual(["cadence"]);
  await h.emit("session_start");
  await h.invoke();
  expect(h.ctx.ui.select).not.toHaveBeenCalled();
  h.enter("quote /cadence");
  await h.invoke();
  h.input("\x1b[200~/cadence\r\x1b[201~");
  await h.invoke();
  h.ctx.mode = "rpc";
  h.enter();
  await h.invoke();
  h.ctx.mode = "json";
  h.enter();
  await h.invoke();
  h.ctx.mode = "tui";
  h.ctx.isIdle = () => false;
  h.enter();
  await h.invoke();
  h.ctx.isIdle = () => true;
  h.ctx.isProjectTrusted = () => false;
  h.enter();
  await h.invoke();
  h.ctx.isProjectTrusted = () => true;
  expect(h.ctx.ui.select).not.toHaveBeenCalled();
  expect(existsSync(join(h.cwd, ".cadence"))).toBe(false);
  vi.stubEnv("CADENCE_SUBAGENT_CHILD", "1");
  const child = host();
  expect(child.commands.size).toBe(0);
  expect(child.handlers.size).toBe(0);
});
it("raw latch is short, consumed once, and canceled by other input", () => {
  const latch = new TerminalEntryLatch();
  latch.input("\r", "/cadence goal", true, 100);
  expect(latch.consume("goal", 110)).toBe(true);
  expect(latch.consume("goal", 110)).toBe(false);
  latch.input("\r", "/cadence", true, 100);
  expect(latch.consume("", 2000)).toBe(false);
  latch.input("\r", "/cadence", true);
  latch.input("a", "/cadence", true);
  expect(latch.consume("")).toBe(false);
  latch.input("\x1b[200~", "/cadence", true);
  latch.input("\r", "/cadence", true);
  expect(latch.consume("")).toBe(false);
});
it("new/prefill remains inert until readable plan and a fresh Start; forwards exact current auth", async () => {
  const h = host();
  await h.emit("session_start");
  h.selections.push("New", "code", "Plan", "Start / Continue", "Return");
  h.edits.push("Goal 漢字", "Read then edit one file");
  worker.mockResolvedValue({
    outcome: "completed",
    closed: true,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    text: "Summary",
    output: "",
    truncated: false,
  });
  h.enter("/cadence prefill");
  await h.invoke("prefill");
  expect(h.ctx.ui.editor.mock.calls[0][1]).toBe("prefill");
  expect(h.ctx.ui.confirm).toHaveBeenCalledTimes(1);
  expect(worker).toHaveBeenCalledTimes(1);
  const request = worker.mock.calls[0][0];
  expect(request.auth.apiKey).toBe("fabricated-host-key");
  expect(request.model).toEqual(h.ctx.model);
  expect(request.kind).toBe("code");
  expect(request.prompt).toContain("Read then edit");
  const tasks = join(h.cwd, ".cadence", "assistant", "tasks");
  const body = readFileSync(
    join(tasks, readdirSync(tasks)[0], "task.json"),
    "utf8",
  );
  expect(body).not.toContain("fabricated-host-key");
  expect(JSON.parse(body).phase).toBe("review");
  await h.invoke("prefill");
  expect(worker).toHaveBeenCalledTimes(1);
});
it("stale Start confirmation and custom provider transports refuse without a worker", async () => {
  for (const customProvider of [false, true]) {
    const h = host();
    await h.emit("session_start");
    h.selections.push("New", "code", "Plan", "Start / Continue", "Return");
    h.edits.push("Goal", "Plan");
    if (customProvider)
      h.ctx.modelRegistry.getRegisteredNativeProvider = () => ({});
    else
      h.confirm(async () => {
        await h.emit("session_before_switch");
        return true;
      });
    h.enter();
    await h.invoke();
    expect(worker).not.toHaveBeenCalled();
    expect(
      h.notices.some((notice) => /Context changed|transports/.test(notice)),
    ).toBe(true);
  }
});
it("Escape before progress microtask prevents launch rather than allowing a late restart", async () => {
  const h = host();
  await h.emit("session_start");
  h.selections.push("New", "code", "Plan", "Start / Continue", "Return");
  h.edits.push("Goal", "Plan");
  h.custom((component, label) => {
    if (label.startsWith("Cadence foreground")) component.handleInput("\x1b");
  });
  h.enter();
  await h.invoke();
  expect(worker).not.toHaveBeenCalled();
});
it("during a foreground worker parent input/tools/bash are blocked; waited navigation aborts it", async () => {
  const h = host();
  await h.emit("session_start");
  h.selections.push("New", "code", "Plan", "Start / Continue", "Return");
  h.edits.push("Goal", "Plan");
  let launched: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    launched = resolve;
  });
  worker.mockImplementation(
    (_request, signal: AbortSignal) =>
      new Promise((resolve) => {
        launched();
        signal.addEventListener(
          "abort",
          () =>
            resolve({
              outcome: "canceled",
              closed: true,
              exitCode: null,
              signal: "SIGTERM",
              durationMs: 1,
              text: "Canceled",
              output: "",
              truncated: false,
            }),
          { once: true },
        );
      }),
  );
  h.enter();
  const pending = h.invoke();
  await started;
  expect(await h.emit("input")).toContainEqual({ action: "handled" });
  expect(await h.emit("tool_call")).toContainEqual({
    block: true,
    reason: "Cadence foreground work is active",
  });
  expect((await h.emit("user_bash"))[0].result.exitCode).toBe(1);
  expect(await h.emit("session_before_switch")).toContainEqual({
    cancel: true,
  });
  await pending;
  expect(await h.emit("tool_call")).toEqual([undefined]);
  expect(worker).toHaveBeenCalledTimes(1);
});

const completed = {
  outcome: "completed",
  closed: true,
  exitCode: 0,
  signal: null,
  durationMs: 1,
  text: "Advisory draft",
  output: "",
  truncated: false,
};
function savedTask(h: ReturnType<typeof host>) {
  const tasks = join(h.cwd, ".cadence", "assistant", "tasks");
  return JSON.parse(
    readFileSync(join(tasks, readdirSync(tasks)[0], "task.json"), "utf8"),
  );
}
for (const kind of ["research", "diagnosis"] as const) {
  it(`native ${kind} starts goal-only with readonly request and no shell check menu`, async () => {
    const h = host();
    await h.emit("session_start");
    h.notices.length = 0;
    h.selections.push(
      "New",
      kind,
      "Start / Continue",
      "Review / Done",
      "Return",
    );
    h.edits.push("Investigate unavailable evidence");
    worker.mockResolvedValue({
      ...completed,
      text: "Remote collector unavailable; local finding only",
    });
    h.enter();
    await h.invoke();
    expect(worker).toHaveBeenCalledTimes(1);
    const request = worker.mock.calls[0][0];
    expect(request.kind).toBe(kind);
    expect(request.instructions).toContain("Read-only");
    expect(request.prompt).toContain("Optional approach");
    const menu = h.ctx.ui.select.mock.calls.find((call: any[]) =>
      call[1].includes("Start / Continue"),
    )[1];
    expect(menu).not.toContain("Checks");
    expect(menu).not.toContain("Generate plan (readonly)");
    expect(h.ctx.ui.confirm.mock.calls[0][1]).toContain(
      "Read/grep/find/ls only",
    );
    const task = savedTask(h);
    expect(task.plan).toBe("");
    expect(task.review.outcome).toBe("reviewed");
    expect(task.result).toContain("unavailable");
    expect(task.checks).toEqual([]);
    expect(h.notices).toEqual([]);
  });
}
it("Generate plan reuses exact auth/explorer instructions and persists draft without implicit Start", async () => {
  const h = host();
  await h.emit("session_start");
  h.notices.length = 0;
  h.selections.push("New", "code", "Generate plan (readonly)", "Return");
  h.edits.push("Goal without a plan");
  worker.mockResolvedValue(completed);
  h.enter();
  await h.invoke();
  expect(worker).toHaveBeenCalledTimes(1);
  const request = worker.mock.calls[0][0];
  expect(request.kind).toBe("research");
  expect(request.model).toEqual(h.ctx.model);
  expect(request.auth.apiKey).toBe("fabricated-host-key");
  expect(request.instructions).toContain("Read-only");
  expect(request.prompt).toContain("do not implement or run commands");
  expect(h.ctx.ui.confirm.mock.calls[0][1]).toContain("separate Start");
  expect(savedTask(h).phase).toBe("planning");
  expect(savedTask(h).plan).toBe("Advisory draft");
  expect(savedTask(h).kind).toBe("code");
  expect(h.notices).toEqual([]);
});
it("Generate plan Escape before progress launch is inert", async () => {
  const h = host();
  await h.emit("session_start");
  h.notices.length = 0;
  h.selections.push("New", "code", "Generate plan (readonly)", "Return");
  h.edits.push("Goal");
  h.custom((component, label) => {
    if (label.startsWith("Cadence foreground")) component.handleInput("\x1b");
  });
  h.enter();
  await h.invoke();
  expect(worker).not.toHaveBeenCalled();
  expect(savedTask(h).phase).toBe("planning");
  expect(savedTask(h).plan).toBe("");
});

it("same-revision manual plan edit during native confirmation cannot reuse displayed Start", async () => {
  const h = host();
  await h.emit("session_start");
  h.selections.push("New", "code", "Plan", "Start / Continue", "Return");
  h.edits.push("Goal", "Displayed plan");
  let external = "";
  let path = "";
  h.confirm(async () => {
    const tasks = join(h.cwd, ".cadence", "assistant", "tasks");
    path = join(tasks, readdirSync(tasks)[0], "task.json");
    external = JSON.stringify({
      ...JSON.parse(readFileSync(path, "utf8")),
      plan: "Manual replacement",
    });
    writeFileSync(path, external);
    return true;
  });
  h.enter();
  await h.invoke();
  expect(worker).not.toHaveBeenCalled();
  expect(readFileSync(path, "utf8")).toBe(external);
  expect(h.notices.some((notice) => notice.includes("changed"))).toBe(true);
});
