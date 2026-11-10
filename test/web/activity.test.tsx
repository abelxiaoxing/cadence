import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  Activity,
  ActivityDiscovery,
} from "../../src/service/contracts/activity.ts";
import { observeActivity, staleActivity } from "../../web/src/client/activity";
import {
  activityRoute,
  branchHash,
  rememberBranch,
} from "../../web/src/client/project-route";
import {
  ActivityList,
  activityKey,
} from "../../web/src/components/workspace/ActivityList";
import { LocaleProvider } from "../../web/src/i18n/locale";

const epoch = randomUUID();
function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: randomUUID(),
    source: "terminal",
    sessionId: "pi-session",
    cwd: "/project",
    leaf: "abcdef12",
    history: "shared",
    phase: "turn",
    freshness: "current",
    observedAt: Date.now(),
    epoch: null,
    instance: randomUUID(),
    executionCwd: null,
    ...overrides,
  };
}
function discovery(activities = [activity()]): ActivityDiscovery {
  return {
    kind: "activity-discovery",
    epoch,
    observedAt: Date.now(),
    completeness: "complete",
    unavailable: 0,
    projects: [{ path: "/project", activities }],
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("SSR deduplicates project/session counts but preserves simultaneous terminal instances and owner workflow sources", () => {
  const value = discovery([
    activity(),
    activity(),
    activity({
      source: "workflow",
      epoch,
      phase: "recovering",
      instance: null,
    }),
  ]);
  const html = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <ActivityList value={value} error="" opening={false} onOpen={() => {}} />
    </LocaleProvider>,
  );
  expect(html).toContain("1 projects · 1 sessions");
  expect(html.match(/Terminal turn \(observe only\)/g)).toHaveLength(2);
  expect(html).toContain("Owner workflow");
  expect(html).toContain("recovering");
  expect(html).not.toMatch(/Stop|Cancel|completed/);
});
it("partial empty observation never claims everything finished; Chinese text and unattributed rows stay explicit", () => {
  const value = {
    ...discovery([activity({ sessionId: null, freshness: "unknown" })]),
    completeness: "partial" as const,
  };
  const html = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <ActivityList value={value} error="" opening={false} onOpen={() => {}} />
    </LocaleProvider>,
  );
  expect(html).toContain("未显示的工作不代表已经结束");
  expect(html).toContain("无法归属的工作");
  expect(html).toContain("disabled");
  const empty = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <ActivityList
        value={{ ...value, projects: [] }}
        error=""
        opening={false}
        onOpen={() => {}}
      />
    </LocaleProvider>,
  );
  expect(empty).not.toContain("No active work observed");
});
it("a failed observation marks retained work unknown and bounds its lifetime without inventing historical success", () => {
  const value = discovery();
  expect(
    staleActivity(value, Date.now()).projects[0].activities[0].freshness,
  ).toBe("unknown");
  expect(staleActivity(value, Date.now() + 120001)).toMatchObject({
    projects: [],
    completeness: "partial",
  });
});
it("late open/refresh discovers newly started work; polling is serialized, cancellable, and late replies cannot navigate", async () => {
  vi.useFakeTimers();
  let finish!: (value: ActivityDiscovery) => void;
  let signal!: AbortSignal;
  const read = vi.fn((s: AbortSignal) => {
    signal = s;
    return new Promise<ActivityDiscovery>((r) => {
      finish = r;
    });
  });
  const publish = vi.fn(),
    changed = vi.fn();
  const close = observeActivity(epoch, publish, changed, read);
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(1);
  finish({ ...discovery(), projects: [] });
  await vi.advanceTimersByTimeAsync(3000);
  expect(read).toHaveBeenCalledTimes(2);
  finish(discovery());
  await vi.advanceTimersByTimeAsync(0);
  expect(publish.mock.calls.at(-1)?.[0].projects).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3000);
  close();
  expect(signal.aborted).toBe(true);
  const count = publish.mock.calls.length;
  finish(discovery());
  await vi.advanceTimersByTimeAsync(60000);
  expect(publish).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
  expect(changed).not.toHaveBeenCalled();
});
it("owner/gateway identity changes cannot become fresh old-context data; a new subscription sees remaining work", async () => {
  vi.useFakeTimers();
  const publish = vi.fn(),
    changed = vi.fn();
  const close = observeActivity(epoch, publish, changed, async () => ({
    ...discovery(),
    epoch: randomUUID(),
  }));
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledWith(undefined, "stale");
  close();
  const reopen = observeActivity(epoch, publish, changed, async () =>
    discovery(),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(publish.mock.calls.at(-1)?.[0].projects).toHaveLength(1);
  reopen();
});
it("activity links select exact Pi branch identities, not file paths", () => {
  expect(activityRoute("#chat=pi-session&activity=1&leaf=abcdef12")).toEqual({
    selected: true,
    leaf: "abcdef12",
  });
  expect(activityRoute("#chat=pi-session&activity=1&leaf=/etc/passwd")).toEqual(
    { selected: false, leaf: null },
  );
});

it("the address keeps the branch shown: only the leaf is written, and only a valid entry id", () => {
  expect(branchHash("#chat=pi-session", "abcdef12")).toBe(
    "#chat=pi-session&leaf=abcdef12",
  );
  // What was written reads back as that branch of that conversation.
  expect(
    activityRoute(branchHash("#chat=pi-session", "abcdef12"), "pi-session"),
  ).toEqual({ selected: false, leaf: "abcdef12" });
  // Following the latest again removes the leaf and keeps the rest.
  expect(branchHash("#chat=pi-session&activity=1&leaf=abcdef12", null)).toBe(
    "#chat=pi-session&activity=1",
  );
  expect(branchHash("#chat=pi-session&leaf=abcdef12", "0011aabb")).toBe(
    "#chat=pi-session&leaf=0011aabb",
  );
  expect(() => branchHash("#chat=pi-session", "/etc/passwd")).toThrow();
});

it("the branch shown is replaced into its own conversation's address, without a navigation", () => {
  const location = {
    hash: "#chat=pi-session",
    pathname: "/app",
    search: "?project=fixture",
  };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    location.hash = url.slice(url.indexOf("#"));
  });
  vi.stubGlobal("window", { location });
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", { state: { cadenceCwd: "/p" }, replaceState });
  rememberBranch("pi-session", "abcdef12");
  // The entry is replaced with its state kept: no pushed entry, no hashchange.
  expect(replaceState).toHaveBeenCalledWith(
    { cadenceCwd: "/p" },
    "",
    "/app?project=fixture#chat=pi-session&leaf=abcdef12",
  );
  rememberBranch("pi-session", "abcdef12");
  expect(replaceState).toHaveBeenCalledTimes(1);
  // Another conversation's address is never rewritten.
  rememberBranch("other-session", "0011aabb");
  expect(replaceState).toHaveBeenCalledTimes(1);
  rememberBranch("pi-session", null);
  expect(location.hash).toBe("#chat=pi-session");
});

it("R3: an activity branch never applies to another conversation after navigation", () => {
  const hash = "#chat=pi-session&activity=1&leaf=abcdef12";
  expect(activityRoute(hash, "pi-session")).toEqual({
    selected: true,
    leaf: "abcdef12",
  });
  expect(activityRoute(hash, "fork-session")).toEqual({
    selected: false,
    leaf: null,
  });
  expect(activityRoute("#chat=new-session", "new-session")).toEqual({
    selected: false,
    leaf: null,
  });
});

it("R4: deduplication hides only exact owner work actually represented, never unassociated or changed-epoch work", () => {
  const flow = activity({ source: "workflow", epoch, instance: null });
  const native = activity();
  const render = (represented: string[]) =>
    renderToStaticMarkup(
      <LocaleProvider initial="en">
        <ActivityList
          value={discovery([flow, native])}
          represented={represented}
          error=""
          opening={false}
          onOpen={() => {}}
        />
      </LocaleProvider>,
    );
  expect(render([])).toContain("Owner workflow");
  expect(
    render([activityKey("/project", "workflow", flow.id, epoch)]),
  ).not.toContain("Owner workflow");
  expect(
    render([activityKey("/project", "workflow", flow.id, epoch)]),
  ).toContain("Terminal turn (observe only)");
  expect(
    render([activityKey("/project", "workflow", flow.id, randomUUID())]),
  ).toContain("Owner workflow");
  expect(render([activityKey("/other", "workflow", flow.id, epoch)])).toContain(
    "Owner workflow",
  );
});

it("R6: an incompatible history scope displays the activity and disables transcript navigation", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <ActivityList
        value={discovery([activity({ history: "unavailable" })])}
        error=""
        opening={false}
        onOpen={() => {}}
      />
    </LocaleProvider>,
  );
  expect(html).toContain("History configuration differs");
  expect(html).toContain("disabled");
  expect(html).toContain("pi-session");
});
