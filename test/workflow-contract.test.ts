import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import {
  clipUnits,
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  decodeWorkflowRun,
  type WorkflowPlan,
  workflowAncestors,
  workflowCovers,
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
it("new plans refuse invisible path characters and over-long task IDs; retained 2.0.21 shapes still read", () => {
  const strict = { strict: true };
  for (const path of [
    "src/\u202eevil.ts",
    "src/a\u200b.ts",
    "src/\u2066x\u2069.ts",
    "src/\ufeffa.ts",
    "src/a\u2028b.ts",
  ]) {
    const p = plan();
    p.tasks[0].writes = [path];
    expect(() => decodeWorkflowPlan(p, strict), JSON.stringify(path)).toThrow();
    // Read decoding keeps accepting what 2.0.21 accepted.
    expect(decodeWorkflowPlan(p).tasks[0].writes).toEqual([path]);
  }
  const long = plan();
  long.tasks[0].id = `a${"b".repeat(48)}`;
  expect(() => decodeWorkflowPlan(long, strict)).toThrow();
  expect(decodeWorkflowPlan(long).tasks[0].id).toHaveLength(49);
  const retained = {
    id: "00000000-0000-4000-8000-000000000000",
    epoch: "00000000-0000-4000-8000-000000000001",
    digest: "0".repeat(64),
    observation: "1".repeat(64),
    model: {
      epoch: "00000000-0000-4000-8000-000000000001",
      accessGeneration: 1,
      configRev: 1,
      catalogId: "00000000-0000-4000-8000-000000000002",
    },
    plan: long,
    cwd: "/project",
  };
  expect(decodeWorkflowProposal(retained).plan.tasks[0].id).toHaveLength(49);
  long.tasks[0].id = `a${"b".repeat(64)}`;
  expect(() => decodeWorkflowPlan(long)).toThrow();
  long.tasks[0].id = `a${"b".repeat(47)}`;
  expect(decodeWorkflowPlan(long, strict).tasks[0].id).toHaveLength(48);
  const nestedScope = plan();
  nestedScope.tasks[0].writes = ["src"];
  nestedScope.tasks[1].writes = ["src/b.txt"];
  expect(() => decodeWorkflowPlan(nestedScope)).toThrow("share write paths");
  expect(workflowCovers(["src"], "src/b.txt")).toBe(true);
  expect(workflowCovers(["src"], "srcx/b.txt")).toBe(false);
});
it("unit clipping never leaves a lone surrogate", () => {
  const value = `${"x".repeat(79)}\u{1F9EA} tail`;
  expect(clipUnits(value, 80)).toBe("x".repeat(79));
  expect(clipUnits(value, 81)).toBe(`${"x".repeat(79)}\u{1F9EA}`);
  expect(clipUnits("short", 80)).toBe("short");
  expect(() =>
    decodeWorkflowRun({
      id: "00000000-0000-4000-8000-000000000000",
      epoch: "00000000-0000-4000-8000-000000000001",
      goal: clipUnits(`${"g".repeat(319)}\u{1F600}`, 320),
      status: "running",
      phase: "implementing",
      steps: [
        {
          id: `${clipUnits(value, 80)}-00000000-0000-4000-8000-000000000002`,
          kind: "git",
          status: "running",
          text: "",
          exitCode: null,
          truncated: false,
        },
      ],
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    }),
  ).not.toThrow();
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
