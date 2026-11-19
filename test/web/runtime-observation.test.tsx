// Public DTO contract -> real ConversationReader -> workspace SSR; no backend or browser.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  decodeWorkbenchResult,
  type WorkbenchRead,
} from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  ConversationReader,
  type ConversationView,
} from "../../web/src/client/conversation-reader";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
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
  cadence: false,
  view: undefined as ConversationView | undefined,
  workflow: {
    id: "workflow",
    epoch: "epoch",
    goal: "Recorded goal",
    status: "running",
    phase: "implementing",
    steps: [],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  } as WorkflowRun,
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    ...facts.view,
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
              runs: [facts.workflow.id],
              proposal: null,
              head: null,
            },
          },
  }),
}));
vi.mock("../../web/src/client/use-workflow-runs", () => ({
  useWorkflowRuns: () => ({
    runs: new Map([[facts.workflow.id, facts.workflow]]),
    failed: false,
    unreadable: new Set(),
  }),
}));
afterEach(() => {
  facts.view = undefined;
  vi.useRealTimers();
});

function renderWorkspace() {
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
      modelAvailability={{
        status: "ready",
        epoch: "epoch",
        attachmentVersion: 1,
      }}
      onModelChanged={() => {}}
      onChanged={() => {}}
      onReferenceUsed={() => {}}
    />,
  );
  expect(read).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
  return html;
}

/** The root runtime-timeline test checks these same DTO expectations against
 * real capture/Pi projections. SSR receives the reader's view of those DTOs. */
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
  "DTO-connected %s: observations stay in the transcript, not in a strip above the composer",
  async (order) => {
    vi.useFakeTimers();
    facts.cadence = order === "marker-first";
    const f = timelineFixture();
    let prior: ConversationView["turns"][number] | undefined;
    let preview: typeof prior;
    let durable: typeof prior;
    let terminal: typeof prior;
    const versions: string[] = [];
    try {
      for (const point of runtimeTimeline(order)) {
        facts.workflow.status = point.workflow;
        facts.workflow.phase =
          point.workflow === "completed" ? "finished" : "implementing";
        const turn = await f.observe(point);
        const expected = timelineResults(f.ids, point);
        expect(turn.steps).toEqual(expected.turn.steps);
        expect(turn.header).toEqual(expected.turn.turn);
        expect(turn.renderId).toBe(`command:${f.ids.command}:user`);
        const html = renderWorkspace();
        expect(html).not.toMatch(
          /runtime-observation|Observing current state|Waiting · no new progress observed/,
        );
        expect(html).not.toMatch(
          /PRIVATE_THINKING|PRIVATE_SIGNATURE|thinking-body/,
        );
        expect(html).toMatch(/<textarea\b[^>]*aria-label="Message"/);
        expect(html).not.toMatch(/<textarea\b[^>]*(?:disabled|readonly)/);
        expect(html).toContain(`class="workflow-line ${point.workflow}"`);
        if (turn.header.status === "running")
          expect(html).toContain('aria-label="Stop response"');
        else expect(html).not.toContain('aria-label="Stop response"');
        // SSR never fetches closed details, including durable readable thinking.
        expect(
          f.workbenchRead.mock.calls.filter(
            ([r]) => r.kind === "conversation-step",
          ),
        ).toHaveLength(versions.length);
        switch (point.action) {
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
            expect(html).toContain("Tool call in progress");
            break;
          case "silence":
            expect(turn.steps).toEqual(prior?.steps);
            expect(html).toContain("Tool call in progress");
            break;
          case "read-failure":
            expect(facts.view?.error).toBe("unavailable");
            expect(html).toContain("Conversation state is not current.");
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
              expect(html).toContain("Tool result recorded");
            }
            break;
          }
          case "reply-end":
            terminal = turn;
            expect(turn.steps.map((s) => s.renderId)).toEqual(
              durable?.steps.map((s) => s.renderId),
            );
            expect(html).not.toContain("Tool call in progress");
            break;
          case "reconnect":
          case "workflow-end":
            expect(turn.steps).toEqual(terminal?.steps);
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
