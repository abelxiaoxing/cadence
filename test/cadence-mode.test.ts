import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CADENCE_MODE_ENTRY,
  CadenceUserInput,
  DIALOG_SETTLE_MS,
  exiting,
  registerCadenceMode,
  restoreCadenceMode,
  transcriptText,
} from "../src/cadence-mode.ts";
import { plan } from "./helpers/workflow-plan.ts";

const injected = vi.hoisted(() => ({
  client: null as any,
  epoch: "",
  detach: vi.fn(),
  /** When set, the connection starts unattached and attach() runs this. */
  attach: null as null | ((connection: any) => Promise<void>),
  attaches: 0,
  forgotten: 0,
}));
vi.mock("../src/native-client.ts", () => ({
  departure: async (p: Promise<void>) => p,
  projectStopCommand: (workspace: string) =>
    `cadence stop --workspace ${JSON.stringify(workspace)}`,
  NativeConnection: class {
    client = injected.attach ? undefined : injected.client;
    session = injected.attach ? undefined : { epoch: injected.epoch };
    compatible() {
      return !!this.session;
    }
    forgetSuperseded() {
      injected.forgotten++;
      return false;
    }
    detach() {
      injected.detach();
      return Promise.resolve();
    }
    async attach() {
      injected.attaches++;
      if (injected.attach) await injected.attach(this);
      else {
        this.client = injected.client;
        this.session = { epoch: injected.epoch };
      }
      return this.client;
    }
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  injected.attach = null;
  injected.attaches = 0;
  injected.forgotten = 0;
});
const ok = (value: unknown) => ({ kind: "ok", value });
const refusal = (code: string, effect: string) => ({
  kind: "error",
  error: { code, effect, recovery: "operator" },
});
function host(entries: any[] = []) {
  const root = mkdtempSync(join(tmpdir(), "cadence-mode-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
  // Private state lives outside the project, as the owner requires.
  vi.stubEnv("XDG_STATE_HOME", mkdtempSync(join(tmpdir(), "cadence-state-")));
  const handlers = new Map<string, any[]>(),
    tools = new Map<string, any>(),
    commands = new Map<string, any>(),
    raw = new Set<any>();
  const messages: any[] = [],
    user: string[] = [],
    sets: string[][] = [];
  let active = ["read", "write", "bash"],
    editor = "";
  const epoch = randomUUID(),
    version = {
      epoch,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    };
  const model = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
    sourceSelectionId: randomUUID(),
  };
  const run = {
    id: randomUUID(),
    epoch,
    goal: "goal",
    status: "completed",
    phase: "finished",
    steps: [] as any[],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  };
  const proposal = {
    id: randomUUID(),
    epoch,
    digest: "a".repeat(64),
    observation: "b".repeat(64),
    model: version,
    cwd: root,
    plan: plan(),
  };
  const effects: string[] = [];
  /** Run IDs the owner knows; others read as unavailable. */
  const known = new Set<string>();
  const live = new Set<string>();
  /** A one-shot refusal for the next command with this action. */
  const refuse = new Map<string, unknown>();
  injected.epoch = epoch;
  injected.client = {
    models: vi.fn(async () =>
      ok({
        version,
        selected: model,
        status: "complete",
        entries: [],
        withheld: 0,
      }),
    ),
    chooseModel: vi.fn(async () => ok({})),
    workbenchCommand: vi.fn(async (c: any) => {
      effects.push(c.request.action);
      const refused = refuse.get(c.request.action);
      if (refused) {
        refuse.delete(c.request.action);
        return refused;
      }
      if (c.request.action === "execute" || c.request.action === "research") {
        run.id = c.commandId;
        known.add(run.id);
      }
      if (c.request.action === "propose") proposal.id = c.commandId;
      const r =
        c.request.action === "propose"
          ? { type: "proposal", proposal }
          : c.request.action === "prepare"
            ? {
                type: "grant",
                proposal,
                grant: randomUUID(),
                expiresAt: Date.now() + 120000,
              }
            : { type: "run", run };
      return ok({ kind: "workflow", commandId: c.commandId, response: r });
    }),
    workbenchRead: vi.fn(async (r: any) => {
      if (r.kind === "workflow-active")
        return ok({
          kind: "workflow-active",
          runs: [...live].map((id) => ({ ...run, id, steps: [] })),
        });
      if (r.kind === "workflow-transcript")
        return ok({
          kind: "workflow-transcript",
          runId: r.id,
          stepId: r.stepId,
          turn: {
            id: randomUUID(),
            epoch,
            status: "completed",
            items: [
              {
                id: "m",
                role: "assistant",
                text: "looked",
                name: "",
                args: "",
                error: false,
              },
              {
                id: "t",
                role: "tool",
                text: "file body",
                name: "read",
                args: '{"path":"a"}',
                error: false,
              },
            ],
            notice: "",
            omitted: { thinking: false, media: false, other: false },
          },
        });
      if (!known.has(r.id) && r.id !== run.id)
        return refusal("unavailable", "none");
      return ok({
        kind: "workflow",
        commandId: null,
        response: { type: "run", run: { ...run, id: r.id } },
      });
    }),
  };
  const notices: string[] = [];
  const pi: any = {
    on: (name: string, fn: any) =>
      handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    registerTool: (t: any) => {
      tools.set(t.name, t);
      active.push(t.name);
    },
    registerCommand: (n: string, c: any) => commands.set(n, c),
    getActiveTools: () => active,
    setActiveTools: (v: string[]) => {
      sets.push(v);
      active = v;
    },
    appendEntry: (customType: string, data: any) =>
      entries.push({ type: "custom", customType, data: structuredClone(data) }),
    sendMessage: (m: any) => messages.push(m),
    sendUserMessage: (text: string) => user.push(text),
    exec: vi.fn(async () => ({
      code: 0,
      killed: false,
      stdout: "",
      stderr: "",
    })),
  };
  let idle = true;
  const ctx: any = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    model: { provider: "fixture", id: "fixed", api: "openai-completions" },
    thinkingLevel: "off",
    isIdle: () => idle,
    isProjectTrusted: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => entries },
    ui: {
      onTerminalInput: (f: any) => {
        raw.add(f);
        return () => raw.delete(f);
      },
      getEditorText: () => editor,
      setStatus: vi.fn(),
      notify: vi.fn((text: string) => notices.push(text)),
      select: vi.fn(async () => undefined),
    },
  };
  registerCadenceMode(pi);
  const emit = async (name: string, event: any = {}) => {
    const result = [];
    for (const h of handlers.get(name) ?? []) result.push(await h(event, ctx));
    return result;
  };
  const enter = (text: string) => {
    editor = text;
    for (const fn of raw) fn("\r");
  };
  const call = (name: string, input: object = {}) =>
    tools.get(name).execute("call", input, undefined, undefined, ctx);
  const start = async () => {
    await emit("session_start");
    enter("/cadence");
    await commands.get("cadence").handler("", ctx);
  };
  return {
    root,
    pi,
    ctx,
    entries,
    tools,
    commands,
    messages,
    user,
    effects,
    notices,
    sets,
    known,
    live,
    refuse,
    emit,
    enter,
    call,
    start,
    raw: () => [...raw],
    busy: (value: boolean) => {
      idle = !value;
    },
    active: () => active,
    setActive: (v: string[]) => {
      active = v;
    },
    proposal,
    run,
    last: () => entries.at(-1)?.data,
  };
}
/** The user picks `choice` with a typed Enter after the dialog settled. */
function typedChoice(
  h: ReturnType<typeof host>,
  choice: string,
  settled = true,
) {
  h.ctx.ui.select.mockImplementation(async () => {
    const opened = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(
      opened + (settled ? DIALOG_SETTLE_MS + 1 : 1),
    );
    for (const fn of h.raw()) fn("\r");
    vi.mocked(Date.now).mockRestore();
    return choice;
  });
}

it("one raw /cadence enables all subsequent turns, completion does not exit, and ordinary load is inert", async () => {
  const h = host();
  await h.emit("session_start");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  await h.commands.get("cadence").handler("goal", h.ctx);
  expect(h.user).toEqual([]);
  h.enter("/cadence goal ");
  await h.commands.get("cadence").handler("goal", h.ctx);
  expect(h.user).toEqual(["goal"]);
  expect(h.pi.exec).not.toHaveBeenCalled();
  expect(h.messages[0].content).toContain("exit cadence");
  expect(h.commands.get("cadence").description).toContain("/cadence exit");
  for (const message of [
    "clarify behavior",
    "another question",
    "next goal after completion",
  ]) {
    h.enter(message);
    await h.emit("input", { text: message, source: "interactive" });
    const [r] = await h.emit("before_agent_start", { systemPrompt: "BASE" });
    expect(r.systemPrompt).toMatch(/^BASE\n\n/);
    expect(r.systemPrompt).toContain(
      "stays enabled for this entire conversation",
    );
    expect(r.systemPrompt).toContain("/cadence exit");
    expect(r.message.content).not.toContain("CADENCE CONVERSATION MODE");
  }
  expect(h.active()).toContain("cadence_plan");
  expect(h.active()).not.toContain("write");
  expect((await h.emit("tool_call", { toolName: "write" }))[0].block).toBe(
    true,
  );
  h.enter("退出 Cadence ");
  await h.emit("input", { text: "退出 Cadence", source: "interactive" });
  expect(h.active()).toEqual(["read", "write", "bash"]);
  expect(h.effects).not.toContain("cancel");
  await h.emit("session_shutdown");
});
it("exit is honored while busy and from RPC or /cadence exit, never from extension text", async () => {
  expect(exiting(" exit cadence. ")).toBe(true);
  expect(exiting("please exit cadence")).toBe(false);
  const h = host();
  await h.start();
  h.busy(true);
  expect(
    await h.emit("input", { text: "exit cadence", source: "extension" }),
  ).toEqual([undefined]);
  expect(h.last().enabled).toBe(true);
  // Typed while a turn runs: no raw evidence needed, nothing is canceled.
  expect(
    await h.emit("input", {
      text: "exit cadence",
      source: "interactive",
      streamingBehavior: "steer",
    }),
  ).toEqual([{ action: "handled" }]);
  expect(h.last().enabled).toBe(false);
  expect(h.active()).toEqual(["read", "write", "bash"]);
  h.busy(false);
  await h.start();
  await h.commands.get("cadence").handler(" exit ", h.ctx);
  expect(h.last().enabled).toBe(false);
  expect(h.effects).not.toContain("cancel");
});
it("exact user approval starts once without a dialog; model/extension text cannot approve", async () => {
  const h = host();
  await h.start();
  await h.call("cadence_plan", plan());
  await h.emit("input", { text: "按计划实施", source: "extension" });
  await h.call("cadence_start");
  expect(h.effects).not.toContain("execute");
  expect(h.effects).not.toContain("prepare");
  h.ctx.ui.select.mockClear();
  h.enter("按计划实施");
  await h.emit("input", { text: "按计划实施", source: "interactive" });
  await h.call("cadence_start");
  expect(h.effects.filter((v) => v === "execute")).toHaveLength(1);
  expect(h.ctx.ui.select).not.toHaveBeenCalled();
  await expect(h.call("cadence_start")).rejects.toThrow("No current plan");
  expect(
    (await h.emit("before_agent_start", { systemPrompt: "" }))[0].systemPrompt,
  ).toContain("CADENCE CONVERSATION MODE");
  expect(JSON.stringify(h.entries)).not.toContain('"grant"');
  await h.emit("session_shutdown");
});
it("the Start dialog defaults to not starting, needs a settled typed Enter and prepares only after consent", async () => {
  const h = host();
  await h.start();
  await h.call("cadence_plan", plan());
  // A stray Enter selects the first, safe choice.
  h.ctx.ui.select.mockImplementation(async (_t: string, o: string[]) => o[0]);
  expect((await h.call("cadence_start")).content[0].text).toContain(
    "Not started",
  );
  // Choosing Start with a type-ahead Enter (before the dialog settled) or a
  // pasted Enter is not consent.
  typedChoice(h, "Start this exact plan", false);
  await h.call("cadence_start");
  h.ctx.ui.select.mockImplementation(async () => {
    for (const fn of h.raw()) fn("\x1b[200~\r\x1b[201~");
    return "Start this exact plan";
  });
  await h.call("cadence_start");
  expect(h.effects).toEqual(["propose"]);
  typedChoice(h, "Start this exact plan");
  await h.call("cadence_start");
  expect(h.effects).toEqual(["propose", "prepare", "execute"]);
  const [, options] = h.ctx.ui.select.mock.calls.at(-1);
  expect(options[0]).toMatch(/do not start/);
  // Cancel is guarded the same way.
  h.ctx.ui.select.mockImplementation(async (_t: string, o: string[]) => o[0]);
  expect((await h.call("cadence_cancel")).content[0].text).toContain(
    "not requested",
  );
  typedChoice(h, "Request cancellation");
  await h.call("cadence_cancel");
  expect(h.effects.at(-1)).toBe("cancel");
  await h.emit("session_shutdown");
});
it("a lost execution reply retains the attempted ID and consumes the proposal rather than replaying Start", async () => {
  const h = host();
  await h.start();
  await h.call("cadence_plan", plan());
  h.enter("按计划实施");
  await h.emit("input", { text: "按计划实施", source: "interactive" });
  h.refuse.set("execute", refusal("unavailable", "uncertain"));
  await expect(h.call("cadence_start")).rejects.toThrow("unavailable");
  await expect(h.call("cadence_start")).rejects.toThrow("No current plan");
  expect(h.last()).toMatchObject({
    enabled: true,
    runId: expect.any(String),
    proposal: null,
  });
  expect(h.effects.filter((e) => e === "execute")).toHaveLength(1);
  await h.emit("session_shutdown");
});
it("a definite refusal restores the previous state: no phantom run, the plan stays approvable", async () => {
  const h = host();
  await h.start();
  await h.call("cadence_plan", plan());
  h.enter("按计划实施");
  await h.emit("input", { text: "按计划实施", source: "interactive" });
  h.refuse.set("execute", refusal("expired-grant", "none"));
  await expect(h.call("cadence_start")).rejects.toThrow("expired-grant");
  expect(h.last()).toMatchObject({ runId: null });
  typedChoice(h, "Start this exact plan");
  await h.call("cadence_start");
  expect(h.effects.filter((e) => e === "execute")).toHaveLength(2);
  // Research refused before acceptance leaves the previous run in place.
  const settled = h.run.id;
  h.refuse.set("research", refusal("forbidden", "none"));
  await expect(
    h.call("cadence_research", { goal: "g", questions: ["q"] }),
  ).rejects.toThrow("forbidden");
  expect(h.last().runId).toBe(settled);
  await h.call("cadence_plan", plan());
  await h.emit("session_shutdown");
});
it("an uncertain attempt is forgotten only after a reachable owner proves it absent", async () => {
  const h = host();
  await h.start();
  h.refuse.set("research", refusal("forbidden", "uncertain"));
  await expect(
    h.call("cadence_research", { goal: "g", questions: ["q"] }),
  ).rejects.toThrow("forbidden");
  const attempted = h.last().runId;
  expect(attempted).toEqual(expect.any(String));
  // Listed as active: never forgotten.
  h.live.add(attempted);
  h.run.id = randomUUID();
  await expect(h.call("cadence_status")).rejects.toThrow("unavailable");
  expect(h.last().runId).toBe(attempted);
  h.live.clear();
  expect((await h.call("cadence_status")).content[0].text).toContain(
    "never accepted",
  );
  expect(h.last().runId).toBeNull();
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  expect(h.effects.filter((e) => e === "research")).toHaveLength(2);
  await h.emit("session_shutdown");
});
it("an unknown outcome blocks new work until it is explicitly observed, and is never called completed", async () => {
  const h = host();
  await h.start();
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  h.run.status = "unknown";
  await expect(h.call("cadence_plan", plan())).rejects.toThrow(
    "unknown outcome",
  );
  const text = (await h.call("cadence_status")).content[0].text;
  expect(text).toContain("Outcome unknown");
  expect(text).not.toMatch(/Cadence completed/);
  await h.call("cadence_plan", plan());
  expect(h.effects).toContain("propose");
  await h.emit("session_shutdown");
});
it("a plan is shown through its own tool result, never injected mid-tool; owner redaction is shown", async () => {
  const h = host();
  await h.start();
  const before = h.messages.length;
  h.proposal.plan = { ...plan(), design: "Use [redacted] here." };
  const out = await h.call("cadence_plan", plan());
  expect(h.messages).toHaveLength(before);
  expect(out.details.plan).toContain("[redacted]");
  expect(out.content[0].text).toContain("redacted");
  const rendered = h.tools
    .get("cadence_plan")
    .renderResult(out, { expanded: false }, {}, {});
  expect(rendered.render(100).join("\n")).toContain("Plan identity");
  await h.emit("session_shutdown");
});
it("a result finishing while Pi is busy is appended only once Pi settles", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const h = host();
  await h.start();
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  h.run.status = "running";
  await h.call("cadence_status");
  h.run.status = "completed";
  h.busy(true);
  const before = h.messages.length;
  await vi.advanceTimersByTimeAsync(2000);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  expect(h.messages).toHaveLength(before);
  expect(h.notices.at(-1)).toContain("completed");
  h.busy(false);
  await h.emit("agent_settled");
  expect(h.messages.at(-1).customType).toBe("cadence-workflow-result");
  await h.emit("session_shutdown");
});
it("older injected context is filtered; a disabled mode leaves none", async () => {
  const h = host();
  await h.start();
  const context = (customType: string) => ({
    role: "custom",
    customType,
    content: "x",
  });
  const messages = [
    context("cadence-mode-ready"),
    { role: "user", content: "a" },
    context("cadence-mode-context"),
    { role: "user", content: "b" },
    context("cadence-mode-context"),
  ];
  const [kept] = await h.emit("context", { messages });
  expect(kept.messages).toEqual([messages[1], messages[3], messages[4]]);
  await h.commands.get("cadence").handler("exit", h.ctx);
  const [none] = await h.emit("context", { messages });
  expect(none.messages).toEqual([messages[1], messages[3]]);
  await h.emit("session_shutdown");
});
it("a saved mode is inert outside the trusted terminal and can be left without one", async () => {
  const h = host([
    {
      type: "custom",
      customType: CADENCE_MODE_ENTRY,
      data: {
        enabled: true,
        cwd: "",
        runId: null,
        proposal: null,
        previousTools: ["read", "write", "bash"],
      },
    },
  ]);
  h.entries[0].data.cwd = h.ctx.cwd;
  h.ctx.mode = "rpc";
  await h.emit("session_start");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  expect(await h.emit("tool_call", { toolName: "write" })).toEqual([undefined]);
  expect(await h.emit("before_agent_start", { systemPrompt: "" })).toEqual([
    undefined,
  ]);
  await expect(h.call("cadence_status")).rejects.toThrow("forbidden");
  expect(
    await h.emit("input", { text: "exit cadence", source: "rpc" }),
  ).toEqual([{ action: "handled" }]);
  expect(h.last().enabled).toBe(false);
});
it("tree navigation never resets tools in a session that does not show Cadence tools", async () => {
  const h = host();
  await h.emit("session_start");
  h.setActive(["read"]);
  h.sets.length = 0;
  await h.emit("session_before_tree");
  await h.emit("session_tree");
  expect(h.sets).toEqual([]);
  expect(h.active()).toEqual(["read"]);
  await h.emit("session_shutdown");
});
it("branch navigation and a new conversation restore normal tools without copying active mode", async () => {
  const h = host();
  await h.start();
  await h.emit("session_before_tree");
  h.entries.length = 0;
  await h.emit("session_tree");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  expect(await h.emit("before_agent_start", { systemPrompt: "" })).toEqual([
    undefined,
  ]);
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  await h.emit("session_before_switch");
  h.entries.length = 0;
  await h.emit("session_start");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  await h.emit("session_shutdown");
});
it("active-branch restore retains mode but never an approval, proposal or implicit execution", () => {
  const state = {
    enabled: true,
    cwd: "/project",
    runId: randomUUID(),
    proposal: { grant: "untrusted" },
    previousTools: ["read"],
  };
  const restored = restoreCadenceMode(
    [{ type: "custom", customType: CADENCE_MODE_ENTRY, data: state }],
    "/project",
  );
  expect(restored).toMatchObject({
    enabled: true,
    proposal: null,
    previousTools: ["read"],
  });
  expect(restoreCadenceMode([], "/project").enabled).toBe(false);
  expect(
    restoreCadenceMode(
      [{ type: "custom", customType: CADENCE_MODE_ENTRY, data: state }],
      "/other",
    ).enabled,
  ).toBe(false);
});
it("raw evidence is one-use, expires, cannot originate in paste and ignores surrounding whitespace", () => {
  const latch = new CadenceUserInput();
  latch.input("\r", "/cadence", true, 1);
  expect(latch.consume("/cadence", 1501)).toBe(false);
  latch.input("\x1b[200~", "/cadence", true);
  latch.input("\r", "/cadence", true);
  expect(latch.consume("/cadence")).toBe(false);
  latch.input("\x1b[201~", "/cadence", true);
  latch.input("\r", "/cadence", true);
  expect(latch.consume("/cadence")).toBe(true);
  expect(latch.consume("/cadence")).toBe(false);
  latch.input("\r", " /cadence  goal ", true);
  expect(latch.consumeCommand(" goal")).toBe(true);
  latch.openDialog(10);
  latch.input("\r", "", true, 10 + DIALOG_SETTLE_MS - 1);
  expect(latch.closeDialog()).toBe(false);
  latch.openDialog(10);
  latch.input("\r", "", true, 10 + DIALOG_SETTLE_MS);
  expect(latch.closeDialog()).toBe(true);
});
it("a dead or half-made attachment is replaced on the next call and on /cadence", async () => {
  const h = host();
  await h.start();
  injected.client.workbenchRead.mockResolvedValueOnce(
    refusal("unavailable", "none"),
  );
  injected.client.workbenchRead.mockResolvedValueOnce(
    refusal("unavailable", "none"),
  );
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  const attaches = injected.attaches;
  await expect(h.call("cadence_status")).rejects.toThrow("unavailable");
  await h.call("cadence_status");
  expect(injected.attaches).toBe(attaches + 1);
  expect(injected.forgotten).toBe(1);
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  await h.call("cadence_status");
  expect(injected.attaches).toBe(attaches + 2);
  await h.emit("session_shutdown");
});
it("a restarted owner on the same port (forbidden old capability) triggers the registry check", async () => {
  const h = host();
  await h.start();
  injected.client.workbenchRead.mockResolvedValueOnce(
    refusal("forbidden", "none"),
  );
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  const forgotten = injected.forgotten;
  await expect(h.call("cadence_status")).rejects.toThrow("forbidden");
  await h.call("cadence_status");
  expect(injected.forgotten).toBe(forgotten + 1);
  await h.emit("session_shutdown");
});
it("a model-selecting call never inherits an attach-only connection", async () => {
  let release!: () => void;
  injected.attach = (connection) =>
    new Promise<void>((resolve) => {
      release = () => {
        connection.client = injected.client;
        connection.session = { epoch: injected.epoch };
        resolve();
      };
    });
  const h = host();
  await h.start();
  // The owner has no selected model until one is chosen.
  let selected: object | null = null;
  injected.client.models.mockImplementation(async () =>
    ok({
      version: { epoch: injected.epoch, accessGeneration: 1, configRev: 1 },
      selected,
      status: "complete",
      entries: [],
      withheld: 0,
    }),
  );
  injected.client.chooseModel.mockImplementation(async (r: any) => {
    selected = r.choice;
    return ok({});
  });
  // The model picker attaches without selecting a model.
  const picking = h.call("cadence_model");
  const planning = h.call("cadence_plan", plan());
  await new Promise((r) => setImmediate(r));
  release();
  const settled = await Promise.allSettled([picking, planning]);
  expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(injected.client.chooseModel).toHaveBeenCalledTimes(1);
  expect(injected.attaches).toBe(1);
  await h.emit("session_shutdown");
});
it("an unreadable preference does not block planning, and an explicit model choice rewrites it", async () => {
  const h = host();
  const file = join(h.root, "agent", "cadence", "settings.json");
  mkdirSync(join(h.root, "agent", "cadence"), { recursive: true });
  writeFileSync(file, "{not json");
  await h.start();
  await h.call("cadence_plan", plan());
  expect(h.notices.join("\n")).toContain("unreadable");
  expect(readFileSync(file, "utf8")).toBe("{not json");
  injected.client.models.mockImplementation(async () =>
    ok({
      version: { epoch: injected.epoch, accessGeneration: 1, configRev: 1 },
      selected: null,
      status: "complete",
      entries: [
        {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          eligibility: "candidate",
          thinking: [{ level: "off", selectable: true }],
        },
      ],
      withheld: 0,
    }),
  );
  // An untyped (stray) selection changes nothing.
  h.ctx.ui.select.mockResolvedValueOnce("fixture/fixed (openai-completions)");
  expect((await h.call("cadence_model")).content[0].text).toBe(
    "Model unchanged.",
  );
  expect(readFileSync(file, "utf8")).toBe("{not json");
  const picks = ["fixture/fixed (openai-completions)", "off"];
  typedChoice(h, "");
  const typed = h.ctx.ui.select.getMockImplementation();
  h.ctx.ui.select.mockImplementation(async (...args: unknown[]) => {
    await typed?.(...args);
    return picks.shift();
  });
  await h.call("cadence_model");
  expect(JSON.parse(readFileSync(file, "utf8")).model).toEqual({
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  });
  await h.emit("session_shutdown");
});
it("on-demand owner startup treats a killed launch as failure and tells the user once how to stop it", async () => {
  injected.attach = async (connection) => {
    connection.client = injected.client;
    connection.session = { epoch: injected.epoch };
  };
  const h = host();
  await h.start();
  h.pi.exec.mockResolvedValueOnce({
    code: 0,
    killed: true,
    stdout: "",
    stderr: "",
  });
  await expect(h.call("cadence_status")).resolves.toBeDefined();
  // No run yet: status needs no owner. Research does.
  await expect(
    h.call("cadence_research", { goal: "g", questions: ["q"] }),
  ).rejects.toThrow("startup deadline");
  expect(h.pi.exec.mock.calls[0][0]).toBe(
    process.versions.bun ? "node" : process.execPath,
  );
  expect(h.pi.exec.mock.calls[0][1]).toContain("project");
  h.pi.exec.mockResolvedValue({
    code: 0,
    killed: false,
    stdout: `${JSON.stringify({ status: "alive", workspace: "/w" })}\n`,
    stderr: "",
  });
  await h.call("cadence_research", { goal: "g", questions: ["q"] });
  const told = h.notices.filter((n) => n.includes("background project owner"));
  expect(told).toEqual([
    expect.stringContaining('cadence stop --workspace "/w"'),
  ]);
  await h.emit("session_shutdown");
});
it("a step transcript is bounded readable text", () => {
  expect(transcriptText(null)).toContain("No retained transcript");
  const text = transcriptText({
    id: randomUUID(),
    epoch: randomUUID(),
    status: "completed",
    items: [
      {
        id: "t",
        role: "tool",
        text: "x".repeat(10_000),
        name: "read",
        args: "{}",
        error: true,
      },
    ],
    notice: "",
    omitted: { thinking: false, media: false, other: false },
  });
  expect(text).toContain("tool read (error)");
  expect(text.length).toBeLessThan(5000);
});

it("concurrent native mutations refuse before sending and release the guard after refusal", async () => {
  const h = host();
  await h.start();
  let ready!: () => void;
  const contacted = new Promise<void>((r) => {
    ready = r;
  });
  let release!: () => void;
  injected.client.models.mockImplementationOnce(async () => {
    ready();
    await new Promise<void>((r) => {
      release = r;
    });
    throw new Error("fixture unavailable");
  });
  const first = h.call("cadence_research", { goal: "first", questions: ["q"] });
  const observed = expect(first).rejects.toThrow("fixture unavailable");
  await contacted;
  for (const [tool, args] of [
    ["cadence_research", { goal: "second", questions: ["q"] }],
    ["cadence_plan", plan()],
    ["cadence_start", {}],
  ] as const)
    await expect(h.call(tool, args)).rejects.toThrow("already in progress");
  expect(h.effects).toEqual([]);
  await expect(h.call("cadence_status")).resolves.toBeDefined();
  release();
  await observed;
  await h.call("cadence_research", { goal: "after refusal", questions: ["q"] });
  expect(h.effects).toEqual(["research"]);
  await h.emit("session_shutdown");
});

it("status selects an exact older run and step without replacing current identity", async () => {
  const h = host();
  await h.start();
  const runs = new Map<string, any>();
  injected.client.workbenchCommand.mockImplementation(async (c: any) => {
    const run = {
      ...h.run,
      id: c.commandId,
      status: "timeout",
      steps: [
        {
          id: `research-${c.commandId}`,
          childRunId: randomUUID(),
          kind: "research",
          status: "timeout",
          text: "timeout",
          exitCode: null,
          truncated: false,
        },
      ],
    };
    runs.set(run.id, run);
    return ok({
      kind: "workflow",
      commandId: c.commandId,
      response: { type: "run", run },
    });
  });
  injected.client.workbenchRead.mockImplementation(async (r: any) => {
    const run = runs.get(r.id);
    if (!run) return refusal("unavailable", "none");
    if (r.kind === "workflow-transcript")
      return ok({ kind: r.kind, runId: r.id, stepId: r.stepId, turn: null });
    if (r.kind === "workflow-detail")
      return ok({
        kind: "file",
        path: `workflow/${r.id}/${r.stepId}`,
        text: "retained timeout",
        limited: false,
      });
    return ok({
      kind: "workflow",
      commandId: null,
      response: { type: "run", run },
    });
  });
  const a = await h.call("cadence_research", {
    goal: "first",
    questions: ["q"],
  });
  await h.call("cadence_research", { goal: "second", questions: ["q"] });
  const [first, second] = [...runs.values()];
  expect(a.details).toEqual({
    runId: first.id,
    steps: [
      { stepId: first.steps[0].id, childRunId: first.steps[0].childRunId },
    ],
  });
  await expect(
    h.call("cadence_status", { stepId: first.steps[0].id, transcript: true }),
  ).rejects.toThrow(`selected run ${second.id}`);
  for (const transcript of [true, false]) {
    await h.call("cadence_status", {
      runId: first.id,
      stepId: first.steps[0].id,
      transcript,
    });
    expect(injected.client.workbenchRead).toHaveBeenLastCalledWith({
      kind: transcript ? "workflow-transcript" : "workflow-detail",
      id: first.id,
      stepId: first.steps[0].id,
    });
    expect(h.last().runId).toBe(second.id);
  }
  await h.emit("session_shutdown");
});

it("navigation retires only the old mutation claim: fresh Cancel and planning remain usable", async () => {
  const h = host();
  await h.start();
  (h.run as any).status = "running";
  const original = injected.client.workbenchCommand.getMockImplementation()!;
  let accepted!: () => void, releaseResearch!: () => void;
  let proposed!: () => void, releasePlan!: () => void;
  const received = new Promise<void>((r) => {
    accepted = r;
  });
  const planning = new Promise<void>((r) => {
    proposed = r;
  });
  injected.client.workbenchCommand.mockImplementation(async (c: any) => {
    if (c.request.action === "cancel") (h.run as any).status = "canceled";
    const response = await original(c);
    if (c.request.action === "research") {
      accepted();
      await new Promise<void>((r) => {
        releaseResearch = r;
      });
    } else if (c.request.action === "propose") {
      proposed();
      await new Promise<void>((r) => {
        releasePlan = r;
      });
    }
    return response;
  });
  const research = h.call("cadence_research", {
    goal: "pending reply",
    questions: ["q"],
  });
  const stale = expect(research).rejects.toThrow("stale");
  await received;
  const runId = h.last().runId;
  await h.emit("session_before_tree");
  await h.emit("session_tree");
  typedChoice(h, "Request cancellation");
  await h.call("cadence_cancel");
  expect(injected.client.workbenchCommand.mock.calls.at(-1)[0].request).toEqual(
    { action: "cancel", runId },
  );
  const next = h.call("cadence_plan", plan());
  await planning;
  releaseResearch();
  await stale;
  // Old finally must not release the new generation's claim.
  await expect(h.call("cadence_plan", plan())).rejects.toThrow(
    "already in progress",
  );
  releasePlan();
  await next;
  expect(h.effects).toEqual(["research", "cancel", "propose"]);
  await h.emit("session_shutdown");
});

it("a mutation resumed after navigation cannot dispatch into the new generation", async () => {
  const h = host();
  await h.start();
  const models = injected.client.models.getMockImplementation()!;
  let release!: () => void,
    reached!: () => void,
    calls = 0;
  const waiting = new Promise<void>((r) => {
    reached = r;
  });
  injected.client.models.mockImplementation(async () => {
    const value = await models();
    if (++calls === 2) {
      reached();
      await new Promise<void>((r) => {
        release = r;
      });
    }
    return value;
  });
  const old = h.call("cadence_research", {
    goal: "not sent",
    questions: ["q"],
  });
  const stale = expect(old).rejects.toThrow("stale");
  await waiting;
  await h.emit("session_before_tree");
  await h.emit("session_tree");
  await h.call("cadence_plan", plan());
  release();
  await stale;
  expect(h.effects).toEqual(["propose"]);
  expect(h.last().runId).toBeNull();
  await h.emit("session_shutdown");
});
