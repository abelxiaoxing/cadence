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
import {
  groupByTime,
  matchesFilter,
  rowTime,
  timeGroupOf,
} from "../../web/src/navigation/time-groups";
import { content, context, coverage, hash, id, transport } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
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
    "Running work",
    "Conversation history",
    "Active roster unavailable",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("Recent projects");
  expect(html).not.toContain("Open working folder");
  expect(html).not.toContain("No active runs");
  expect(html).not.toContain("Cancel run — request stop");
});
it("groups listed conversations by local day and filters them by title, reading nothing", () => {
  // Local calendar components: the grouping follows this browser's days.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 10, day, hour, minute).getTime();
  const now = at(10, 12);
  expect(timeGroupOf(at(10, 0), now)).toBe("today");
  expect(timeGroupOf(at(9, 23, 59), now)).toBe("yesterday");
  expect(timeGroupOf(at(9, 0), now)).toBe("yesterday");
  expect(timeGroupOf(at(8, 23, 59), now)).toBe("earlier");
  // An unrecorded time is earlier; a clock ahead of this one is still today.
  expect(timeGroupOf(0, now)).toBe("earlier");
  expect(timeGroupOf(at(11, 3), now)).toBe("today");
  const rows = [
    { title: "b", at: at(10, 9) },
    { title: "old", at: at(1, 9) },
    { title: "a", at: at(10, 8) },
    { title: "y", at: at(9, 22) },
  ];
  const groups = groupByTime(rows, (row) => row.at, now);
  expect(groups.map((group) => group.key)).toEqual([
    "today",
    "yesterday",
    "earlier",
  ]);
  // Each group keeps the listed order; an empty group is left out.
  expect(groups[0].items.map((row) => row.title)).toEqual(["b", "a"]);
  expect(
    groupByTime(rows.slice(1, 2), (row) => row.at, now).map((g) => g.key),
  ).toEqual(["earlier"]);
  expect(groupByTime([], () => 0, now)).toEqual([]);
  expect(matchesFilter("Fix the Login page", "  login ")).toBe(true);
  expect(matchesFilter("训练代码 train.py", "TRAIN")).toBe(true);
  expect(matchesFilter("anything", "   ")).toBe(true);
  expect(matchesFilter("Fix the login page", "logout")).toBe(false);
  // Today and yesterday show the clock, earlier days the date.
  expect(rowTime(at(10, 9, 5), "en-GB", now)).toBe("09:05");
  expect(rowTime(at(9, 22), "en-GB", now)).toBe("22:00");
  expect(rowTime(at(1, 9), "en-GB", now)).toBe("1 Nov");
  expect(rowTime(new Date(2025, 2, 3).getTime(), "en-GB", now)).toBe(
    "3 Mar 2025",
  );
});
it("conversation rows are a title and a time; origin is the icon's name and a state line appears only when it says something", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 12));
  const chat = (
    title: string,
    status: string,
    updatedAt: number,
    more: object = {},
  ) => ({
    id: id(),
    title,
    leaf: "leaf",
    status,
    updatedAt,
    origin: "webui",
    ...more,
  });
  const chats = [
    chat("Live reply", "running", new Date(2026, 10, 10, 11, 58).getTime()),
    chat("Done today", "completed", new Date(2026, 10, 10, 9, 5).getTime()),
    chat("Broke yesterday", "failed", new Date(2026, 10, 9, 22).getTime(), {
      origin: "terminal",
    }),
    chat("Cadence idle", "completed", new Date(2026, 10, 1, 9).getTime(), {
      cadence: true,
    }),
    chat("Undated", "unknown", 0),
  ];
  const html = renderToStaticMarkup(
    <TaskSidebar
      client={new ServiceClient(transport())}
      taskId={null}
      scope={null}
      runs={[]}
      cancelCompatible={false}
      canceling={new Set()}
      onCancel={() => {}}
      onTask={() => {}}
      onScope={() => {}}
      chats={chats as never}
      conversationId={chats[1].id}
    />,
  );
  // Running work is never filtered or grouped; history is grouped by day.
  const [running, history] = html.split("Conversation history");
  expect(running).toContain("Live reply");
  expect(running).not.toContain("lp-time-label");
  expect(history.match(/class="lp-time-label">[^<]+</g)).toEqual([
    'class="lp-time-label">Today<',
    'class="lp-time-label">Yesterday<',
    'class="lp-time-label">Earlier<',
  ]);
  expect(history).toContain('aria-label="Filter conversations…"');
  // The open conversation is marked for assistive technology, not only tinted.
  expect(history).toMatch(
    /class="session-item active" aria-current="true" title="Done today"/,
  );
  // A completed reply has a title and a time, nothing else.
  expect(history).toMatch(
    /<span class="session-title">Done today<\/span><\/span><time class="session-time" dateTime="[^"]+" title="[^"]+">09:05<\/time>/,
  );
  expect(html).not.toContain(">completed<");
  expect(html).not.toContain("Ordinary");
  expect(html).not.toContain("Ready for conversation");
  // Where it started is the icon's accessible name.
  expect(
    history.match(/role="img" aria-label="Started in the WebUI"/g),
  ).toHaveLength(3);
  expect(history).toMatch(
    /role="img" aria-label="Started in the terminal" title="Started in the terminal">.*Broke yesterday/,
  );
  // A state that is not plain completion is said in words.
  expect(running).toContain(
    '<span class="session-sub session-state running">running</span>',
  );
  expect(history).toContain(
    '<span class="session-sub session-state failed">failed</span>',
  );
  expect(history).toContain(
    '<span class="session-sub session-state unknown">unknown</span>',
  );
  expect(history).toContain(">22:00</time>");
  expect(history).toContain(">1 Nov</time>");
  // An unrecorded time shows none rather than 1970.
  expect(history).toMatch(
    /Undated<\/span><span class="session-sub session-state unknown">unknown<\/span><\/span><\/button>/,
  );
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
  expect(html).not.toContain("search-toggle");
  expect(html).not.toContain(">History details</button>");
});
