import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
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
import { prepareDirectorySend } from "../../web/src/client/project-entry";
import { sourceBuild } from "../helpers/source-build.ts";

const build = vi.hoisted(() => ({ available: true }));
vi.mock("../../web/src/client/build-identity", async () => ({
  get localBuild() {
    return build.available ? sourceBuild.assets : undefined;
  },
}));
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
