import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
  type AgentSession,
  type AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionCommandContext,
  type ExtensionFactory,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { runtimeForProvider } from "./model-runtime.ts";

type ExtensionMode = ExtensionCommandContext["mode"];
type ReplacedSessionContext = ReturnType<
  AgentSession["createReplacedSessionContext"]
>;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Controlled UI endpoint, NOT a terminal or a source-authentication mock. */
export class ControlledTaskUI {
  readonly requests: Array<{
    choices: string[];
    reply: (value: string | undefined) => void;
  }> = [];
  readonly editor: string[] = [];
  select = async (_title: string, choices: string[]) => {
    const answer = deferred<string | undefined>();
    this.requests.push({ choices, reply: answer.resolve });
    return answer.promise;
  };
}

export type TaskProbe = ReturnType<typeof taskProbe>;
export function taskProbe() {
  return {
    events: [] as string[],
    commands: [] as Array<{
      args: string;
      mode: ExtensionMode;
      hasUI: boolean;
      idle: boolean;
      keys: string[];
    }>,
    effects: [] as Array<{ action: string; sessionId: string }>,
    contexts: [] as ExtensionCommandContext[],
    freshContexts: [] as ReplacedSessionContext[],
    replacements: [] as Array<{ cancelled: boolean }>,
    controllerBusy: false,
    cancelNavigation: false,
    openPath: "",
  };
}

/** Test-only receiver. There is deliberately no approval issuer or executor. */
function taskEntryFixture(probe: TaskProbe): ExtensionFactory {
  return (pi) => {
    let pending = false;
    let epoch = 0;
    let live = true;
    pi.on("input", (event) => {
      probe.events.push(`input:${event.source}`);
      return { action: "continue" };
    });
    pi.on("session_start", (event) => {
      probe.events.push(`start:${event.reason}`);
    });
    pi.on("session_shutdown", (event) => {
      live = false;
      epoch++;
      probe.events.push(`shutdown:${event.reason}`);
    });
    pi.on("session_before_switch", (event) => {
      epoch++;
      probe.events.push(`before-switch:${event.reason}`);
      return probe.cancelNavigation ? { cancel: true } : undefined;
    });
    pi.on("session_before_fork", () => {
      epoch++;
      probe.events.push("before-fork");
      return probe.cancelNavigation ? { cancel: true } : undefined;
    });
    pi.on("session_before_tree", () => {
      epoch++;
      probe.events.push("before-tree");
      return probe.cancelNavigation ? { cancel: true } : undefined;
    });
    pi.registerCommand("task-host-probe", {
      description: "Test-only entry intent capability probe",
      handler: async (args, ctx) => {
        probe.contexts.push(ctx);
        probe.commands.push({
          args,
          mode: ctx.mode,
          hasUI: ctx.hasUI,
          idle: ctx.isIdle(),
          keys: Object.keys(ctx),
        });
        probe.events.push("command");
        if (
          ctx.mode !== "tui" ||
          !ctx.hasUI ||
          !ctx.isIdle() ||
          probe.controllerBusy ||
          pending
        ) {
          return;
        }
        pending = true;
        const ticket = epoch;
        try {
          const choice = await ctx.ui.select("Task entry", ["Create", "Open"]);
          // Navigation can invalidate ctx while the controlled UI is pending.
          if (!live || ticket !== epoch) return;
          if (!ctx.isIdle() || probe.controllerBusy) return;
          if (choice !== "Create" && choice !== "Open") return;
          const withSession = async (fresh: ReplacedSessionContext) => {
            probe.freshContexts.push(fresh);
            probe.effects.push({
              action: choice,
              sessionId: fresh.sessionManager.getSessionId(),
            });
            fresh.ui.setEditorText("bounded task seed; no prior chat");
          };
          const result =
            choice === "Create"
              ? await ctx.newSession({ withSession })
              : await ctx.switchSession(probe.openPath, { withSession });
          // Old ctx is stale after success. Only plain observations below.
          probe.replacements.push(result);
        } finally {
          pending = false;
        }
      },
    });
  };
}

let sequence = 0;
export async function createTaskHost(
  mode: ExtensionMode = "tui",
  hasUI = true,
) {
  const root = mkdtempSync(join(tmpdir(), "cadence-task-pi-host-"));
  let ownedRuntime: AgentSessionRuntime | undefined;
  let ownedSession: AgentSession | undefined;
  async function dispose() {
    try {
      await ownedRuntime?.dispose();
    } finally {
      try {
        // Synchronous SDK disposal is idempotent. Also cover a factory that
        // created a session before failing, or runtime shutdown that rejected.
        ownedSession?.dispose();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
  try {
    const agentDir = join(root, "agent");
    const probe = taskProbe();
    const ui = new ControlledTaskUI();
    const errors: string[] = [];
    const faux = fauxProvider({
      provider: `task-host-${sequence++}`,
      api: "faux",
    });
    const modelRuntime = await runtimeForProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    let runtime: AgentSessionRuntime;
    const bind = async (session: AgentSession) => {
      await session.bindExtensions({
        mode,
        ...(hasUI
          ? {
              uiContext: {
                ...session.extensionRunner.getUIContext(),
                select: ui.select,
                setEditorText: (text: string) => ui.editor.push(text),
              },
            }
          : {}),
        onError: (error) => errors.push(error.error),
        // Same runtime endpoints as InteractiveMode, not successful-return stubs.
        commandContextActions: {
          waitForIdle: () => runtime.session.waitForIdle(),
          newSession: (options) => runtime.newSession(options),
          switchSession: (path, options) =>
            runtime.switchSession(path, options),
          fork: (id, options) => runtime.fork(id, options),
          navigateTree: (id, options) =>
            runtime.session.navigateTree(id, options),
          reload: async () => {
            throw new Error("Reload is outside this probe");
          },
        },
      });
    };
    runtime = await createAgentSessionRuntime(
      async (options) => {
        const services = await createAgentSessionServices({
          cwd: options.cwd,
          agentDir: options.agentDir,
          modelRuntime,
          settingsManager,
          resourceLoaderOptions: {
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            extensionFactories: [taskEntryFixture(probe)],
          },
        });
        const result = await createAgentSessionFromServices({
          services,
          sessionManager: options.sessionManager,
          sessionStartEvent: options.sessionStartEvent,
          model: faux.getModel(),
          tools: [],
        });
        ownedSession = result.session;
        if (result.extensionsResult.errors.length) {
          throw new Error("Test extension failed to load");
        }
        return { ...result, services, diagnostics: services.diagnostics };
      },
      {
        cwd: root,
        agentDir,
        sessionManager: SessionManager.create(root, join(root, "sessions")),
      },
    );
    ownedRuntime = runtime;
    runtime.setRebindSession(bind);
    await bind(runtime.session);
    return {
      root,
      runtime,
      ui,
      probe,
      faux,
      errors,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
