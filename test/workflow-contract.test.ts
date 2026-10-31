import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import {
  decodeWorkflowPlan,
  decodeWorkflowRun,
  type WorkflowPlan,
  workflowAncestors,
  workflowOrder,
} from "../src/service/contracts/workflow.ts";

import { plan } from "./helpers/workflow-plan.ts";

it("plans are finite DAGs, independent outputs have distinct owners, and checks are mandatory", () => {
  expect(
    workflowOrder(decodeWorkflowPlan(plan()).tasks).map((t) => t.id),
  ).toEqual(["a", "b"]);
  for (const mutate of [
    (p: WorkflowPlan) => {
      p.tasks[0].after = ["b"];
      p.tasks[1].after = ["a"];
    },
    (p: WorkflowPlan) => {
      p.tasks[1].after = ["missing"];
    },
    (p: WorkflowPlan) => {
      p.tasks[1].writes = ["a.txt"];
    },
    (p: WorkflowPlan) => {
      p.tasks[0].writes = ["../outside"];
    },
    (p: WorkflowPlan) => {
      p.tasks[0].writes = [".git/config"];
    },
    (p: WorkflowPlan) => {
      p.checks = [];
    },
    (p: WorkflowPlan) => {
      p.repairAttempts = 3;
    },
  ]) {
    const p = plan();
    mutate(p);
    expect(() => decodeWorkflowPlan(p)).toThrow();
  }
  const p = plan();
  p.tasks[1].after = ["a"];
  p.tasks[1].writes = ["a.txt"];
  expect(
    workflowAncestors(decodeWorkflowPlan(p).tasks, "b").map((t) => t.id),
  ).toEqual(["a"]);
});
it("automatic execution cannot manufacture human-reviewed state", () => {
  expect(() => decodeWorkflowRun({ humanReviewed: true })).toThrow();
});
it("global preferences persist only exact model choice and never silently replace corrupt files", () => {
  const root = mkdtempSync(join(tmpdir(), "cadence-preferences-")),
    p = new CadencePreferences(root);
  expect(p.read()).toBeNull();
  const model = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  } as const;
  p.save(model);
  expect(new CadencePreferences(root).read()).toEqual(model);
  expect(readFileSync(p.path, "utf8")).not.toMatch(
    /sourceSelectionId|auth|grant/,
  );
  writeFileSync(p.path, '{"schema":"unknown"}');
  expect(() => p.save(model)).toThrow();
  expect(readFileSync(p.path, "utf8")).toBe('{"schema":"unknown"}');
});
