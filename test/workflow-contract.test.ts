import { randomUUID } from "node:crypto";
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

it("initial plans are finite DAGs and checks are mandatory; route revisions belong to the owner", () => {
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
  expect(decodeWorkflowPlan(nestedScope).tasks).toHaveLength(2);
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
it("rejected is a review verdict only; historical failures stay unchanged", () => {
  const run = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "review",
    status: "failed",
    phase: "finished",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [
      {
        id: "review",
        kind: "review",
        status: "rejected",
        text: "",
        exitCode: 0,
        truncated: false,
      },
    ],
  };
  expect(decodeWorkflowRun(run).steps[0].status).toBe("rejected");
  expect(() => decodeWorkflowRun({ ...run, status: "rejected" })).toThrow();
  run.steps[0].kind = "implementation";
  expect(() => decodeWorkflowRun(run)).toThrow();
  run.steps[0].kind = "review";
  run.steps[0].status = "failed";
  expect(decodeWorkflowRun(run).steps[0].status).toBe("failed");
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

it("retained fixed-pipeline agreements remain readable but cannot authorize adaptive delivery", () => {
  const current = plan();
  const { version: _version, knowledge: _knowledge, ...body } = current;
  const old = {
    ...body,
    projectContext: "Original planning notes",
    repairAttempts: 2,
  };
  expect(decodeWorkflowPlan(old)).toEqual(old);
  expect(() => decodeWorkflowPlan(old, { strict: true })).toThrow("readonly");
  expect(() =>
    decodeWorkflowPlan({ ...current, repairAttempts: 2 }, { strict: true }),
  ).toThrow();
  expect(() =>
    decodeWorkflowPlan(
      { ...current, knowledge: ["../secret.md"] },
      { strict: true },
    ),
  ).toThrow();
  expect(() =>
    decodeWorkflowPlan({ ...current, knowledge: [".env"] }, { strict: true }),
  ).toThrow();
});

it("new setup/check commands default to no timeout without rewriting approved explicit values", () => {
  const p = plan();
  p.setup = [{ name: "setup", command: "prepare" }];
  p.baselineChecks = [{ name: "baseline", command: "inspect" }];
  p.checks = [{ name: "verify", command: "verify" }];
  const decoded = decodeWorkflowPlan(p, { strict: true });
  for (const commands of [
    decoded.setup,
    decoded.baselineChecks,
    decoded.checks,
  ])
    expect(commands[0]).not.toHaveProperty("timeoutMs");
  for (const timeoutMs of [120_000, 1_200_000, 3_600_000]) {
    p.checks[0].timeoutMs = timeoutMs;
    expect(decodeWorkflowPlan(p).checks[0].timeoutMs).toBe(timeoutMs);
  }
  for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    p.checks[0].timeoutMs = timeoutMs;
    expect(() => decodeWorkflowPlan(p)).toThrow();
  }
});
