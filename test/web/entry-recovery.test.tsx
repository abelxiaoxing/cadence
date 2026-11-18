import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  rememberLoginReturn,
  restoreLoginReturn,
} from "../../web/src/client/project-route";
import { observeWorkbenchEntry } from "../../web/src/client/workbench-entry";
import { sourceBuild } from "../helpers/source-build";

const entry = {
  kind: "workbench",
  projects: [],
  epoch: randomUUID(),
  csrf: randomUUID(),
  home: "/fixture",
  recoveries: [],
  build: sourceBuild,
};
const cleanup: (() => void)[] = [];
function observe(fetcher: typeof fetch) {
  vi.useFakeTimers();
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  const calls = vi.fn(fetcher);
  vi.stubGlobal("fetch", calls);
  const ready = vi.fn(),
    issue = vi.fn();
  const stop = observeWorkbenchEntry(ready, issue);
  cleanup.push(stop);
  return { window, ready, issue, stop, calls };
}
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("recovers a cold deep-link entry using only serialized GETs; online wakes the backoff", async () => {
  let attempts = 0;
  const state = observe(async () => {
    attempts++;
    if (attempts === 1) throw new TypeError("offline");
    if (attempts === 2) return new Response("bad gateway", { status: 502 });
    return Response.json(entry);
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.issue.mock.calls).toEqual([["reconnecting"], ["reconnecting"]]);
  state.window.dispatchEvent(new Event("online"));
  state.window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.ready.mock.calls).toEqual([[entry]]);
  expect(
    state.calls.mock.calls.map(([url, init]) => [
      url,
      init?.method ?? "GET",
      init?.cache,
    ]),
  ).toEqual(Array(3).fill(["/workbench/v1", "GET", "no-store"]));
});
it("times out a stalled bootstrap and ignores a completed read after departure", async () => {
  let finish: ((response: Response) => void) | undefined;
  const state = observe(
    (_url, init) =>
      new Promise((resolve, reject) => {
        finish = resolve;
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        );
      }),
  );
  await vi.advanceTimersByTimeAsync(13000);
  expect(state.calls).toHaveBeenCalledTimes(2);
  expect(finish).toBeDefined();
  finish?.(Response.json(entry));
  state.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.calls).toHaveBeenCalledTimes(2);
  expect(state.ready).not.toHaveBeenCalled();
});
it.each([
  [401, "unauthenticated"],
  [403, "forbidden"],
  [200, "invalid"],
] as const)(
  "stops on permanent %s without switching to a direct owner",
  async (status, error) => {
    const state = observe(async () => Response.json({}, { status }));
    await vi.advanceTimersByTimeAsync(60000);
    state.window.dispatchEvent(new Event("online"));
    expect(state.calls).toHaveBeenCalledTimes(1);
    expect(state.issue.mock.calls).toEqual([[error]]);
    expect(state.ready).not.toHaveBeenCalled();
  },
);
it("recognizes a direct owner only on its definite route refusal", async () => {
  const state = observe(async () =>
    Response.json(
      { kind: "error", error: { code: "invalid" } },
      { status: 400 },
    ),
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.ready.mock.calls).toEqual([[null]]);
  expect(state.issue).not.toHaveBeenCalled();
  expect(state.calls).toHaveBeenCalledTimes(1);
});
it("after explicit login only restores validated chat/leaf on the same entry once", () => {
  const location = {
    pathname: "/app",
    search: `?project=${"b".repeat(64)}`,
    hash: "#chat=session-A&leaf=abc123ef&extra=discard",
  };
  const storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: storage.get.bind(storage),
    setItem: storage.set.bind(storage),
    removeItem: storage.delete.bind(storage),
  });
  vi.stubGlobal("location", location);
  const replaceState = vi.fn();
  vi.stubGlobal("history", { replaceState, state: null });
  rememberLoginReturn();
  location.hash = "";
  restoreLoginReturn();
  restoreLoginReturn();
  expect(replaceState.mock.calls).toEqual([
    [null, "", "#chat=session-A&leaf=abc123ef"],
  ]);
});
