// Pure state and SSR only: no browser scrolling, pointer, focus or owner.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatStatus } from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import type { ModelAvailability } from "../../web/src/client/use-model-catalog";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import {
  type RuntimeActivity,
  RuntimeObservation,
  type RuntimeObservationProps,
  runtimeConnection,
  runtimeWorkflow,
} from "../../web/src/components/workspace/RuntimeObservation";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

const facts = vi.hoisted(() => ({
  reply: "running" as ChatStatus,
  workflow: undefined as WorkflowRun | undefined,
  error: "",
  cadence: false,
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
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
              runs: [],
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
