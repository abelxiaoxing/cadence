import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  compatibleBuild,
  type ServiceBuild,
} from "../../src/service/contracts/build.ts";
import type {
  ProjectEntry,
  WorkbenchEntry,
} from "../../src/service/contracts/gateway.ts";
import {
  type PreparationStage,
  SEND_PREPARATION_MS,
  unsentMessage,
  waitForPreparation,
} from "../../web/src/client/conversation-send";
import {
  prepareDirectorySend,
  selectActivity,
  selectDirectory,
} from "../../web/src/client/project-entry";
import { sourceBuild } from "../helpers/source-build.ts";

const build = vi.hoisted(() => ({ available: true }));
vi.mock("../../web/src/client/build-identity", () => {
  const compatible = (service: ServiceBuild) =>
    compatibleBuild(
      service,
      build.available ? { kind: "browser", ...sourceBuild.assets } : null,
    );
  return {
    RELOAD_REQUIRED: "reload-required",
    get localBuild() {
      return build.available ? sourceBuild.assets : undefined;
    },
    browserBuildCompatible: compatible,
    assertBrowserBuildCompatible(service: ServiceBuild) {
      if (!build.available) throw new Error("unsupported-context");
      if (!compatible(service)) throw new Error("reload-required");
    },
  };
});
const descriptors = Object.getOwnPropertyDescriptors(AbortSignal);
afterEach(() => {
  Object.defineProperties(AbortSignal, descriptors);
  build.available = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const selected: ProjectEntry = {
  id: "a".repeat(64),
  path: "/fixture",
  cwd: "/fixture/sub",
  epoch: null,
};
const ready = { ...selected, epoch: randomUUID() };
const entry: WorkbenchEntry = {
  kind: "workbench",
  epoch: randomUUID(),
  csrf: randomUUID(),
  home: "/fixture",
  projects: [selected],
  recoveries: [],
  build: sourceBuild,
};
const location = { id: randomUUID(), cwd: "/fixture/conversation" };

it.each(["entry", "identity", "build", "body", "pre-abort", "fetch-throw"])(
  "failure before prepare POST handoff (%s) never suggests startup",
  async (failure) => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      if (init?.method === "POST") throw new Error("synchronous fetch refusal");
      if (failure === "entry")
        return Promise.reject(new Error("entry unavailable"));
      if (failure === "pre-abort") abort.abort(new Error("left"));
      return Promise.resolve(
        Response.json(
          failure === "identity" ? { ...entry, projects: [] } : entry,
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    if (failure === "build") build.available = false;
    const progress = vi.fn();
    const context =
      failure === "body"
        ? {
            ...location,
            toJSON() {
              throw new Error("body unavailable");
            },
          }
        : location;
    await expect(
      prepareDirectorySend(selected, abort.signal, context, progress),
    ).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(failure === "fetch-throw" ? 1 : 0);
    expect(unsentMessage("not-dispatched")).not.toContain(
      "service may have started",
    );
  },
);
it("refuses a stale loaded browser before any selection or preparation POST", async () => {
  const staleEntry = {
    ...entry,
    build: {
      ...entry.build,
      assets: { ...entry.build.assets, buildId: "0".repeat(64) },
    },
  };
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "POST") throw new Error("must not dispatch");
    return Response.json(staleEntry);
  });
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  for (const run of [
    () => selectDirectory("/fixture/sub", signal),
    () => prepareDirectorySend(selected, signal),
  ])
    await expect(run()).rejects.toMatchObject({ message: "reload-required" });
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  expect(unsentMessage("not-dispatched", "reload-required")).toContain(
    "No preparation request was sent",
  );
});

it("preserves a reliable no-effect preparation refusal", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method !== "POST") return Response.json(entry);
    return Response.json(
      {
        kind: "error",
        error: {
          code: "unsupported-context",
          effect: "none",
          recovery: "refresh",
        },
      },
      { status: 409 },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const progress = vi.fn();
  await expect(
    prepareDirectorySend(
      selected,
      new AbortController().signal,
      location,
      progress,
    ),
  ).rejects.toMatchObject({
    message: "unsupported-context",
    effect: "none",
  });
  expect(progress.mock.calls).toEqual([["dispatched"]]);
  expect(unsentMessage("dispatched", "unsupported-context", "none")).toContain(
    "started no execution service",
  );
  expect(
    unsentMessage("dispatched", "unsupported-context", "none"),
  ).not.toContain("outcome is unknown");
});

it.each([
  "lost",
  "malformed",
  "wrong-project",
  "wrong-cwd",
  "no-epoch",
  "refused",
])(
  "a handed-off POST without a matching confirmation (%s) stays unknown and is never replayed",
  async (failure) => {
    const progress = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(entry);
      if (failure === "lost") throw new Error("reply lost");
      if (failure === "malformed") return new Response("{");
      if (failure === "refused")
        return Response.json(
          { kind: "error", error: { code: "unavailable" } },
          { status: 503 },
        );
      return Response.json({
        kind: "project",
        project: {
          ...ready,
          ...(failure === "wrong-project" ? { id: "b".repeat(64) } : {}),
          ...(failure === "wrong-cwd" ? { cwd: "/elsewhere" } : {}),
          ...(failure === "no-epoch" ? { epoch: null } : {}),
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      prepareDirectorySend(
        selected,
        new AbortController().signal,
        location,
        progress,
      ),
    ).rejects.toThrow();
    expect(progress.mock.calls).toEqual([["dispatched"]]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/workbench/v1",
      "/workbench/v1/prepare-send",
    ]);
    expect(unsentMessage("dispatched")).toContain("The message was not sent");
  },
);
it("confirmation binds the original directory/location and precedes attachment timeout, even without static APIs", async () => {
  vi.useFakeTimers();
  for (const name of ["any", "timeout"])
    Object.defineProperty(AbortSignal, name, {
      configurable: true,
      value: undefined,
    });
  const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
    Response.json(
      init?.method === "POST" ? { kind: "project", project: ready } : entry,
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const departure = new AbortController();
  const remove = vi.spyOn(departure.signal, "removeEventListener");
  const stages: PreparationStage[] = ["not-dispatched"];
  const waiting = waitForPreparation(
    async (signal, context, progress) => {
      await prepareDirectorySend(selected, signal, context, progress);
      expect(stages).toEqual(["not-dispatched", "dispatched", "confirmed"]);
      // The real observer waits for a fresh attachment using this same signal.
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
    departure.signal,
    location,
    (stage) => stages.push(stage),
  );
  const result = expect(waiting).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(SEND_PREPARATION_MS);
  await result;
  expect(unsentMessage(stages.at(-1) ?? "not-dispatched")).toContain(
    "preparation was confirmed",
  );
  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(body).toEqual({
    projectId: selected.id,
    commandId: expect.any(String),
    location,
    epoch: entry.epoch,
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(departure.signal.aborted).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("pre-cancel and successful preparation both release the wait without canceling an owner", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  abort.abort(new Error("left"));
  const prepare = vi.fn(async () => {});
  await expect(
    waitForPreparation(prepare, abort.signal, location, () => {}),
  ).rejects.toThrow("left");
  expect(prepare).not.toHaveBeenCalled();
  await waitForPreparation(
    prepare,
    new AbortController().signal,
    location,
    () => {},
  );
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["changed-root", "changed-cwd", "late-abort", "selected"])(
  "R3: activity selection %s never prepares execution or rebinds a session",
  async (failure) => {
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(entry);
      if (failure === "late-abort") abort.abort();
      return Response.json({
        kind: "project",
        project: {
          ...selected,
          ...(failure === "changed-root" ? { path: "/other" } : {}),
          ...(failure === "changed-cwd" ? { cwd: "/other" } : {}),
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = selectActivity(
      selected.path,
      { sessionId: "pi-session", history: "shared", cwd: selected.cwd },
      abort.signal,
    );
    if (failure === "selected")
      expect((await pending).project.epoch).toBeNull();
    else await expect(pending).rejects.toThrow("stale");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/workbench/v1",
      "/workbench/v1/select",
    ]);
  },
);

it("R6: incompatible activity history refuses before any directory read or write", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    selectActivity(
      selected.path,
      {
        sessionId: "pi-session",
        history: "unavailable",
        cwd: selected.cwd,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
