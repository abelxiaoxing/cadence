import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchRead } from "../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../src/service/contracts/workflow.ts";
import { publicError } from "../src/service-contract.ts";
import {
  BROWSER_ACTION_MS,
  BROWSER_SCENARIO_MS,
  observeWorkflow,
  type WorkflowObservation,
} from "./helpers/workflow-observation.ts";

const id = randomUUID(),
  epoch = randomUUID();
function reply(
  status: WorkflowRun["status"],
  mergedCommit: string | null = null,
): WorkflowObservation {
  return {
    kind: "ok",
    value: {
      kind: "workflow",
      commandId: null,
      response: {
        type: "run",
        run: {
          id,
          epoch,
          goal: "fixture",
          status,
          phase: "verifying",
          steps: [],
          notice: "",
          mergedCommit,
          humanReviewed: false,
        },
      },
    },
  };
}
function clock() {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
}
afterEach(() => vi.useRealTimers());

it("a real run may take longer than one UI action while staying inside the unchanged scenario budget", async () => {
  clock();
  const seen: WorkflowObservation[] = [];
  const client = {
    workbenchRead: vi.fn(async (_request: WorkbenchRead) =>
      reply(
        performance.now() < 17_100 ? "running" : "completed",
        "a".repeat(40),
      ),
    ),
  };
  const result = observeWorkflow(
    client,
    id,
    BROWSER_SCENARIO_MS - BROWSER_ACTION_MS,
    (r) => seen.push(r),
  );
  let done = false;
  void result.then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(BROWSER_ACTION_MS);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(2100);
  expect(await result).toMatchObject({ id, status: "completed" });
  expect(seen.length).toBeGreaterThan(1);
  expect(
    client.workbenchRead.mock.calls.every(
      ([request]) => request.kind === "workflow" && request.id === id,
    ),
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("a merge hash and continuing progress do not prove settlement or renew the absolute deadline", async () => {
  clock();
  const client = {
    workbenchRead: vi.fn(async () => reply("running", "b".repeat(40))),
  };
  const result = observeWorkflow(client, id, 300, () => {});
  const refused = expect(result).rejects.toThrow("existing scenario deadline");
  await vi.advanceTimersByTimeAsync(300);
  await refused;
  const reads = client.workbenchRead.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.workbenchRead).toHaveBeenCalledTimes(reads);
  expect(vi.getTimerCount()).toBe(0);
});

it("setup consumes the same scenario budget; starting observation does not grant another 120 seconds", async () => {
  clock();
  const deadline = performance.now() + BROWSER_SCENARIO_MS - BROWSER_ACTION_MS;
  await vi.advanceTimersByTimeAsync(BROWSER_SCENARIO_MS);
  const client = { workbenchRead: vi.fn(async () => reply("completed")) };
  await expect(observeWorkflow(client, id, deadline, () => {})).rejects.toThrow(
    "not observed",
  );
  expect(client.workbenchRead).not.toHaveBeenCalled();
});

it("a hanging observation aborts only its read, keeps the refusal and fails within the remaining budget", async () => {
  clock();
  const seen: WorkflowObservation[] = [];
  let reading: AbortSignal | undefined;
  const client = {
    workbenchRead: vi.fn(
      (_request, signal?: AbortSignal) =>
        new Promise<WorkflowObservation>((resolve) => {
          reading = signal;
          signal?.addEventListener(
            "abort",
            () => resolve({ kind: "error", error: publicError("unavailable") }),
            { once: true },
          );
        }),
    ),
  };
  const result = observeWorkflow(client, id, 200, (r) => seen.push(r));
  const refused = expect(result).rejects.toThrow("read refused: unavailable");
  await vi.advanceTimersByTimeAsync(200);
  await refused;
  expect(reading?.aborted).toBe(true);
  expect(client.workbenchRead).toHaveBeenCalledTimes(1);
  expect(seen).toMatchObject([
    { kind: "error", error: { code: "unavailable" } },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["failed", "canceled", "timeout", "unknown"] as const)(
  "preserves terminal %s rather than waiting for or fabricating success",
  async (status) => {
    clock();
    const client = { workbenchRead: vi.fn(async () => reply(status)) };
    expect(await observeWorkflow(client, id, 1000, () => {})).toMatchObject({
      status,
    });
    expect(client.workbenchRead).toHaveBeenCalledTimes(1);
  },
);

it("rejects a different run instead of using its completion", async () => {
  clock();
  const client = { workbenchRead: vi.fn(async () => reply("completed")) };
  await expect(
    observeWorkflow(client, randomUUID(), 1000, () => {}),
  ).rejects.toThrow("does not match");
});

it("temporary read refusal only repeats observation of the same run", async () => {
  clock();
  const seen: WorkflowObservation[] = [];
  const client = {
    workbenchRead: vi
      .fn(
        async (_request: WorkbenchRead): Promise<WorkflowObservation> =>
          reply("completed"),
      )
      .mockResolvedValueOnce(reply("running"))
      .mockResolvedValueOnce({
        kind: "error",
        error: publicError("unavailable"),
      }),
  };
  const result = observeWorkflow(client, id, 1000, (r) => seen.push(r));
  await vi.advanceTimersByTimeAsync(200);
  expect(await result).toMatchObject({ status: "completed" });
  expect(seen.map((r) => r.kind)).toEqual(["ok", "error", "ok"]);
  expect(client.workbenchRead.mock.calls.map(([request]) => request)).toEqual(
    Array.from({ length: 3 }, () => ({ kind: "workflow", id })),
  );
});

it("never disables the deadline", async () => {
  const client = { workbenchRead: vi.fn(async () => reply("completed")) };
  await expect(observeWorkflow(client, id, Infinity, () => {})).rejects.toThrow(
    "finite absolute",
  );
  expect(client.workbenchRead).not.toHaveBeenCalled();
});
