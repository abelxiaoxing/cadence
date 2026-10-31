import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CADENCE_MODE_ENTRY,
  CadenceUserInput,
  registerCadenceMode,
  restoreCadenceMode,
} from "../src/cadence-mode.ts";
import { plan } from "./helpers/workflow-plan.ts";

const injected = vi.hoisted(() => ({
  client: null as any,
  epoch: "",
  detach: vi.fn(),
}));
vi.mock("../src/native-client.ts", () => ({
  departure: async (p: Promise<void>) => p,
  NativeConnection: class {
    client = injected.client;
    session = { epoch: injected.epoch };
    compatible() {
      return true;
    }
    detach() {
      injected.detach();
      return Promise.resolve();
    }
    attach() {
      this.client = injected.client;
      return Promise.resolve(this.client);
    }
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function host(entries: any[] = []) {
  const root = mkdtempSync(join(tmpdir(), "cadence-mode-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", root);
  const handlers = new Map<string, any[]>(),
    tools = new Map<string, any>(),
    commands = new Map<string, any>(),
    raw = new Set<any>();
  const messages: any[] = [],
    user: string[] = [];
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
    steps: [],
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
  injected.epoch = epoch;
  injected.client = {
    models: async () => ({
      kind: "ok",
      value: {
        version,
        selected: model,
        status: "complete",
        entries: [],
        withheld: 0,
      },
    }),
    workbenchCommand: async (c: any) => {
      effects.push(c.request.action);
      if (c.request.action === "execute" || c.request.action === "research")
        run.id = c.commandId;
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
      return {
        kind: "ok",
        value: { kind: "workflow", commandId: c.commandId, response: r },
      };
    },
    workbenchRead: async () => ({
      kind: "ok",
      value: {
        kind: "workflow",
        commandId: null,
        response: { type: "run", run },
      },
    }),
  };
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
      active = v;
    },
    appendEntry: (customType: string, data: any) =>
      entries.push({ type: "custom", customType, data: structuredClone(data) }),
    sendMessage: (m: any) => messages.push(m),
    sendUserMessage: (text: string) => user.push(text),
    exec: vi.fn(),
  };
  const ctx: any = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    model: { provider: "fixture", id: "fixed", api: "openai-completions" },
    thinkingLevel: "off",
    isIdle: () => true,
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
      notify: vi.fn(),
      confirm: vi.fn(async () => false),
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
  return {
    pi,
    ctx,
    entries,
    tools,
    commands,
    messages,
    user,
    effects,
    emit,
    enter,
    active: () => active,
    proposal,
    run,
  };
}
it("one raw /cadence enables all subsequent turns, completion does not exit, and ordinary load is inert", async () => {
  const h = host();
  await h.emit("session_start");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  await h.commands.get("cadence").handler("goal", h.ctx);
  expect(h.user).toEqual([]);
  h.enter("/cadence goal");
  await h.commands.get("cadence").handler("goal", h.ctx);
  expect(h.user).toEqual(["goal"]);
  expect(h.pi.exec).not.toHaveBeenCalled();
  for (const message of [
    "clarify behavior",
    "another question",
    "next goal after completion",
  ]) {
    h.enter(message);
    await h.emit("input", { text: message, source: "interactive" });
    expect((await h.emit("before_agent_start"))[0].message.content).toContain(
      "stays enabled for this entire conversation",
    );
  }
  expect(h.active()).toContain("cadence_plan");
  expect(h.active()).not.toContain("write");
  expect((await h.emit("tool_call", { toolName: "write" }))[0].block).toBe(
    true,
  );
  h.enter("退出 Cadence");
  await h.emit("input", { text: "退出 Cadence", source: "interactive" });
  expect(h.active()).toEqual(["read", "write", "bash"]);
  expect(h.effects).not.toContain("cancel");
  await h.emit("session_shutdown");
});
it("exact user approval starts once without a second confirmation; model/extension text cannot approve", async () => {
  const h = host();
  await h.emit("session_start");
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  const call = (name: string, args = {}) =>
    h.tools.get(name).execute("call", args, undefined, undefined, h.ctx);
  await call("cadence_plan", plan());
  await h.emit("input", { text: "按计划实施", source: "extension" });
  await call("cadence_start");
  expect(h.effects).not.toContain("execute");
  h.ctx.ui.confirm.mockClear();
  h.enter("按计划实施");
  await h.emit("input", { text: "按计划实施", source: "interactive" });
  await call("cadence_start");
  expect(h.effects.filter((v) => v === "execute")).toHaveLength(1);
  expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  await expect(call("cadence_start")).rejects.toThrow("No current plan");
  expect((await h.emit("before_agent_start"))[0].message.content).toContain(
    "CADENCE CONVERSATION MODE",
  );
  expect(JSON.stringify(h.entries)).not.toContain('"grant"');
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
it("raw evidence is one-use, expires, and cannot originate in paste", () => {
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
});

it("branch navigation and a new conversation restore normal tools without copying active mode", async () => {
  const h = host();
  await h.emit("session_start");
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  await h.emit("session_before_tree");
  h.entries.length = 0;
  await h.emit("session_tree");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  expect((await h.emit("before_agent_start"))[0]).toBeUndefined();
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  await h.emit("session_before_switch");
  h.entries.length = 0;
  await h.emit("session_start");
  expect(h.active()).toEqual(["read", "write", "bash"]);
  await h.emit("session_shutdown");
});
it("a lost execution reply retains the attempted ID and consumes the proposal rather than replaying Start", async () => {
  const h = host();
  await h.emit("session_start");
  h.enter("/cadence");
  await h.commands.get("cadence").handler("", h.ctx);
  const call = (name: string, input = {}) =>
    h.tools.get(name).execute("call", input, undefined, undefined, h.ctx);
  await call("cadence_plan", plan());
  h.enter("按计划实施");
  await h.emit("input", { text: "按计划实施", source: "interactive" });
  const original = injected.client.workbenchCommand;
  injected.client.workbenchCommand = async (c: any) => {
    const response = await original(c);
    return c.request.action === "execute"
      ? {
          kind: "error",
          error: {
            code: "unavailable",
            effect: "uncertain",
            recovery: "observe",
          },
        }
      : response;
  };
  await expect(call("cadence_start")).rejects.toThrow("unavailable");
  await expect(call("cadence_start")).rejects.toThrow("No current plan");
  expect(h.entries.at(-1).data).toMatchObject({
    enabled: true,
    runId: h.run.id,
    proposal: null,
  });
  expect(h.effects.filter((e) => e === "execute")).toHaveLength(1);
  await h.emit("session_shutdown");
});
