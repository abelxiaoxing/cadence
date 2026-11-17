/** Shared public-DTO contract, not a service or browser fixture. Both test
 * owners consume this exact sequence. Opaque version tokens name equality /
 * change expectations; the backend binds them to actual content versions. */
import type {
  ChatActivity,
  ChatItem,
  ChatStep,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";

export const timelineOrders = ["final-first", "marker-first"] as const;
export type TimelineOrder = (typeof timelineOrders)[number];
export interface TimelineIds {
  conversation: string;
  command: string;
  epoch: string;
  captureMessage: string;
  user: string;
  sourceLeaf: string;
  assistant: string;
  terminal: string;
  call: string;
}
export const timelineText = "Visible repeated body. ".repeat(8);
// This delta traverses two bounded redaction streams before finalization.
// It is a fixture expectation, not a rule for deriving identity from text.
export const timelinePreview = timelineText.slice(0, -128);
// Valid closed-DTO hashes used as opaque equality/change tokens, not expected
// digests. The root test requires distinct actual versions for distinct tokens.
export const timelineVersions = {
  question: "1".repeat(64),
  "text-preview": "2".repeat(64),
  "text-final": "3".repeat(64),
  empty: "4".repeat(64),
  "thinking-recorded": "5".repeat(64),
  "tool-arguments": "6".repeat(64),
  "first output": "7".repeat(64),
  "later output": "8".repeat(64),
  "final output": "9".repeat(64),
};
export const timelineCommand = "fixture-only";
export const timelineArgs = JSON.stringify({ command: timelineCommand });
export type TimelineAction =
  | "ready"
  | "text"
  | "thinking"
  | "final"
  | "write-pi"
  | "mark-pi"
  | "tool-start"
  | "silence"
  | "read-failure"
  | "read-recovery"
  | "tool-first"
  | "tool-later"
  | "tool-end"
  | "reply-end"
  | "reconnect"
  | "workflow-end";
type Phase =
  | "waiting"
  | "text"
  | "thinking"
  | "final-preview"
  | "durable"
  | "tool-running"
  | "tool-first"
  | "tool-later"
  | "tool-ended"
  | "reply-ended";
export interface TimelineCheckpoint {
  action: TimelineAction;
  phase: Phase;
  activity?: ChatActivity["kind"];
  failed?: true;
  workflow: "running" | "completed";
}

export function runtimeTimeline(order: TimelineOrder): TimelineCheckpoint[] {
  const live = (
    action: TimelineAction,
    phase: Phase,
    activity: ChatActivity["kind"],
  ): TimelineCheckpoint => ({ action, phase, activity, workflow: "running" });
  return [
    live("ready", "waiting", "waiting"),
    live("text", "text", "text"),
    live("thinking", "thinking", "thinking"),
    ...(order === "final-first"
      ? [live("final", "final-preview", "waiting")]
      : []),
    live(
      "write-pi",
      order === "final-first" ? "final-preview" : "thinking",
      order === "final-first" ? "waiting" : "thinking",
    ),
    live(
      "mark-pi",
      "durable",
      order === "final-first" ? "waiting" : "thinking",
    ),
    ...(order === "marker-first" ? [live("final", "durable", "waiting")] : []),
    live("tool-start", "tool-running", "tool"),
    live("silence", "tool-running", "tool"),
    { ...live("read-failure", "tool-running", "tool"), failed: true },
    live("read-recovery", "tool-running", "tool"),
    live("tool-first", "tool-first", "tool"),
    live("tool-later", "tool-later", "tool"),
    live("tool-end", "tool-ended", "waiting"),
    { action: "reply-end", phase: "reply-ended", workflow: "running" },
    { action: "reconnect", phase: "reply-ended", workflow: "running" },
    { action: "workflow-end", phase: "reply-ended", workflow: "completed" },
  ];
}

type Head = Extract<WorkbenchResult, { kind: "conversation" }>;
type Turn = Extract<WorkbenchResult, { kind: "conversation-turn" }>;
type Detail = Extract<WorkbenchResult, { kind: "conversation-step" }>;
export interface TimelineResults {
  head: Head;
  turn: Turn;
  tool?: Detail;
}

/** Complete controlled DTOs for the Web reader; the root test checks the actual
 * projection against these same fields. Timestamps, execution paths and activity
 * sequence numbers are observation-local; version tokens are opaque, not hashes
 * computed by a duplicate implementation of the service. */
export function timelineResults(
  ids: TimelineIds,
  point: TimelineCheckpoint,
): TimelineResults {
  const phase = point.phase;
  const ended = phase === "reply-ended";
  const durable = !["waiting", "text", "thinking", "final-preview"].includes(
    phase,
  );
  const full = durable || phase === "final-preview";
  const output =
    phase === "tool-first"
      ? "first output"
      : phase === "tool-later"
        ? "later output"
        : phase === "tool-ended" || ended
          ? "final output"
          : "";
  const toolState =
    phase === "tool-ended" || ended
      ? "completed"
      : ["tool-running", "tool-first", "tool-later"].includes(phase)
        ? "running"
        : "pending";
  const leaf = ended ? ids.terminal : null;
  const status = ended ? "completed" : "running";
  const blockId = (index: number) =>
    `${durable ? ids.assistant : ids.captureMessage}:${index}`;
  const renderId = (index: number) => `capture:${ids.captureMessage}:${index}`;
  const step = (
    fields: Pick<ChatStep, "id" | "renderId" | "role" | "version" | "state"> &
      Partial<ChatStep>,
  ): ChatStep => ({
    text: "",
    clipped: false,
    name: "",
    target: "",
    error: false,
    parts: 0,
    ...fields,
  });
  const steps: ChatStep[] = [
    step({
      id: ids.user,
      renderId: `command:${ids.command}:user`,
      role: "user",
      version: timelineVersions.question,
      state: "completed",
      text: "Question",
    }),
  ];
  if (phase !== "waiting")
    steps.push(
      step({
        id: blockId(0),
        renderId: renderId(0),
        role: "assistant",
        version: timelineVersions[full ? "text-final" : "text-preview"],
        state: full ? "completed" : "streaming",
        text: full ? timelineText : timelinePreview,
      }),
    );
  if (!["waiting", "text"].includes(phase))
    steps.push(
      step({
        id: blockId(1),
        renderId: renderId(1),
        role: "thinking",
        version: timelineVersions[durable ? "thinking-recorded" : "empty"],
        state: full ? "completed" : "streaming",
        parts: durable ? 1 : 0,
      }),
    );
  if (full)
    steps.push(
      step({
        id: durable ? ids.call : blockId(2),
        renderId: renderId(2),
        role: "tool",
        version: timelineVersions[output || "tool-arguments"],
        state: toolState,
        name: "bash",
        target: timelineCommand,
        parts: 1,
      }),
      step({
        id: blockId(3),
        renderId: renderId(3),
        role: "assistant",
        version: timelineVersions["text-final"],
        state: "completed",
        text: timelineText,
      }),
    );
  const head: Head = {
    kind: "conversation",
    summary: {
      id: ids.conversation,
      title: "Question",
      leaf: ids.sourceLeaf,
      status,
      updatedAt: 0,
      origin: "terminal",
      ...(!ended ? { live: { commandId: ids.command, epoch: ids.epoch } } : {}),
    },
    leaf,
    continues: true,
    turns: 1,
    branches: 1,
    runs: [],
    attempt: null,
    commands: [ids.command],
  };
  const turn: Turn = {
    kind: "conversation-turn",
    conversationId: ids.conversation,
    leaf,
    ordinal: 0,
    start: 0,
    turn: {
      id: ids.user,
      status,
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      steps: steps.length,
      stable: phase === "tool-ended" || ended ? 5 : durable ? 3 : 1,
      entry: leaf,
      parent: null,
      at: 1,
      ...(point.activity
        ? {
            activity: {
              kind: point.activity,
              sequence: 0,
              ...(point.activity === "tool" ? { name: "bash" } : {}),
            },
          }
        : {}),
    },
    steps,
  };
  const tool = steps.find((s) => s.renderId === renderId(2));
  return {
    head,
    turn,
    ...(tool
      ? {
          tool: {
            kind: "conversation-step",
            conversationId: ids.conversation,
            leaf,
            turnId: ids.user,
            step: 3,
            part: 0,
            item: {
              id: tool.id,
              renderId: tool.renderId,
              version: tool.version,
              state: tool.state,
              role: "tool",
              text: output,
              args: timelineArgs,
              name: "bash",
              error: false,
            } satisfies ChatItem,
          } satisfies Detail,
        }
      : {}),
  };
}
