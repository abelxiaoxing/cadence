import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { WorkflowRun } from "../src/service/contracts/workflow.ts";
import { hash } from "../src/service/private-files.ts";
import { Workflows } from "../src/service/workflows.ts";

it("step bounds are readonly page bounds, not a lifetime execution quota; archived membership remains inspectable", () => {
  const records = new Map<string, unknown>();
  const run: WorkflowRun = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "Long delivery fixture-private-literal",
    status: "running",
    phase: "implementing",
    steps: [],
    stepsBefore: 0,
    revision: 0,
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  };
  const live = { run };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    root: "/fixture",
    active: new Map([[run.id, live]]),
    o: {
      secrets: () => [],
      owner: { lease: { assert() {} } },
      coordination: {
        files: {
          read: (p: string) =>
            records.has(p)
              ? { bytes: Buffer.from(JSON.stringify(records.get(p))) }
              : undefined,
        },
      },
    },
    save() {},
    write: (p: string, value: unknown) => {
      records.set(p, structuredClone(value));
    },
  });
  let first = "";
  for (let i = 0; i < 600; i++) {
    const step = owner.step(live, "attempt", "implementation");
    step.status = "completed";
    step.text = "fixture-private-literal";
    if (!first) first = step.id;
  }
  expect(run.steps.length).toBeLessThanOrEqual(256);
  expect(run.stepsBefore).toBe(384);
  const previous = owner.view(run.id, run.stepsBefore).response.run;
  expect(previous.stepsBefore).toBe(256);
  expect(previous.steps).toHaveLength(128);
  const initial = owner.view(run.id, 128).response.run;
  expect(initial.stepsBefore).toBe(0);
  expect(initial.steps[0].id).toBe(first);
  expect(owner.findStep(run, first)?.id).toBe(first);
  expect(owner.findStep(run, "foreign-step")).toBeUndefined();
  expect(() => owner.view(run.id, 99999)).toThrow();
  expect(
    records.has(`/fixture/runs/${run.id}/members/${hash(first)}.json`),
  ).toBe(true);
  expect(run.stepsBefore).toBe(384); // reads never rebase the running state
  const retained = JSON.stringify([...records]);
  owner.o.secrets = () => ["fixture-private-literal"];
  expect(JSON.stringify(owner.view(run.id))).not.toContain(
    "fixture-private-literal",
  );
  expect(JSON.stringify(owner.view(run.id, 128))).not.toContain(
    "fixture-private-literal",
  );
  expect(JSON.stringify([...records])).toBe(retained);
  expect(run.goal).toContain("fixture-private-literal"); // projection, never a rewrite
  // Rich worker previews must page by bytes before a snapshot write overflows.
  for (let i = 0; i < 256; i++) {
    const step = owner.step(
      live,
      "rich-attempt",
      "implementation",
      randomUUID(),
    );
    step.status = "completed";
    step.text = "x".repeat(1024);
    step.runtime = { sdkVersion: "fixture", workerHash: "a".repeat(64) };
    expect(Buffer.byteLength(JSON.stringify(run))).toBeLessThan(384 * 1024);
  }
  expect(run.stepsBefore).toBeGreaterThan(384);
});
it("a step that is still running stays in view while older settled steps are paged around it", () => {
  const records = new Map<string, unknown>();
  const run: WorkflowRun = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "Parallel delivery",
    status: "running",
    phase: "implementing",
    steps: [],
    stepsBefore: 0,
    revision: 0,
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
  };
  const live = { run };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    root: "/fixture",
    active: new Map([[run.id, live]]),
    o: { secrets: () => [], owner: { lease: { assert() {} } } },
    save() {},
    write: (p: string, value: unknown) => {
      records.set(p, structuredClone(value));
    },
  });
  // The first step outlives hundreds of its siblings' steps.
  const long = owner.step(live, "long-task", "implementation");
  const settled: string[] = [];
  for (let i = 0; i < 300; i++) {
    const step = owner.step(live, "sibling", "check");
    step.status = "completed";
    settled.push(step.id);
  }
  expect(run.steps[0].id).toBe(long.id);
  expect(run.steps[0].status).toBe("running");
  expect(run.stepsBefore).toBe(128);
  const page = records.get(`/fixture/runs/${run.id}/pages/0.json`) as {
    steps: { id: string }[];
  };
  expect(page.steps.map((s) => s.id)).toEqual(settled.slice(0, 128));
  expect(run.steps.map((s) => s.id)).toEqual([long.id, ...settled.slice(128)]);
});
