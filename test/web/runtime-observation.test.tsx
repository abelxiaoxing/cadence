// Public DTO contract -> real ConversationReader -> workspace SSR; no backend or browser.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  type ChatStatus,
  decodeWorkbenchResult,
  type WorkbenchRead,
} from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  ConversationReader,
  type ConversationView,
} from "../../web/src/client/conversation-reader";
import type { ModelAvailability } from "../../web/src/client/use-model-catalog";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import {
  type RuntimeActivity,
  RuntimeObservation,
  type RuntimeObservationProps,
  runtimeActivity,
  runtimeConnection,
  runtimeWorkflow,
} from "../../web/src/components/workspace/RuntimeObservation";
import { LocaleProvider } from "../../web/src/i18n/locale";
import {
  runtimeTimeline,
  type TimelineCheckpoint,
  type TimelineIds,
  timelineOrders,
  timelineResults,
  timelineText,
} from "../helpers/runtime-timeline.ts";
import { transport } from "./fixtures";

const facts = vi.hoisted(() => ({
  reply: "running" as ChatStatus,
  workflow: undefined as WorkflowRun | undefined,
  error: "",
  cadence: false,
  view: undefined as ConversationView | undefined,
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    ...(facts.view ?? {
      summary: {
        id: "chat",
        title: "Conversation",
        leaf: null,
        status: facts.reply,
        updatedAt: 100,
        origin: "webui",
        ...(facts.reply === "running"
          ? { live: { commandId: "turn", epoch: "epoch" } }
          : {}),
      },
      leaf: null,
      turns: [],
      commands: [],
      pending: [],
      undelivered: [],
      runs: facts.workflow ? [facts.workflow.id] : [],
      count: 0,
      branches: 1,
      pinned: false,
      earlier: false,
      error: facts.error,
    }),
    refresh() {},
    choose() {},
    loadEarlier() {},
  }),
}));
vi.mock("../../web/src/client/use-workbench", async (original) => ({
  ...(await original<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_client: unknown, request: { kind: string } | null) => ({
    refresh() {},
    value:
      request?.kind === "conversation-context"
        ? {
            kind: request.kind,
            context: { id: "chat", cwd: "/project", revision: 0, model: null },
          }
        : {
            kind: "cadence-conversation",
            state: {
              id: "chat",
              revision: 0,
              enabled: facts.cadence,
              runs: facts.workflow ? [facts.workflow.id] : [],
              proposal: null,
              head: null,
            },
          },
  }),
}));
vi.mock("../../web/src/components/workspace/AgentDock", () => ({
  useWorkflowRuns: () => ({
    runs: new Map(facts.workflow ? [[facts.workflow.id, facts.workflow]] : []),
    failed: !!facts.error,
    unreadable: new Set(),
  }),
}));
afterEach(() => {
  facts.reply = "running";
  facts.workflow = undefined;
  facts.error = "";
  facts.cadence = false;
  facts.view = undefined;
  vi.useRealTimers();
});

const workflow = (changes: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "workflow",
  epoch: "epoch",
  goal: "Recorded goal",
  status: "running",
  phase: "implementing",
  steps: [],
  notice: "",
  mergedCommit: null,
  humanReviewed: false,
  ...changes,
});
const render = (
  props: Partial<RuntimeObservationProps> = {},
  locale: "en" | "zh" = "en",
) =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <RuntimeObservation connection="observing" {...props} />
    </LocaleProvider>,
  );

it("observes connection/read facts without treating absent progress as loss or completion", () => {
  const facts = {
    available: true,
    status: "ready" as const,
    observed: true,
    readFailed: false,
  };
  expect(runtimeConnection(facts)).toBe("observing");
  expect(runtimeConnection({ ...facts, observed: false })).toBe("connecting");
  for (const status of ["connecting", "preparing"] as const)
    expect(runtimeConnection({ ...facts, status })).toBe("connecting");
  for (const status of ["stopped", "not-started"] as const)
    expect(runtimeConnection({ ...facts, status })).toBe("history");
  expect(runtimeConnection({ ...facts, status: "unavailable" })).toBe("stale");
  expect(runtimeConnection({ ...facts, readFailed: true })).toBe("stale");
  expect(runtimeConnection({ ...facts, available: false })).toBe("paused");
});

it("keeps the exact named workflow through a pause, failed read and recovery without borrowing a different run's state", () => {
  const running = workflow();
  let observed = runtimeWorkflow(
    [running.id],
    new Map([[running.id, running]]),
  );
  expect(observed).toBe(running);
  // A pause clears the read hook's map. Retain the original fact, not completion.
  observed = runtimeWorkflow([running.id], new Map(), observed);
  expect(observed).toBe(running);
  expect(render({ workflow: observed, connection: "paused" })).toContain(
    "Last observed",
  );
  // A failed reconnect still has no newer fact.
  expect(runtimeWorkflow([running.id], new Map(), observed)).toBe(running);
  const settled = workflow({ status: "completed", phase: "finished" });
  observed = runtimeWorkflow(
    [running.id],
    new Map([[settled.id, settled]]),
    observed,
  );
  expect(observed).toBe(settled);
  const next = workflow({ id: "other-run" }); // identical goal, different identity
  expect(runtimeWorkflow([next.id], new Map(), observed)).toBeUndefined();
  expect(runtimeWorkflow([next.id], new Map([[next.id, next]]), observed)).toBe(
    next,
  );
  expect(runtimeWorkflow([], new Map([[next.id, next]]), next)).toBeUndefined();
});

it.each(["en", "zh"] as const)(
  "%s: a reply and workflow remain independently visible during long silent work",
  (locale) => {
    const html = render({ reply: "running", workflow: workflow() }, locale);
    expect(html).toContain(locale === "zh" ? "回复进行中" : "Reply running");
    expect(html).toContain(
      locale === "zh"
        ? "等待中 · 暂未观察到新进展"
        : "Waiting · no new progress observed",
    );
    expect(html).toContain(
      locale === "zh" ? "工作流: 实施中" : "Workflow: implementing",
    );
    expect(html).toContain(
      locale === "zh" ? "正在观察当前状态" : "Observing current state",
    );
    expect(html).not.toMatch(
      /progressbar|aria-valuenow|ETA|stuck|stalled|success|%/,
    );
    expect(html).toContain(
      'role="status" aria-live="polite" aria-atomic="true"',
    );
    expect(html).not.toMatch(/<button|<details|<dialog|tabindex|aria-busy/);
  },
);

it("reply end, tool result and workflow end never settle each other", () => {
  const endedReply = render({
    reply: "completed",
    workflow: workflow(),
    activity: { kind: "output" },
  });
  expect(endedReply).toContain("Reply ended");
  expect(endedReply).toContain("Workflow: implementing");
  expect(endedReply).not.toContain("Reply output observed");
  const endedWorkflow = render({
    reply: "running",
    workflow: workflow({ status: "completed", phase: "finished" }),
  });
  expect(endedWorkflow).toContain("Reply running");
  expect(endedWorkflow).toContain("Workflow: completed");
  expect(endedWorkflow).not.toContain("Reply ended");
  const toolResult = render({
    reply: "running",
    workflow: workflow(),
    activity: { kind: "tool", name: "bash", state: "completed" },
  });
  expect(toolResult).toContain("Tool result observed");
  expect(toolResult).toContain("Reply running");
  expect(toolResult).toContain("Workflow: implementing");
  expect(toolResult).not.toContain("Reply ended");
  // Even a phase named finished is not the run's terminal state.
  expect(render({ workflow: workflow({ phase: "finished" }) })).toContain(
    "Workflow: running",
  );
  expect(render({ workflow: workflow({ status: "queued" }) })).toContain(
    "Workflow: queued",
  );
});

it.each(["failed", "canceled", "timeout", "unknown"] as const)(
  "%s is stated separately for the reply and workflow without a lingering live activity",
  (status) => {
    const html = render({
      reply: status,
      workflow: workflow({ status }),
      activity: { kind: "thinking", state: "active" },
    });
    const reply = {
      failed: "Reply failed",
      canceled: "Reply canceled",
      timeout: "Reply timed out",
      unknown: "Reply outcome unknown",
    }[status];
    expect(html).toContain(reply);
    expect(html).toContain(`Workflow: ${status}`);
    expect(html).not.toContain("Thinking activity observed");
  },
);

it.each(["stale", "paused"] as const)(
  "%s preserves the last observed running facts, explicitly marked, without inventing an end",
  (connection) => {
    const html = render({
      reply: "running",
      workflow: workflow(),
      connection,
      activity: { kind: "tool", name: "read", state: "running" },
    });
    expect(html).toContain("Reply running");
    expect(html).toContain("Workflow: implementing");
    expect(html).toContain("Tool running");
    expect(html.match(/Last observed/g)).toHaveLength(2);
    expect(html).toContain("showing last known state");
    expect(html).not.toMatch(
      /Reply ended|Workflow: completed|Reply failed|Tool failure/,
    );
  },
);

it("a missing workflow or unread reply never becomes a completed/idle one", () => {
  const pending = render({ workflow: null, connection: "connecting" });
  expect(pending).toContain("Awaiting workflow observation");
  expect(pending).toContain("Waiting for current observations");
  expect(pending).not.toContain('data-runtime="reply"');
  expect(pending).not.toContain("completed");
  expect(render()).not.toContain('data-runtime="workflow"');
  expect(render({ reply: "queued" })).toContain("Reply queued");
  expect(render({ reply: "queued" })).not.toContain("Thinking");
  for (const connection of ["stale", "paused"] as const) {
    const absent = render({ workflow: null, connection });
    expect(absent).not.toContain("Last observed");
    expect(absent).not.toContain("showing last known state");
    expect(absent).toContain(
      connection === "stale" ? "Observation unavailable" : "Observation paused",
    );
  }
});

it.each(["en", "zh"] as const)(
  "%s: the activity seam takes only observed kinds and never exposes thinking text or details",
  (locale) => {
    const activities: [RuntimeActivity, string, string][] = [
      [
        { kind: "thinking", state: "active" },
        "Thinking activity observed",
        "已观察到思考活动",
      ],
      [
        { kind: "thinking", state: "ended" },
        "Thinking activity ended",
        "思考活动已结束",
      ],
      [
        { kind: "thinking", state: "unavailable" },
        "Thinking content unavailable",
        "思考内容不可用",
      ],
      [{ kind: "output" }, "Reply output observed", "已观察到回复输出"],
      [
        { kind: "tool", name: "bash", state: "running" },
        "Tool running",
        "工具执行中",
      ],
      [
        { kind: "tool", name: "bash", state: "failed" },
        "Tool failure observed",
        "已观察到工具失败",
      ],
      [
        { kind: "tool", name: "bash", state: "canceled" },
        "Tool cancellation observed",
        "已观察到工具取消",
      ],
      [
        { kind: "tool", name: "bash", state: "unknown" },
        "Tool outcome unknown",
        "工具结果未知",
      ],
    ];
    for (const [activity, en, zh] of activities) {
      // Extra runtime data is not rendered either; the interface carries no body.
      const value = {
        ...activity,
        text: "PRIVATE_BODY",
        signature: "PRIVATE_SIGNATURE",
        args: "PRIVATE_ARGS",
      };
      const html = render({ reply: "running", activity: value }, locale);
      expect(html).toContain(locale === "zh" ? zh : en);
      expect(html).not.toMatch(/PRIVATE_|aria-expanded|<button|<details/);
    }
  },
);

it("long tool names are escaped plain text with a full title, not markup or an instruction", () => {
  const name = `<tool>${"very-long-name-".repeat(100)}`;
  const html = render({
    reply: "running",
    activity: { kind: "tool", name, state: "running" },
  });
  expect(html).toContain(
    'class="runtime-observation-name" title="&lt;tool&gt;',
  );
  expect(html).not.toContain("<tool>");
  expect(html).toContain("Tool running");
});

function renderWorkspace(
  availability: ModelAvailability = {
    status: "ready",
    epoch: "epoch",
    attachmentVersion: 1,
  },
) {
  const api = new ServiceClient(transport());
  const read = vi.spyOn(api, "workbenchRead");
  const command = vi.spyOn(api, "workbenchCommand");
  const html = renderToStaticMarkup(
    <ChatWorkspace
      client={api}
      id="chat"
      workspaceId="workspace"
      initialCwd="/project"
      enabled
      modelAvailability={availability}
      onModelChanged={() => {}}
      onChanged={() => {}}
      onReferenceUsed={() => {}}
    />,
  );
  expect(read).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
  return html;
}

it.each([false, true])(
  "workspace SSR: reply feedback is never hidden by a workflow (Cadence %s), and input/Stop stay accessible",
  (cadence) => {
    facts.cadence = cadence;
    facts.workflow = workflow();
    const html = renderWorkspace();
    const observation = html.indexOf('class="runtime-observation"');
    const composer = html.indexOf('class="chat-composer"');
    const messages = html.indexOf('class="chat-messages-wrap"');
    expect(messages).toBeGreaterThan(-1);
    expect(observation).toBeGreaterThan(messages);
    expect(composer).toBeGreaterThan(observation);
    // All transcript divs have closed before the observation sibling opens.
    const transcript = html.slice(messages, observation);
    expect(transcript.match(/<div\b/g)?.length).toBe(
      transcript.match(/<\/div>/g)?.length,
    );
    const bar = html.slice(observation, composer);
    expect(bar).toContain("Reply running");
    expect(bar).toContain("Workflow: implementing");
    expect(bar).toContain("Waiting · no new progress observed");
    expect(html).toMatch(/<textarea\b[^>]*aria-label="Message"/);
    expect(html).not.toMatch(/<textarea\b[^>]*(?:disabled|readonly)/);
    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toMatch(/<[^>]+(?:inert=|aria-modal=)/);
  },
);

it("workspace SSR: a stale observation retains both facts and does not disable draft editing", () => {
  facts.workflow = workflow();
  facts.error = "unavailable";
  const html = renderWorkspace({ status: "unavailable" });
  expect(html).toContain("Observation delayed · showing last known state");
  expect(html).toContain("Reply running");
  expect(html).toContain("Workflow: implementing");
  expect(html).not.toMatch(/<textarea\b[^>]*(?:disabled|readonly)/);
});

/** Controlled workbenchRead consumes the same DTO expectations that the root
 * runtime-timeline test checks against real capture/Pi projections. No direct
 * component-state fixture substitutes for the ConversationReader here. */
function timelineFixture() {
  const ids: TimelineIds = {
    conversation: crypto.randomUUID(),
    command: crypto.randomUUID(),
    epoch: crypto.randomUUID(),
    captureMessage: crypto.randomUUID(),
    user: "00000001",
    sourceLeaf: "00000002",
    assistant: "00000003",
    terminal: "00000006",
    call: "call",
  };
  let point = runtimeTimeline("final-first")[0];
  const workbenchRead = vi.fn(async (request: WorkbenchRead) => {
    if (point.failed) throw Error("controlled disconnected read");
    const expected = timelineResults(ids, point);
    expect("id" in request && request.id).toBe(ids.conversation);
    if (request.kind === "conversation")
      return {
        kind: "ok" as const,
        value: decodeWorkbenchResult(expected.head),
      };
    if (request.kind === "conversation-turn") {
      expect(request).toMatchObject({
        leaf: expected.head.leaf,
        ordinal: 0,
        before: null,
      });
      return {
        kind: "ok" as const,
        value: decodeWorkbenchResult(expected.turn),
      };
    }
    if (request.kind === "conversation-step" && expected.tool) {
      expect(request).toMatchObject({
        leaf: expected.head.leaf,
        turnId: ids.user,
        step: expected.tool.step,
        part: 0,
      });
      return {
        kind: "ok" as const,
        value: decodeWorkbenchResult(expected.tool),
      };
    }
    throw Error("unexpected read (thinking must stay folded)");
  });
  const reader = new ConversationReader(
    { workbenchRead },
    ids.conversation,
    () => {},
  );
  return {
    ids,
    reader,
    workbenchRead,
    async observe(next: TimelineCheckpoint) {
      point = next;
      if (point.action === "write-pi") ids.sourceLeaf = ids.assistant;
      if (point.action === "mark-pi") ids.sourceLeaf = "00000004";
      if (point.action === "tool-end") ids.sourceLeaf = ids.terminal;
      if (point.action === "reconnect") reader.setActive(false);
      reader.setActive(true);
      if (point.action === "silence") await vi.advanceTimersByTimeAsync(30_000);
      reader.refresh();
      await vi.advanceTimersByTimeAsync(0);
      facts.view = reader.view();
      const turn = facts.view.turns.at(-1);
      if (!turn) throw Error("turn not read");
      return turn;
    },
  };
}

it.each(timelineOrders)(
  "DTO-connected %s: reader and workspace preserve activity, ordered bodies, silence, reconnect and independent outcomes",
  async (order) => {
    vi.useFakeTimers();
    const f = timelineFixture();
    let prior:
      | ReturnType<ConversationReader["view"]>["turns"][number]
      | undefined;
    let preview: typeof prior;
    let durable: typeof prior;
    let terminal: typeof prior;
    const versions: string[] = [];
    try {
      for (const point of runtimeTimeline(order)) {
        facts.workflow = workflow(
          point.workflow === "completed"
            ? { status: "completed", phase: "finished" }
            : {},
        );
        const turn = await f.observe(point);
        const expected = timelineResults(f.ids, point);
        expect(turn.steps).toEqual(expected.turn.steps);
        expect(turn.header).toEqual(expected.turn.turn);
        expect(turn.renderId).toBe(`command:${f.ids.command}:user`);
        const html = renderWorkspace();
        expect(html).not.toMatch(
          /PRIVATE_THINKING|PRIVATE_SIGNATURE|thinking-body/,
        );
        // SSR never fetches closed details, including durable readable thinking.
        expect(
          f.workbenchRead.mock.calls.filter(
            ([r]) => r.kind === "conversation-step",
          ),
        ).toHaveLength(versions.length);
        switch (point.action) {
          case "ready":
            expect(runtimeActivity(turn.header)).toEqual({ kind: "waiting" });
            expect(html).toContain("Waiting · no new progress observed");
            break;
          case "text":
            expect(html).toContain("Reply output observed");
            break;
          case "thinking":
            preview = turn;
            expect(html).toContain("Thinking activity observed");
            expect(turn.steps[2]).toMatchObject({ parts: 0, text: "" });
            break;
          case "write-pi":
            expect(turn.steps).toEqual(prior?.steps);
            break;
          case "mark-pi":
            durable = turn;
            expect(turn.steps.map((s) => s.role)).toEqual([
              "user",
              "assistant",
              "thinking",
              "tool",
              "assistant",
            ]);
            expect(turn.steps.slice(1).map((s) => s.renderId)).toEqual(
              [0, 1, 2, 3].map((n) => `capture:${f.ids.captureMessage}:${n}`),
            );
            expect(turn.renderId).toBe(preview?.renderId);
            expect(turn.steps[1].renderId).toBe(preview?.steps[1].renderId);
            expect(turn.steps[2]).toMatchObject({
              text: "",
              parts: 1,
              state: "completed",
            });
            expect(
              turn.steps
                .filter((s) => s.role === "assistant")
                .map((s) => s.text),
            ).toEqual([timelineText, timelineText]);
            expect(html).toMatch(
              /<div class="chead thinking-head"><button[^>]*aria-expanded="false"/,
            );
            expect(html).toContain('title="Show thinking"');
            break;
          case "final":
            if (order === "marker-first")
              expect(turn.steps).toEqual(durable?.steps);
            break;
          case "tool-start":
            expect(html).toContain("Tool running");
            break;
          case "silence":
            expect(runtimeActivity(turn.header)).toEqual({
              kind: "tool",
              name: "bash",
              state: "running",
            });
            expect(html).toContain("Reply running");
            expect(turn.steps).toEqual(prior?.steps);
            break;
          case "read-failure":
            expect(facts.view?.error).toBe("unavailable");
            expect(html).toContain(
              "Observation delayed · showing last known state",
            );
            expect(turn.steps).toEqual(prior?.steps);
            break;
          case "read-recovery":
            expect(facts.view?.error).toBe("");
            expect(turn.steps).toEqual(prior?.steps);
            break;
          case "tool-first":
          case "tool-later":
          case "tool-end": {
            expect(turn.steps[3].parts).toBe(durable?.steps[3].parts);
            const version = turn.steps[3].version;
            if (!version) throw Error("missing content version");
            versions.push(version);
            expect(
              await turn.detail(
                3,
                turn.steps[3].parts,
                new AbortController().signal,
              ),
            ).toEqual({
              text: expected.tool?.item.text,
              args: expected.tool?.item.args,
            });
            if (point.action === "tool-end") {
              expect(turn.steps[3].state).toBe("completed");
              expect(html).toContain("Waiting · no new progress observed");
              expect(html).toContain("Reply running");
              expect(html).toContain("Workflow: implementing");
            }
            break;
          }
          case "reply-end":
            terminal = turn;
            expect(turn.steps.map((s) => s.renderId)).toEqual(
              durable?.steps.map((s) => s.renderId),
            );
            expect(html).toContain("Reply ended");
            expect(html).toContain("Workflow: implementing");
            expect(html).not.toContain("Tool running");
            break;
          case "reconnect":
            expect(turn.steps).toEqual(terminal?.steps);
            expect(
              runtimeActivity({
                ...turn.header,
                status: "running",
                activity: undefined,
              }),
            ).toEqual({ kind: "waiting" });
            break;
          case "workflow-end":
            expect(turn.steps).toEqual(terminal?.steps);
            expect(html).toContain("Reply ended");
            expect(html).toContain("Workflow: completed");
            break;
        }
        prior = turn;
      }
      expect(versions).toHaveLength(3);
      expect(new Set(versions).size).toBe(3);
      expect(
        f.workbenchRead.mock.calls.some(
          ([r]) => r.kind === "conversation-turn",
        ),
      ).toBe(true);
    } finally {
      f.reader.close();
    }
  },
);
