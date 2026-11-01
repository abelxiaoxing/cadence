/** Dev-only Pi extension, not shipped: `/agents-demo [count]` plays fake
 * background agents on Pi's shared bus for manual acceptance of the panel:
 * one batch (the second agent fails on purpose), then a review agent after
 * that batch collapsed into its card. It runs nothing. Load it beside Cadence:
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
      { path: "src/service/checkout-gate.ts" },
      "Inspecting checkout-gate.ts admission and overlap exclusion rules",
      "export class Scheduler {\n  …\n}",
    ],
    [
      "bash",
      { command: "ls src/service" },
      "Listing src/service",
      "workflows.ts\nowner.ts\ncheckout-gate.ts",
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
/** Longer than the panel's settle time, so the review gets its own card. */
const FOLLOW_UP_MS = 3000;

const wait = (ms: number, signal: AbortSignal) =>
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
      const { signal } = abort;
      // One batch, then a follow-up agent after it collapsed into its card.
      void Promise.all(
        Array.from({ length: count }, (_, n) =>
          play(pi, `${run}-${n}`, n, "Explore", signal),
        ),
      )
        .then(() => wait(FOLLOW_UP_MS, signal))
        .then(() => play(pi, `${run}-review`, count, "Review", signal))
        .catch(() => {});
      ctx.ui.notify(
        `Started ${count} fake background agents; a fake review agent follows once they finish. With an empty input, press ↓ to manage them.`,
        "info",
      );
    },
  });
}

async function play(
  pi: ExtensionAPI,
  id: string,
  n: number,
  kind: "Explore" | "Review",
  signal: AbortSignal,
): Promise<void> {
  const sleep = (ms: number) => wait(ms, signal);
  const emit = (channel: string, data: object) =>
    pi.events.emit(`subagent:${channel}`, { id, ...data });
  const assistant = (text: string, extra: object[] = []) => ({
    role: "assistant",
    content: [{ type: "text", text }, ...extra],
    stopReason: extra.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  });
  const fails = kind === "Explore" && n === 1;
  const label =
    kind === "Review"
      ? "Review the findings"
      : (LABELS[n] ?? `Survey module ${n + 1}`);
  let tokensIn = 0,
    tokensOut = 0;
  emit("start", { label, kind, startedAt: Date.now() });
  emit("message", {
    message: {
      role: "user",
      content: `${label}: map entry points, ownership and data flow.`,
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
