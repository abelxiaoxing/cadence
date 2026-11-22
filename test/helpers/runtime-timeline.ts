/** Shared public-DTO contract, not a service or browser fixture. Both test
 * owners consume this exact sequence. Opaque version tokens name equality /
 * change expectations; the backend binds them to actual content versions. */

import type {
  ChatActivity,
  ChatItem,
  ChatStep,
  WorkbenchRead,
  WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import { STEP_READ } from "../../src/service/contracts/workbench.ts";

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
      ...(!ended
        ? { live: { commandId: ids.command, epoch: ids.epoch, startedAt: 1 } }
        : {}),
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

/** Independent executions have no unique declaration. The call UUID, not the
 * result message UUID, source call ID, body or row position, owns their key. */
export const independentCases = ["undeclared", "ambiguous"] as const;
export type IndependentCase = (typeof independentCases)[number];
export const independentTerminals = [
  "completed",
  "failed",
  "canceled",
] as const;
export const independentScenarios = independentCases.flatMap((kind) =>
  timelineOrders.flatMap((order) =>
    independentTerminals.map((terminal) => ({ kind, order, terminal })),
  ),
);
export interface IndependentIds extends TimelineIds {
  execution: string;
  repeatExecution: string;
  history: { user: string; assistant: string }[];
}
export type IndependentAction =
  | "declared"
  | "tool-start"
  | "tool-first"
  | "tool-later"
  | "tool-end"
  | "result-final"
  | "result-write"
  | "result-mark"
  | "repeat-result"
  | "reply-end"
  | "reconnect";
export interface IndependentCheckpoint {
  action: IndependentAction;
  output: "" | "first output" | "later output" | "final output";
  executed: boolean;
  ended: boolean;
  durable: boolean;
  repeated: boolean;
  settled: boolean;
  status: (typeof independentTerminals)[number];
}
export function independentTimeline(
  order: TimelineOrder,
  status: IndependentCheckpoint["status"] = "completed",
): IndependentCheckpoint[] {
  let state = {
    output: "" as IndependentCheckpoint["output"],
    executed: false,
    ended: false,
    durable: false,
    repeated: false,
    settled: false,
  };
  const point = (
    action: IndependentAction,
    update: Partial<typeof state> = {},
  ): IndependentCheckpoint => {
    state = { ...state, ...update };
    return { action, ...state, status };
  };
  return [
    point("declared"),
    point("tool-start", { executed: true }),
    point("tool-first", { output: "first output" }),
    point("tool-later", { output: "later output" }),
    point("tool-end", { output: "final output", ended: true }),
    ...(order === "final-first" ? [point("result-final")] : []),
    point("result-write"),
    point("result-mark", { durable: true }),
    ...(order === "marker-first" ? [point("result-final")] : []),
    point("repeat-result", { repeated: true }),
    point("reply-end", { settled: true }),
    point("reconnect"),
  ];
}
const independentVersions = {
  "": "a".repeat(64), // Empty output, {} execution/declaration arguments.
  "first output": "b".repeat(64),
  "later output": "c".repeat(64),
  "final output": "d".repeat(64),
  recorded: "e".repeat(64), // Pi has result text, but no invented execution arguments.
};
export interface IndependentResults {
  head: Head;
  turn: Turn;
  history: Turn[];
  tools: Detail[];
}

/** Like timelineResults, these are public expectations shared with a genuine
 * backend projection test, not keys invented solely for a frontend fixture. */
export function independentResults(
  ids: IndependentIds,
  kind: IndependentCase,
  point: IndependentCheckpoint,
): IndependentResults {
  const leaf = point.settled
    ? ids.terminal
    : (ids.history.at(-1)?.assistant ?? null);
  const step = (
    fields: Partial<ChatStep> & Pick<ChatStep, "id" | "renderId" | "role">,
  ): ChatStep => ({
    text: "",
    clipped: false,
    name: "",
    target: "",
    error: false,
    parts: 0,
    state: "completed",
    version: timelineVersions["text-final"],
    ...fields,
  });
  const declarationCount = kind === "ambiguous" ? 2 : 0;
  const steps = [
    step({
      id: ids.user,
      renderId: `command:${ids.command}:user`,
      role: "user",
      text: "Question",
      version: timelineVersions.question,
    }),
  ];
  const text = (index: number) =>
    step({
      id: `${ids.assistant}:${index}`,
      renderId: `capture:${ids.captureMessage}:${index}`,
      role: "assistant",
      text: timelineText,
    });
  steps.push(text(0));
  for (let index = 1; index <= declarationCount; index++)
    steps.push(
      step({
        id: ids.call,
        renderId: `capture:${ids.captureMessage}:${index}`,
        role: "tool",
        name: "read",
        parts: 1,
        state: point.settled
          ? point.status === "canceled"
            ? "canceled"
            : "unavailable"
          : "pending",
        version: independentVersions[""],
      }),
    );
  steps.push(text(declarationCount + 1));
  if (point.executed)
    steps.push(
      step({
        id: point.durable ? ids.call : ids.execution,
        renderId: `call:${ids.execution}`,
        role: "tool",
        name: "read",
        parts: 1,
        state: point.ended ? "completed" : "running",
        version: independentVersions[point.durable ? "recorded" : point.output],
      }),
    );
  if (point.repeated)
    steps.push(
      step({
        id: "repeat-call",
        renderId: `call:${ids.repeatExecution}`,
        role: "tool",
        name: "read",
        parts: 1,
        version: independentVersions.recorded,
      }),
    );
  const turn: Turn = {
    kind: "conversation-turn",
    conversationId: ids.conversation,
    leaf,
    ordinal: ids.history.length,
    start: 0,
    turn: {
      id: ids.user,
      status: point.settled ? point.status : "running",
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      steps: steps.length,
      stable: point.settled
        ? steps.length
        : declarationCount
          ? 2
          : point.durable
            ? steps.length
            : 3,
      entry: point.settled ? leaf : null,
      parent: ids.history.at(-1)?.assistant ?? null,
      at: 1,
    },
    steps,
  };
  const history: Turn[] = ids.history.map((entry, ordinal) => ({
    ...turn,
    ordinal,
    turn: {
      ...turn.turn,
      id: entry.user,
      status: "completed",
      steps: 2,
      stable: 2,
      entry: entry.assistant,
      parent: ids.history[ordinal - 1]?.assistant ?? null,
    },
    steps: [
      step({
        id: entry.user,
        renderId: `pi:${entry.user}:0`,
        role: "user",
        text: "Question",
        version: timelineVersions.question,
      }),
      step({
        id: `${entry.assistant}:0`,
        renderId: `pi:${entry.assistant}:0`,
        role: "assistant",
        text: timelineText,
      }),
    ],
  }));
  return {
    head: {
      kind: "conversation",
      summary: {
        id: ids.conversation,
        title: "Question",
        leaf: ids.sourceLeaf,
        status: turn.turn.status,
        updatedAt: 0,
        origin: "terminal",
        ...(!point.settled
          ? { live: { commandId: ids.command, epoch: ids.epoch, startedAt: 1 } }
          : {}),
      },
      leaf,
      continues: true,
      turns: history.length + 1,
      branches: 1,
      runs: [],
      attempt: null,
      commands: [ids.command],
    },
    turn,
    history,
    tools: steps.flatMap((s, index) =>
      s.role === "tool"
        ? [
            {
              kind: "conversation-step" as const,
              conversationId: ids.conversation,
              leaf,
              turnId: ids.user,
              step: index,
              part: 0,
              item: {
                id: s.id,
                renderId: s.renderId,
                version: s.version,
                state: s.state,
                role: "tool" as const,
                name: s.name,
                error: false,
                text:
                  s.renderId === `call:${ids.execution}`
                    ? point.output
                    : s.renderId === `call:${ids.repeatExecution}`
                      ? "final output"
                      : "",
                args:
                  s.renderId?.startsWith("call:") && point.durable ? "" : "{}",
              },
            },
          ]
        : [],
    ),
  };
}

/** Web-side fixture coordinates; backend IDs instead come from actual frames
 * and appended Pi entries. No expected key is learned from the read under test. */
export function independentFixtureIds(): IndependentIds {
  const entry = () => crypto.randomUUID().slice(0, 8);
  return {
    conversation: crypto.randomUUID(),
    command: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    captureMessage: crypto.randomUUID(),
    execution: crypto.randomUUID(),
    repeatExecution: crypto.randomUUID(),
    user: entry(),
    assistant: entry(),
    terminal: entry(),
    sourceLeaf: entry(),
    call: "call",
    history: Array.from({ length: 3 }, () => ({
      user: entry(),
      assistant: entry(),
    })),
  };
}
/** Only public reads needed by these timeline consumers, including actual step
 * ranges. This transport does not implement a reader, identity reconciliation,
 * stateful details or a backend projection. */
export function independentRead(
  snapshot: IndependentResults,
  request: WorkbenchRead,
): WorkbenchResult {
  if (!("id" in request) || request.id !== snapshot.head.summary?.id)
    throw Error("unexpected conversation");
  if (request.kind === "conversation") return snapshot.head;
  if (request.kind === "conversation-turn") {
    const turn =
      request.ordinal === snapshot.turn.ordinal
        ? snapshot.turn
        : snapshot.history[request.ordinal];
    if (!turn || request.leaf !== turn.leaf)
      throw Error("unexpected turn coordinates");
    const end = request.before ?? turn.steps.length;
    const start = Math.max(0, end - STEP_READ);
    return { ...turn, start, steps: turn.steps.slice(start, end) };
  }
  if (request.kind === "conversation-step") {
    const detail = snapshot.tools.find((tool) => tool.step === request.step);
    if (
      !detail ||
      request.leaf !== detail.leaf ||
      request.turnId !== detail.turnId ||
      request.part !== detail.part
    )
      throw Error("unexpected detail coordinates");
    return detail;
  }
  throw Error("unexpected read");
}
