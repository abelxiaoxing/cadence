// Readonly navigation/presentation tests. Real DOM and owner lifetimes are covered
// separately by assets-browser and accepting-browser scenarios.
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  type Activity,
  type ActivityDiscovery,
  managedActivity,
} from "../../src/service/contracts/activity.ts";
import type { ChatSummary } from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
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
      canCancel={false}
      canceling={new Set()}
      onCancel={() => {}}
      onTask={() => {}}
      onScope={() => {}}
    />,
  );
  for (const label of ["Conversation history", "Active roster unavailable"])
    expect(html).toContain(label);
  expect(html).not.toContain("Running work");
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
      canCancel={false}
      canceling={new Set()}
      onCancel={() => {}}
      onTask={() => {}}
      onScope={() => {}}
      chats={chats as never}
      conversationId={chats[1].id}
    />,
  );
  // Active and dated rows share one history section; only the latter
  // participate in date grouping/the filter.
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
    'class="status-dot busy history-activity-mark" role="img" aria-label="Working"',
  );
  expect(running).not.toContain("session-time");
  expect(html.match(/<section class="lp-section /g)).toHaveLength(1);
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
const summary = (
  title: string,
  status: ChatSummary["status"],
): ChatSummary => ({
  id: id(),
  title,
  status,
  updatedAt: 1000,
  leaf: null,
  origin: "webui",
});
const workflow = (goal: string): WorkflowRun => ({
  id: id(),
  epoch: id(),
  goal,
  phase: "implementing",
  status: "running",
  steps: [],
  notice: "",
  mergedCommit: null,
  humanReviewed: false,
});
function historyView(props: Partial<ComponentProps<typeof TaskSidebar>>) {
  return renderToStaticMarkup(
    <TaskSidebar
      client={new ServiceClient(transport())}
      taskId={null}
      scope={null}
      runs={[]}
      canCancel={false}
      canceling={new Set()}
      onCancel={() => {}}
      onScope={() => {}}
      onTask={() => {}}
      activeRuns={{
        status: "complete",
        runs: [],
        epoch: id(),
        workspaceId: id(),
        storeId: id(),
      }}
      {...props}
    />,
  );
}
it("pins one session until its last independent reply or linked run leaves the roster", () => {
  const listed = summary("Pinned session", "completed");
  const idle = summary("Earlier discussion", "completed");
  const reply = { ...listed, status: "running" as const };
  const a = workflow("Patch"),
    b = workflow("Patch"); // Even identical goals have distinct Stop targets.
  const draw = (
    workflows: WorkflowRun[],
    activeChats: ChatSummary[],
    chats = [idle, listed],
  ) =>
    historyView({
      chats,
      activeChats,
      workflows,
      conversationId: listed.id,
      workflowLinks: workflows.map((run) => ({
        runId: run.id,
        conversationId: listed.id,
      })),
      onCancelWorkflow: async () => {},
      canCancelWorkflow: (run) => run.id === b.id,
    });
  const first = draw([a, b], [reply]);
  expect(first.match(/class="session-title">Pinned session</g)).toHaveLength(1);
  expect(first).toContain(
    'aria-label="Open workflow details · Pinned session (2)"',
  );
  expect(first).toContain(
    `aria-label="Cancel workflow — request stop · Patch · ${a.id}" disabled=""`,
  );
  expect(first).toContain(
    `aria-label="Cancel workflow — request stop · Patch · ${b.id}">`,
  );
  expect(first.match(/class="lp-count">2</g)).toHaveLength(1); // sessions, not work items
  // Changing roster order, phase and the session write clock changes no row.
  const updated = draw(
    [
      { ...b, phase: "recovering" },
      { ...a, phase: "verifying" },
    ],
    [{ ...reply, updatedAt: reply.updatedAt + 60_000 }],
    [listed, idle],
  );
  expect(updated).toBe(first);
  for (const html of [draw([a, b], []), draw([b], []), draw([], [reply])]) {
    expect(html.indexOf('title="Pinned session"')).toBeLessThan(
      html.indexOf('title="Earlier discussion"'),
    );
    expect(html).toContain(
      'class="session-item active" aria-current="true" title="Pinned session"><span class="status-dot busy',
    );
  }
  const settled = draw([], []);
  expect(settled.indexOf('title="Pinned session"')).toBeGreaterThan(
    settled.indexOf('title="Earlier discussion"'),
  );
  expect(settled).not.toMatch(/history-activity-mark|history-workflows/);
  expect(settled).toContain(
    'class="session-item active" aria-current="true" title="Pinned session"',
  );
});
it("pins a direct owner's reply by roster membership until settlement, independently of its recorded result", () => {
  const reply = {
    ...summary("Direct reply", "running"),
    live: { commandId: id(), epoch: id() },
  };
  const settling = { ...reply, status: "failed" as const };
  const draw = (
    activeChats?: ChatSummary[],
    chatActivityKnown = true,
    page = reply,
  ) =>
    historyView({
      chats: [page], // The page and direct owner's roster refresh independently.
      activeChats,
      chatActivityKnown,
      conversationId: reply.id,
    }).split('<header class="lp-section-header"');
  const row =
    'class="session-item active" aria-current="true" title="Direct reply"';
  const [running, firstPage] = draw([reply]);
  const [closing, secondPage] = draw([settling]);
  for (const [prefix, page] of [
    [running, firstPage],
    [closing, secondPage],
  ]) {
    expect(prefix).toContain(row);
    expect(prefix).toContain('aria-label="Working"');
    expect(prefix).not.toContain('class="session-actions"');
    expect(page).not.toContain(reply.title);
  }
  const outcome = 'class="session-sub session-state failed">failed</span>';
  expect(closing).toContain(outcome);
  const [released, lastPage] = draw([]);
  expect(released).not.toContain(reply.title);
  expect(lastPage).toContain(row);
  expect(lastPage).not.toContain("history-activity-mark");
  // A failed read retains the last roster, or the page's live hint if no
  // roster has arrived yet. Neither is a fresh observation.
  for (const [stale] of [
    draw([settling], false),
    draw(undefined, false, settling),
  ]) {
    expect(stale).toContain(row);
    expect(stale).toContain('aria-label="Stale observation"');
    expect(stale).toContain(outcome);
  }
});
it("joins shared terminal reports to their project's history without consuming unrelated discovery or owner controls", () => {
  const listed = summary("Mineral notes", "completed"),
    idle = summary("Older notes", "completed");
  const flow = workflow("Inspect facets"),
    otherFlow = workflow("Inspect facets");
  const live = { epoch: flow.epoch, commandId: id() };
  const project = "/minerals";
  const terminal: Activity = {
    source: "terminal",
    id: flow.id,
    epoch: null,
    instance: id(),
    cwd: `${project}/samples`,
    sessionId: listed.id,
    leaf: "0123abcd",
    history: "shared",
    observedAt: 1000,
    phase: "turn",
    freshness: "current",
    executionCwd: null,
  };
  const second = { ...terminal, instance: id(), leaf: "8765dcba" };
  const incompatible = {
    ...terminal,
    instance: id(),
    history: "unavailable" as const,
  };
  const offPage = { ...terminal, id: id(), sessionId: "unwritten" };
  const draw = (
    native: Activity[],
    reply: boolean,
    flows: WorkflowRun[],
    partial = false,
  ) => {
    const value: ActivityDiscovery = {
      kind: "activity-discovery",
      epoch: flow.epoch,
      observedAt: 1000,
      completeness: partial ? "partial" : "complete",
      unavailable: Number(partial),
      projects: [
        { path: "/other", activities: [{ ...terminal, cwd: "/other" }] },
        {
          path: project,
          activities: [
            ...native,
            offPage,
            incompatible,
            { ...terminal, id: id(), sessionId: null },
            ...flows.map((r) => ({
              ...terminal,
              source: "workflow" as const,
              id: r.id,
              epoch: r.epoch,
              instance: null,
            })),
            ...(reply
              ? [
                  {
                    ...terminal,
                    source: "turn" as const,
                    id: live.commandId,
                    epoch: live.epoch,
                    instance: null,
                  },
                ]
              : []),
          ],
        },
      ],
    };
    return historyView({
      chats: [idle, listed],
      activeChats: reply ? [{ ...listed, status: "running", live }] : [],
      workflows: flows,
      workflowLinks: flows.map((r) => ({
        runId: r.id,
        conversationId: listed.id,
      })),
      canCancelWorkflow: (r) => r === flow,
      onCancelWorkflow: async () => {},
      discovery: {
        value,
        project,
        error: "",
        opening: false,
        onOpen: () => {},
      },
    });
  };
  const [outside, pinned, history] = draw([terminal, second], true, [
    flow,
    otherFlow,
  ]).split(
    /<section class="lp-section grow"|<header class="lp-section-header"/,
  );
  expect(pinned.match(/class="session-title">Mineral notes</g)).toHaveLength(1);
  expect(history).not.toContain(listed.title);
  expect(pinned).toContain(`aria-label="Details · ${listed.title} (4)"`);
  for (const a of [terminal, second])
    expect(pinned).toContain(`${a.leaf} · ${a.instance} · ${a.id}`);
  expect(pinned).toContain(
    `aria-label="Cancel workflow — request stop · ${flow.goal} · ${flow.id}">`,
  );
  expect(pinned).toContain(
    `aria-label="Cancel workflow — request stop · ${otherFlow.goal} · ${otherFlow.id}" disabled`,
  );
  expect(pinned.match(/class="conversation-stop"/g)).toHaveLength(2);
  expect(pinned).toContain('title="Conversation unwritten"');
  expect(pinned).not.toContain('aria-label="Rename Conversation unwritten');
  expect(outside).not.toMatch(/Owner workflow|Owner turn/);
  expect(outside.match(/Terminal turn \(observe only\)/g)).toHaveLength(3);
  expect(outside).toContain("/other");
  expect(outside).toContain("History configuration differs");
  expect(outside).toContain("Unattributed work");
  const stale = draw([{ ...second, freshness: "unknown" }], false, [], true);
  expect(stale).toContain("Missing work is not known to have finished");
  expect(stale).toContain(
    `title="${listed.title}"><span class="status-dot busy history-activity-mark" role="img" aria-label="Stale observation"`,
  );
  expect(stale).toContain('class="lp-count">Not observed');
  expect(
    draw([], false, []).split('<header class="lp-section-header"')[1],
  ).toContain(`title="${listed.title}"`);
});
it("promotes the session from owner discovery alone; only matching viewer runs add Stop", () => {
  const listed = summary("Gem log", "completed");
  const project = "/gem",
    a = workflow("Inspect"),
    b = { ...workflow("Inspect"), epoch: a.epoch };
  const report = (run: WorkflowRun): Activity => ({
    source: "workflow",
    epoch: run.epoch,
    id: run.id,
    sessionId: listed.id,
    instance: null,
    cwd: project,
    executionCwd: null,
    leaf: null,
    history: "shared",
    phase: "implementing",
    observedAt: 100,
    freshness: "current",
  });
  const draw = (local: Activity[], roster?: WorkflowRun[], linked = true) =>
    historyView({
      chats: [listed],
      workflows: roster,
      workflowLinks: linked
        ? roster?.map((r) => ({
            runId: r.id,
            conversationId: listed.id,
          }))
        : undefined,
      onCancelWorkflow: async () => {},
      canCancelWorkflow: (r) => r.id === b.id,
      discovery: {
        project,
        error: "",
        opening: false,
        onOpen() {},
        value: {
          kind: "activity-discovery",
          epoch: a.epoch,
          observedAt: 100,
          completeness: "complete",
          unavailable: 0,
          projects: [
            { path: project, activities: local },
            {
              path: "/elsewhere",
              activities: [{ ...report(a), cwd: "/elsewhere" }],
            },
          ],
        },
      },
    }).split(
      /<section class="lp-section grow"|<header class="lp-section-header"/,
    );
  const reports = [report(a), report(b)];
  for (const roster of [undefined, [a], [b, a]]) {
    const [outside, pinned, history] = draw(reports, roster);
    expect(outside.match(/Owner workflow/g)).toHaveLength(1);
    expect(outside).toContain("/elsewhere");
    expect(pinned.match(/class="session-title">Gem log</g)).toHaveLength(1);
    expect(pinned.match(/class="history-run"/g)).toHaveLength(2);
    expect(pinned).toContain('aria-label="Working"');
    expect(history).not.toContain(listed.title);
    for (const r of [a, b]) {
      if (roster?.includes(r)) {
        expect(pinned).toContain(
          `aria-label="Cancel workflow — request stop · Inspect · ${r.id}"${r === a ? ' disabled=""' : ">"}`,
        );
      } else {
        expect(pinned).toContain(` · ${r.epoch} · ${r.id}"`);
        expect(pinned).toContain(`${r.id.slice(0, 8)}</span>`);
      }
    }
    expect(pinned.match(/class="conversation-stop"/g) ?? []).toHaveLength(
      roster?.length ?? 0,
    );
  }
  // A gateway observation without any session is an identifiable, read-only
  // detail. Matching viewer evidence replaces only that exact observation.
  const orphans = reports.map((r) => ({ ...r, sessionId: null }));
  for (const roster of [undefined, [a], [a, b]]) {
    const [outside, prefix, history] = draw(orphans, roster, false);
    expect(outside.match(/Owner workflow/g)).toHaveLength(1);
    expect(outside).toContain("/elsewhere");
    expect(history).toContain(listed.title);
    expect(prefix).not.toContain("conversation-row");
    const details = prefix.match(
      /<details class="history-unlinked">(.*?)<\/details>/,
    )?.[1];
    expect(details).toContain("Unattributed work · 2");
    expect(details?.match(/class="history-run"/g)).toHaveLength(2);
    for (const r of [a, b]) {
      if (roster?.includes(r)) {
        expect(details).toContain(
          `aria-label="Cancel workflow — request stop · Inspect · ${r.id}"${r === a ? ' disabled=""' : ">"}`,
        );
        expect(details).not.toContain(`<code>${r.id}</code>`);
      } else expect(details).toContain(`<code>${r.id}</code>`);
    }
    expect(details?.match(/class="conversation-stop"/g) ?? []).toHaveLength(
      roster?.length ?? 0,
    );
  }
  // Its viewer no longer lists any run, but gateway still observes one.
  const [, last, history] = draw([reports[1]], []);
  expect(last).toContain(listed.title);
  expect(last).toContain(b.id);
  expect(history).not.toContain(listed.title);
  const [, done, past] = draw([], []);
  expect(done).not.toContain(listed.title);
  expect(past).toContain(listed.title);
});
it("replaces only the exact unattributed owner turn when its viewer session appears", () => {
  const project = "/notes";
  const epoch = id();
  const turn = () =>
    managedActivity({
      id: id(),
      epoch,
      source: "turn",
      root: project,
      phase: "settling",
      now: 1000,
    });
  const first = turn(),
    second = turn();
  const draw = (activeChats?: ChatSummary[]) =>
    historyView({
      chats: [],
      activeChats,
      discovery: {
        project,
        opening: false,
        onOpen() {},
        error: "",
        value: {
          kind: "activity-discovery",
          epoch,
          observedAt: 1000,
          completeness: "complete",
          unavailable: 0,
          projects: [{ path: project, activities: [first, second, first] }],
        },
      },
    });
  const viewer = {
    ...summary("Viewer reply", "failed"),
    live: { commandId: first.id, epoch },
  };
  for (const roster of [undefined, [viewer]]) {
    const html = draw(roster);
    expect(html).not.toMatch(/Active Pi work|Cancel|Stop/);
    const details = html.match(
      /<details class="history-unlinked">(.*?)<\/details>/s,
    )?.[1];
    expect(details).toContain(`Unattributed work · ${roster ? 1 : 2}`);
    expect(details).not.toContain("<button");
    expect(details).toContain(`Owner turn · <code>${second.id}</code>`);
    if (roster) {
      expect(details).not.toContain(first.id);
      expect(html.match(/class="session-title">Viewer reply</g)).toHaveLength(
        1,
      );
    } else {
      expect(details).toContain(`Owner turn · <code>${first.id}</code>`);
      expect(html).not.toContain('class="conversation-row');
    }
  }
});
it("keeps off-page, archived, unwritten and unlinked activity discoverable without inventing a session summary", () => {
  const fresh = summary("First send", "starting");
  const archived = {
    ...summary("Archived reply", "running"),
    archived: true as const,
  };
  const offPage = id();
  const linked = workflow("Background delivery"),
    orphan = workflow("Outside a conversation");
  const props = {
    chats: [],
    activeChats: [fresh, archived],
    workflows: [linked, orphan],
    workflowLinks: [{ runId: linked.id, conversationId: offPage }],
  };
  const html = historyView(props);
  expect(
    historyView({
      ...props,
      activeChats: [{ ...fresh, status: "running" }, archived],
    }),
  ).toBe(html);
  for (const title of [
    fresh.title,
    archived.title,
    `Conversation ${offPage}`,
    linked.goal,
    orphan.goal,
  ])
    expect(html).toContain(`class="session-title">${title}</span>`);
  expect(html).toContain('class="history-unlinked"');
  expect(html).toContain(
    `title="Open workflow details · ${orphan.goal} · ${orphan.id}"`,
  );
  expect(html.match(/aria-label="Started in the WebUI"/g)).toHaveLength(2);
  expect(html).not.toMatch(/aria-label="(Archive|Rename) Conversation/);
  expect(html).not.toContain("No conversations yet.");
  const stale = historyView({
    ...props,
    workflowError: true,
    chatActivityKnown: false,
  });
  expect(stale).toContain("retained work may still be running");
  expect(stale).toContain("Conversation activity unavailable.");
  expect(stale).toContain('aria-label="Stale observation"');
  expect(stale).toContain('class="lp-count">Not observed');
  expect(stale).toContain(orphan.goal);
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
  // A conversation's inspector has Files and its session's Branches; Files is
  // the one shown until Branches is chosen.
  expect(html).toMatch(
    /class="rp-tab" aria-pressed="true"><svg.*?<\/svg>Files<\/button><button type="button" class="rp-tab" aria-pressed="false"><svg.*?<\/svg>Branches<\/button>/,
  );
  expect(html).not.toContain("branches-panel");
});
