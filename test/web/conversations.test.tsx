// Readonly navigation/presentation tests. Real DOM and owner lifetimes are covered
// separately by assets-browser and accepting-browser scenarios.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import {
  decodeRunProjection,
  type RunProjection,
} from "../../src/service-contract.ts";
import { App } from "../../web/src/App";
import { Coverage } from "../../web/src/components/history/Coverage";
import { Message } from "../../web/src/components/transcript/Message";
import {
  ConversationTree,
  TaskSidebar,
} from "../../web/src/components/workspace/TaskSidebar";
import { historyUrl, readHistoryUrl } from "../../web/src/history/history-url";
import { content, context, coverage, hash, id, transport } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
function projections(): RunProjection[] {
  const c = context(),
    runId = id(),
    childRunId = id();
  const parent = decodeRunProjection({
    runId,
    taskId: c.task?.id,
    childRunId: null,
    assignmentId: null,
    admission: {
      operationId: id(),
      commandId: id(),
      kind: "start",
      context: c,
      assignments: [{ assignmentId: "research-child", childRunId }],
      graph: { recordId: id(), revision: 1, sha256: hash },
    },
    lifecycle: "settled",
    outcome: "unknown",
    settlement: null,
    reason: null,
    publication: "uncertain",
    coverage,
    result: null,
  });
  return [
    parent,
    decodeRunProjection({
      ...parent,
      childRunId,
      assignmentId: "research-child",
      outcome: "canceled",
    }),
  ];
}
it("renders real parent/child identities, selected child and independent uncertain outcomes", () => {
  const runs = projections();
  const html = renderToStaticMarkup(
    <ConversationTree
      runs={runs}
      scope={{ kind: "child", id: runs[1].childRunId as string }}
      snapshot="7"
      onScope={() => {}}
    />,
  );
  expect(html).toContain("research-child");
  expect(html).toContain("Subagent");
  expect(html).toContain('aria-current="true"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("ep-state unknown");
  expect(html).toContain("ep-state canceled");
  expect(html).not.toContain("ep-state active");
});
it("an unavailable roster is not empty or inferred from historical lifecycle", () => {
  const runs = projections(),
    c = context();
  const html = renderToStaticMarkup(
    <TaskSidebar
      client={new ServiceClient(transport())}
      workspace={{
        workspaceId: c.workspaceId,
        storeId: id(),
        epoch: c.epoch,
        committedSeq: "7",
        rootLabel: "/workspace/project",
        models: [],
        context: { status: "available", version: { ...c, task: null } },
      }}
      taskId={null}
      scope={null}
      runs={runs}
      cancelCompatible={false}
      canceling={new Set()}
      onCancel={() => {}}
      onTask={() => {}}
      onScope={() => {}}
    />,
  );
  for (const label of [
    "Running conversations",
    "Conversation history",
    "Active roster unavailable",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Recent projects");
  expect(html).not.toContain("Open working folder");
  expect(html).not.toContain("No active runs");
  expect(html).not.toContain("Cancel run — request stop");
});
it("message text has a default field viewer without first expanding inspection", () => {
  const taskId = id(),
    childRunId = id();
  const html = renderToStaticMarkup(
    <Message
      client={new ServiceClient(transport())}
      seed={{
        storeId: id(),
        scope: { kind: "child", id: childRunId },
        reader: "messages",
        snapshotSeq: "7",
        after: null,
        limit: 50,
      }}
      message={{
        kind: "message",
        owner: {
          taskId,
          runId: id(),
          childRunId,
          entity: { kind: "message", id: id(), version: 1 },
        },
        version: 1,
        role: "assistant",
        source: { disposition: "unavailable", value: null },
        resultCallId: null,
        state: "final",
        finalBlockCount: 1,
        finalText: content(),
      }}
    />,
  );
  expect(html).toContain("detail-pane message-field");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Raw page"); // Markdown is the initial display.
  expect(html).not.toContain('class="msg-ident"');
});
it("compact source metadata folds only complete records; limitations remain visible", () => {
  const complete = renderToStaticMarkup(<Coverage value={coverage} compact />);
  const limited = renderToStaticMarkup(
    <Coverage
      value={{
        ...coverage,
        observed: "incomplete",
        source: "limited",
        redacted: true,
        omissions: ["source-limit"],
      }}
      compact
    />,
  );
  expect(complete).toContain("<details");
  expect(limited).not.toContain("<details");
  expect(limited).toContain("incomplete");
  expect(limited).toContain("limited");
  expect(limited).toContain("redacted");
});
it("child conversation links preserve exact scope and watermark without access material", () => {
  const taskId = id(),
    child = { kind: "child" as const, id: id() };
  vi.stubGlobal("window", {
    location: {
      origin: "https://example.test",
      pathname: "/app",
      search: "?token=never-copy",
    },
  });
  const url = new URL(
    historyUrl(taskId, undefined, { scope: child, snapshotSeq: "7" }),
  );
  expect(url.search).toBe("");
  vi.stubGlobal("window", { location: url });
  expect(readHistoryUrl()).toEqual({ taskId, scope: child, snapshotSeq: "7" });
  url.hash = new URLSearchParams({
    task: taskId,
    scope: JSON.stringify({ kind: "task", id: id() }),
    snapshot: "7",
  }).toString();
  expect(readHistoryUrl()).toBeNull();
  url.hash = new URLSearchParams({
    task: taskId,
    scope: JSON.stringify(child),
    snapshot: "not-a-sequence",
  }).toString();
  expect(readHistoryUrl()).toBeNull();
});

it("the initial conversation shell renders without a selected snapshot or task", () => {
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:43210/app") });
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain("Cadence");
  // Recorded views read a task/child scope; an ordinary conversation offers none.
  expect(html).not.toContain("Recorded views");
  expect(html).not.toContain("view-menu");
});
