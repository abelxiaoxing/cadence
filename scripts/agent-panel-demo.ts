/** Dev-only Pi extension, not shipped: `/agents-demo [count]` plays fake
 * background agents on Pi's shared bus for manual acceptance of the panel.
 * It runs nothing; the second agent fails on purpose. Load it beside Cadence:
 *   pi -e ./src/index.ts -e ./scripts/agent-panel-demo.ts */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STEPS: [tool: string, args: object, activity: string, output: string][] =
  [
    ["read", { path: "README.md" }, "Reading README.md", "# Cadence\n…"],
    [
      "grep",
      { pattern: "registerTaskShell", path: "src" },
      "Searching for registerTaskShell call sites",
      "src/index.ts:10:  registerTaskShell(pi);",
    ],
    [
      "read",
      { path: "src/service/scheduler.ts" },
      "Inspecting scheduler.ts admission and overlap exclusion rules",
      "export class Scheduler {\n  …\n}",
    ],
    [
      "bash",
      { command: "ls src/service" },
      "Listing src/service",
      "admission.ts\ngraph.ts\nscheduler.ts",
    ],
    [
      "read",
      { path: "src/native-client.ts" },
      "Checking native-client.ts attach flow and polling",
      "export class NativeConnection {\n  …\n}",
    ],
  ];
const LABELS = [
  "Analyze cadence architecture",
  "Analyze pi-web-ui architecture",
];

export default function agentPanelDemo(pi: ExtensionAPI): void {
  let abort = new AbortController();
  pi.on("session_shutdown", () => abort.abort());
  pi.registerCommand("agents-demo", {
    description:
      "Demo: fake background agents for the agent panel (UI only, runs nothing)",
    handler: async (args, ctx) => {
      if (abort.signal.aborted) abort = new AbortController();
      const count = Math.min(20, Math.max(1, Number.parseInt(args, 10) || 2));
      const run = Date.now().toString(36);
      for (let n = 0; n < count; n++)
        void play(pi, `${run}-${n}`, n, abort.signal).catch(() => {});
      ctx.ui.notify(
        `Started ${count} fake background agents. With an empty input, press ↓ to manage them.`,
        "info",
      );
    },
  });
}

async function play(
  pi: ExtensionAPI,
  id: string,
  n: number,
  signal: AbortSignal,
): Promise<void> {
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal.addEventListener("abort", stop, { once: true });
    });
  const emit = (channel: string, data: object) =>
    pi.events.emit(`subagent:${channel}`, { id, ...data });
  const assistant = (text: string, extra: object[] = []) => ({
    role: "assistant",
    content: [{ type: "text", text }, ...extra],
    stopReason: extra.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  });
  const fails = n === 1;
  let tokensIn = 0,
    tokensOut = 0;
  emit("start", {
    label: LABELS[n] ?? `Survey module ${n + 1}`,
    kind: "Explore",
    startedAt: Date.now(),
  });
  emit("message", {
    message: {
      role: "user",
      content: `${LABELS[n] ?? `Survey module ${n + 1}`}: map entry points, ownership and data flow.`,
      timestamp: Date.now(),
    },
  });
  try {
    for (const [i, [tool, args, activity, output]] of STEPS.entries()) {
      await sleep(400 + n * 170);
      emit("activity", { activity });
      // Stream a short thought, then the tool call and its result.
      const thought = `${activity} to see how the pieces connect.`;
      for (let end = 12; end < thought.length; end += 18) {
        emit("message", {
          message: assistant(thought.slice(0, end)),
          streaming: true,
        });
        await sleep(220);
      }
      const call = {
        type: "toolCall",
        id: `${id}-t${i}`,
        name: tool,
        arguments: args,
      };
      emit("message", { message: assistant(thought, [call]) });
      tokensIn += 18_000 + n * 3_100 + i * 1_700;
      tokensOut += 420 + i * 60;
      emit("stats", { tokensIn, tokensOut });
      await sleep(600);
      emit("message", {
        message: {
          role: "toolResult",
          toolCallId: call.id,
          toolName: tool,
          content: [{ type: "text", text: output }],
          isError: false,
          timestamp: Date.now(),
        },
      });
      if (fails && i === 2) {
        emit("end", {
          status: "error",
          endedAt: Date.now(),
          error: "Provider rate limit (demo failure)",
        });
        return;
      }
    }
    emit("message", {
      message: assistant(
        "Summary: `src/index.ts` composes the shell; the service owns scheduling, history and checks.",
      ),
    });
    emit("end", { status: "done", endedAt: Date.now() });
  } catch {
    emit("end", { status: "cancelled", endedAt: Date.now() });
  }
}
