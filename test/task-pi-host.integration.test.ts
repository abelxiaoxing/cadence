import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import * as piSdk from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskHost, deferred } from "./helpers/task-pi-host.ts";

const hosts: Awaited<ReturnType<typeof createTaskHost>>[] = [];
async function host(...args: Parameters<typeof createTaskHost>) {
  const value = await createTaskHost(...args);
  hosts.push(value);
  return value;
}
afterEach(async () => {
  for (const value of hosts.splice(0)) {
    await value.dispose();
    expect(value.errors).toEqual([]);
  }
});

const command = "/task-host-probe bounded request";

describe("task host fixture failure cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("removes its root when provider initialization fails", async () => {
    const parent = mkdtempSync(join(os.tmpdir(), "cadence-task-host-cleanup-"));
    const failure = new Error("injected provider initialization failure");
    try {
      for (const name of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(name, parent);
      expect(os.tmpdir()).toBe(parent);
      vi.spyOn(piSdk.ModelRuntime, "create").mockRejectedValueOnce(failure);
      await expect(createTaskHost()).rejects.toBe(failure);
      expect(readdirSync(parent)).toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("disposes a real session if factory validation fails before runtime construction", async () => {
    const getExtensions = piSdk.DefaultResourceLoader.prototype.getExtensions;
    vi.spyOn(
      piSdk.DefaultResourceLoader.prototype,
      "getExtensions",
    ).mockImplementation(function (this: piSdk.DefaultResourceLoader) {
      return {
        ...getExtensions.call(this),
        errors: [{ path: "test-only", error: "injected loader error" }],
      };
    });
    const dispose = vi.spyOn(piSdk.AgentSession.prototype, "dispose");
    await expect(createTaskHost()).rejects.toThrow(
      "Test extension failed to load",
    );
    expect(dispose).toHaveBeenCalledOnce();
    const session = dispose.mock.contexts[0] as piSdk.AgentSession;
    expect(session).toBeInstanceOf(piSdk.AgentSession);
    expect(existsSync(session.sessionManager.getCwd())).toBe(false);
    expect(() => session.createReplacedSessionContext().isIdle()).toThrow(
      /stale/,
    );
  });

  it("disposes the runtime and removes its root when extension binding fails", async () => {
    const failure = new Error("injected bind failure");
    let session: piSdk.AgentSession | undefined;
    vi.spyOn(
      piSdk.AgentSession.prototype,
      "bindExtensions",
    ).mockImplementationOnce(async function (this: piSdk.AgentSession) {
      session = this;
      throw failure;
    });
    const dispose = vi.spyOn(piSdk.AgentSessionRuntime.prototype, "dispose");
    await expect(createTaskHost()).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledOnce();
    expect(session).toBeDefined();
    expect(existsSync(session!.sessionManager.getCwd())).toBe(false);
    expect(() => session!.createReplacedSessionContext().isIdle()).toThrow(
      /stale/,
    );
  });

  it("still disposes the session and removes its root when runtime disposal rejects", async () => {
    const h = await createTaskHost();
    const ctx = h.runtime.session.createReplacedSessionContext();
    const failure = new Error("injected runtime disposal failure");
    vi.spyOn(h.runtime, "dispose").mockRejectedValueOnce(failure);
    await expect(h.dispose()).rejects.toBe(failure);
    expect(existsSync(h.root)).toBe(false);
    expect(() => ctx.isIdle()).toThrow(/stale/);
  });
});

/** Real SDK/extension/runtime integration; controlled UI, not physical TUI input. */
describe("task entry capability proof on installed Pi 0.84.3", () => {
  it("pins the actual installed runtime, not the newer global documentation", () => {
    const entry = fileURLToPath(
      import.meta.resolve("@earendil-works/pi-coding-agent"),
    );
    const manifest = JSON.parse(
      readFileSync(join(dirname(entry), "..", "package.json"), "utf8"),
    );
    expect(manifest.version).toBe("0.84.3");
  });

  it.each(["rpc", "print", "json"] as const)(
    "rejects %s even when the host supplies a UI endpoint",
    async (mode) => {
      const h = await host(mode);
      await h.runtime.session.prompt(command, { source: "rpc" });
      expect(h.probe.commands).toMatchObject([{ mode, hasUI: true }]);
      expect(h.ui.requests).toHaveLength(0);
      expect(h.probe.effects).toEqual([]);
      expect(h.faux.state.callCount).toBe(0);
    },
  );

  it("rejects tui without UI rather than manufacturing a dialog result", async () => {
    const h = await host("tui", false);
    await h.runtime.session.prompt(command);
    expect(h.probe.commands).toMatchObject([{ mode: "tui", hasUI: false }]);
    expect(h.ui.requests).toHaveLength(0);
    expect(h.probe.effects).toEqual([]);
  });

  it("dispatches synthetic commands before input, without invocation provenance", async () => {
    const h = await host();
    const original = h.runtime.session.sessionId;
    const pending = h.runtime.session.prompt(command, { source: "extension" });
    await expect.poll(() => h.ui.requests.length).toBe(1);
    expect(h.probe.events).toEqual(["start:startup", "command"]);
    expect(h.probe.commands[0].keys).not.toContain("source");
    expect(h.probe.commands[0].keys).not.toContain("streamingBehavior");
    expect(h.probe.effects).toEqual([]);
    expect(h.runtime.session.sessionId).toBe(original);
    h.ui.requests[0].reply(undefined);
    await pending;
    expect(h.probe.effects).toEqual([]);
    expect(h.runtime.session.sessionId).toBe(original);
    h.faux.setResponses([fauxAssistantMessage("ordinary reply")]);
    await h.runtime.session.prompt("ordinary conversation", {
      source: "extension",
    });
    expect(h.probe.events).toContain("input:extension");
    expect(h.probe.effects).toEqual([]);
    expect(h.faux.state.callCount).toBe(1);
  });

  it("synthetic sendUserMessage expansion can request UI but supplies no entry result", async () => {
    const h = await host();
    h.faux.setResponses([fauxAssistantMessage("literal slash text")]);
    await h.runtime.session.sendUserMessage(command);
    expect(h.probe.commands).toEqual([]);
    expect(h.ui.requests).toEqual([]);
    const pending = h.runtime.session.sendUserMessage(command, {
      expandPromptTemplates: true,
    });
    await expect.poll(() => h.ui.requests.length).toBe(1);
    expect(h.probe.effects).toEqual([]);
    h.ui.requests[0].reply(undefined);
    await pending;
    expect(h.probe.effects).toEqual([]);
    expect(h.faux.state.callCount).toBe(1);
  });

  it.each([undefined, "Approve and execute", "create"])(
    "rejects absent or non-entry UI result %s",
    async (reply) => {
      const h = await host();
      const original = h.runtime.session;
      const pending = original.prompt(command);
      await expect.poll(() => h.ui.requests.length).toBe(1);
      h.ui.requests[0].reply(reply);
      await pending;
      expect(h.runtime.session).toBe(original);
      expect(h.probe.effects).toEqual([]);
      expect(h.probe.replacements).toEqual([]);
      expect(h.faux.state.callCount).toBe(0);
    },
  );

  it("needs one explicit Create callback and fresh context; duplicate replies cannot create twice", async () => {
    const h = await host();
    const original = h.runtime.session;
    original.sessionManager.appendMessage({
      role: "user",
      content: "SECRET-SENTINEL-prior-chat",
      timestamp: Date.now(),
    });
    const pending = original.prompt(command);
    await expect.poll(() => h.ui.requests.length).toBe(1);
    // The host does not serialize commands: the test controller must fence entry.
    await original.prompt(command);
    expect(h.probe.commands).toHaveLength(2);
    expect(h.ui.requests).toHaveLength(1);
    expect(h.probe.effects).toEqual([]);
    h.ui.requests[0].reply("Create");
    h.ui.requests[0].reply("Create");
    await pending;
    expect(h.probe.replacements).toEqual([{ cancelled: false }]);
    expect(h.probe.effects).toEqual([
      { action: "Create", sessionId: h.runtime.session.sessionId },
    ]);
    expect(h.runtime.session.sessionId).not.toBe(original.sessionId);
    expect(h.probe.events).toEqual([
      "start:startup",
      "command",
      "command",
      "before-switch:new",
      "shutdown:new",
      "start:new",
    ]);
    expect(h.probe.freshContexts[0].sessionManager.getSessionId()).toBe(
      h.runtime.session.sessionId,
    );
    expect(() => h.probe.contexts[0].isIdle()).toThrow(/stale/);
    expect(h.runtime.session.messages).toEqual([]);
    expect(
      JSON.stringify(h.runtime.session.sessionManager.getEntries()),
    ).not.toContain("SECRET-SENTINEL");
    expect(h.ui.editor).toEqual(["bounded task seed; no prior chat"]);
    expect(h.faux.state.callCount).toBe(0);
  });

  it("canceled new and switch preserve the current session and grant no attachment", async () => {
    const h = await host();
    h.probe.cancelNavigation = true;
    // Cancellation precedes trying to open this deliberately nonexistent path.
    h.probe.openPath = join(h.root, "missing.jsonl");
    const original = h.runtime.session;
    for (const action of ["Create", "Open"]) {
      const pending = original.prompt(command);
      await expect
        .poll(() => h.ui.requests.length)
        .toBe(h.probe.commands.length);
      h.ui.requests.at(-1)?.reply(action);
      await pending;
      expect(h.runtime.session).toBe(original);
      expect(h.probe.contexts.at(-1)?.isIdle()).toBe(true);
    }
    expect(h.probe.replacements).toEqual([
      { cancelled: true },
      { cancelled: true },
    ]);
    expect(h.probe.freshContexts).toEqual([]);
    expect(h.probe.effects).toEqual([]);
    expect(h.probe.events).not.toContain("shutdown:new");
    expect(h.probe.events).not.toContain("shutdown:resume");
  });

  it("Open uses real persisted session replacement and withSession, not execution", async () => {
    const h = await host();
    h.faux.setResponses([fauxAssistantMessage("saved history")]);
    await h.runtime.session.prompt("bounded original request");
    const savedId = h.runtime.session.sessionId;
    h.probe.openPath = h.runtime.session.sessionFile!;
    await h.runtime.newSession();
    const before = h.runtime.session;
    const pending = before.prompt(command, { source: "rpc" });
    await expect.poll(() => h.ui.requests.length).toBe(1);
    expect(h.probe.effects).toEqual([]);
    h.ui.requests[0].reply("Open");
    await pending;
    expect(h.runtime.session.sessionId).toBe(savedId);
    expect(h.probe.effects).toEqual([{ action: "Open", sessionId: savedId }]);
    expect(h.probe.freshContexts[0].sessionManager.getSessionId()).toBe(
      savedId,
    );
    expect(() => h.probe.contexts[0].sessionManager).toThrow(/stale/);
    expect(h.probe.events.slice(-3)).toEqual([
      "before-switch:resume",
      "shutdown:resume",
      "start:resume",
    ]);
    expect(h.faux.state.callCount).toBe(1);
  });

  it("fences stale pending UI after native replacement", async () => {
    const h = await host();
    const pending = h.runtime.session.prompt(command);
    await expect.poll(() => h.ui.requests.length).toBe(1);
    await h.runtime.newSession();
    const replacement = h.runtime.session;
    h.ui.requests[0].reply("Create");
    await pending;
    expect(h.runtime.session).toBe(replacement);
    expect(h.probe.effects).toEqual([]);
    expect(h.probe.replacements).toEqual([]);
  });

  it("invalidates a pending dialog on tree navigation even without runtime replacement", async () => {
    const h = await host();
    const original = h.runtime.session;
    const target = original.sessionManager.appendMessage({
      role: "user",
      content: "earlier context",
      timestamp: Date.now(),
    });
    original.sessionManager.appendCustomEntry("later-context", {});
    const pending = original.prompt(command);
    await expect.poll(() => h.ui.requests.length).toBe(1);
    expect(
      await original.navigateTree(target, { summarize: false }),
    ).toMatchObject({
      cancelled: false,
    });
    h.ui.requests[0].reply("Create");
    await pending;
    expect(h.runtime.session).toBe(original);
    expect(h.probe.effects).toEqual([]);
    expect(h.probe.replacements).toEqual([]);
    expect(h.faux.state.callCount).toBe(0);
  });

  it("executes registered commands during real streaming but the gate rejects busy entry", async () => {
    const h = await host();
    const started = deferred<void>();
    const finish = deferred<void>();
    h.faux.setResponses([
      async () => {
        started.resolve();
        await finish.promise;
        return fauxAssistantMessage("settled");
      },
    ]);
    const turn = h.runtime.session.prompt("hold a deterministic provider turn");
    try {
      await started.promise;
      expect(h.runtime.session.isStreaming).toBe(true);
      await h.runtime.session.prompt(command); // no streamingBehavior necessary
      expect(h.probe.commands).toMatchObject([{ idle: false }]);
      expect(h.ui.requests).toEqual([]);
      expect(h.probe.effects).toEqual([]);
    } finally {
      finish.resolve();
      await turn;
    }
    expect(h.runtime.session.isIdle).toBe(true);
    h.probe.controllerBusy = true;
    await h.runtime.session.prompt(command);
    expect(h.probe.commands.at(-1)?.idle).toBe(true);
    expect(h.ui.requests).toEqual([]);
  });

  it("rechecks controller and host idleness after the UI wait", async () => {
    const h = await host();
    const pending = h.runtime.session.prompt(command);
    await expect.poll(() => h.ui.requests.length).toBe(1);
    h.probe.controllerBusy = true;
    h.ui.requests[0].reply("Create");
    await pending;
    expect(h.probe.effects).toEqual([]);
    h.probe.controllerBusy = false;
    const next = h.runtime.session.prompt(command);
    await expect.poll(() => h.ui.requests.length).toBe(2);
    const started = deferred<void>();
    const finish = deferred<void>();
    h.faux.setResponses([
      async () => {
        started.resolve();
        await finish.promise;
        return fauxAssistantMessage("settled");
      },
    ]);
    const turn = h.runtime.session.prompt("become busy during dialog");
    try {
      await started.promise;
      h.ui.requests[1].reply("Create");
      await next;
      expect(h.probe.effects).toEqual([]);
    } finally {
      finish.resolve();
      await turn;
    }
  });

  it("real before-fork and before-tree cancellation preserves session and branch", async () => {
    const h = await host();
    h.probe.cancelNavigation = true;
    // Capture a real command context without entering a dialog.
    h.probe.controllerBusy = true;
    await h.runtime.session.prompt(command);
    const ctx = h.probe.contexts[0];
    const original = h.runtime.session;
    const target = original.sessionManager.appendMessage({
      role: "user",
      content: "branch point",
      timestamp: Date.now(),
    });
    const leaf = original.sessionManager.appendCustomEntry("test-leaf", {});
    expect(await ctx.fork(target)).toEqual({ cancelled: true });
    expect(await ctx.navigateTree(target, { summarize: false })).toEqual({
      cancelled: true,
    });
    expect(h.runtime.session).toBe(original);
    expect(original.sessionManager.getLeafId()).toBe(leaf);
    expect(h.probe.events.slice(-2)).toEqual(["before-fork", "before-tree"]);
    expect(h.probe.effects).toEqual([]);
    expect(h.faux.state.callCount).toBe(0);
  });
});
