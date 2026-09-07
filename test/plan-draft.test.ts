import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  compileImplementPlan,
  DesignPlanValidationError,
  type PlanDraft,
  parseImplementPlan,
} from "../src/delivery-compiler.ts";
import { projectDesignDiagnostic } from "../src/design-diagnostics.ts";
import { verificationFixturePlan } from "./helpers/verification-plan.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const consumerRoot = mkdtempSync(
    path.join(tmpdir(), "cadence-plan-authoring-"),
  );
  roots.push(consumerRoot);
  mkdirSync(path.join(consumerRoot, "test"));
  for (const [file, text] of Object.entries({
    "package.json": '{"type":"module"}',
    "test/regression.mjs": "export {};",
    "test/health.mjs": "export {};",
    "value.txt": "old",
  }))
    writeFileSync(path.join(consumerRoot, file), text);
  return {
    consumerRoot,
    plan: verificationFixturePlan("draft-authoring").plan,
  };
}
function diagnostics(draft: unknown, consumerRoot: string) {
  try {
    compileImplementPlan(draft, { consumerRoot });
  } catch (error) {
    expect(error).toBeInstanceOf(DesignPlanValidationError);
    return (error as DesignPlanValidationError).diagnostics;
  }
  throw new Error("Expected invalid draft");
}

it("derives omitted authoring fields without changing canonical identity or mutating the draft", () => {
  const { consumerRoot, plan } = fixture();
  const explicit = compileImplementPlan(plan, { consumerRoot });
  const draft: PlanDraft = structuredClone(plan);
  delete draft.tracking;
  for (const phase of Object.values(draft.tasks[0]!.phases))
    delete phase.verificationInputs;
  delete draft.tasks[0]!.impactClosure.relatedTests[0]!.disposition;
  const before = structuredClone(draft);
  const compiled = compileImplementPlan(draft, { consumerRoot });
  expect(compiled.bytes).toEqual(explicit.bytes);
  expect(draft).toEqual(before);
  expect(parseImplementPlan(compiled.bytes)).toEqual(explicit.plan);
  expect(() =>
    parseImplementPlan(Buffer.from(JSON.stringify(draft))),
  ).toThrow();
});

it("derives producer bindings and still rejects ambiguous or unavailable phase authority", () => {
  const { consumerRoot, plan } = fixture();
  plan.outputs = [
    {
      id: "regression",
      path: "test/regression.mjs",
      producer: { taskId: "real-task", phase: "red" },
      postcondition: "regular-file",
    },
  ];
  const draft: PlanDraft = structuredClone(plan);
  for (const phase of Object.values(draft.tasks[0]!.phases))
    delete phase.verificationInputs;
  const compiled = compileImplementPlan(draft, { consumerRoot });
  expect(compiled.plan.tasks[0]!.phases.green.verificationInputs).toEqual([
    { kind: "output", outputId: "regression" },
  ]);
  const explicit = structuredClone(plan);
  for (const phase of Object.values(explicit.tasks[0]!.phases))
    phase.verificationInputs = [{ kind: "output", outputId: "regression" }];
  expect(compiled.bytes).toEqual(
    compileImplementPlan(explicit, { consumerRoot }).bytes,
  );
  const ambiguous = structuredClone(draft);
  ambiguous.outputs.push({ ...ambiguous.outputs[0]!, id: "duplicate" });
  expect(diagnostics(ambiguous, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "multiple-output-producers" }),
    ]),
  );
  draft.outputs[0]!.producer.phase = "green";
  draft.tasks[0]!.phases.green.write.push("test/regression.mjs");
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "producer-phase-after-consumer",
        phase: "red",
      }),
    ]),
  );
  const outside = structuredClone(draft);
  outside.tasks[0]!.phases.red.read = [];
  outside.tasks[0]!.phases.red.write = ["value.txt"];
  expect(diagnostics(outside, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ category: "verification-input-not-declared" }),
    ]),
  );
});

it("reports independent task errors together and identifies the exact unchanged test", () => {
  const { consumerRoot, plan } = fixture();
  const first = plan.tasks[0]!;
  first.impactClosure.relatedTests = [
    {
      path: "test/health.mjs",
      disposition: "current-task",
      evidence: "Existing health test remains unchanged",
    },
  ];
  plan.tasks.push({ ...structuredClone(first), taskId: "second-task" });
  plan.tracking.taskIds.push("second-task");
  const found = diagnostics(plan, consumerRoot);
  expect(found).toHaveLength(2);
  expect(found.map((d) => d.taskId).sort()).toEqual([
    "real-task",
    "second-task",
  ]);
  for (const d of found)
    expect(d).toMatchObject({
      category: "current-task-outside-write-set",
      path: "test/health.mjs",
      actualPaths: ["test/health.mjs"],
      expectedPaths: ["test/regression.mjs", "value.txt"],
    });
  const draft: PlanDraft = structuredClone(plan);
  for (const task of draft.tasks)
    delete task.impactClosure.relatedTests[0]!.disposition;
  const compiled = compileImplementPlan(draft, { consumerRoot });
  expect(
    compiled.plan.tasks.map(
      (t) => t.impactClosure.relatedTests[0]!.disposition,
    ),
  ).toEqual(["unaffected", "unaffected"]);
});

it("retains explicit input mistakes and reports expected and actual paths for each phase", () => {
  const { consumerRoot, plan } = fixture();
  for (const phase of Object.values(plan.tasks[0]!.phases))
    phase.verificationInputs.push({ kind: "workspace", path: "value.txt" });
  const found = diagnostics(plan, consumerRoot);
  expect(found).toHaveLength(2);
  for (const d of found)
    expect(d).toMatchObject({
      code: "verification-input-binding-mismatch",
      field: `phases.${d.phase}.verificationInputs`,
      expectedPaths: ["test/regression.mjs"],
      actualPaths: ["test/regression.mjs", "value.txt"],
    });
});

it("infers a unique other test owner but asks for an explicit owner when several tasks edit it", () => {
  const { consumerRoot, plan } = fixture();
  const draft: PlanDraft = structuredClone(plan);
  const second = structuredClone(draft.tasks[0]!);
  second.taskId = "second-task";
  second.dependsOn = ["real-task"];
  second.phases.red.write = ["value.txt"];
  delete second.impactClosure.relatedTests[0]!.disposition;
  draft.tasks.push(second);
  delete draft.tracking;
  expect(
    compileImplementPlan(draft, { consumerRoot }).plan.tasks[1]!.impactClosure
      .relatedTests[0],
  ).toMatchObject({
    disposition: "regression-task",
    regressionTaskId: "real-task",
  });
  draft.tasks.push({
    ...structuredClone(draft.tasks[0]!),
    taskId: "third-task",
  });
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "related-test-owner-ambiguous",
        taskId: "second-task",
        path: "test/regression.mjs",
      }),
    ]),
  );
  expect(readFileSync(path.join(consumerRoot, "value.txt"), "utf8")).toBe(
    "old",
  );
});

it("bounds path feedback and only supplies code-owned correction hints", () => {
  const diagnostic = projectDesignDiagnostic({
    code: "verification-input-binding-mismatch",
    expectedPaths: ["test/expected.mjs"],
    actualPaths: [
      "/home/private/secret",
      "../secret",
      "https://secret",
      "test/\u001bsecret",
      ...Array.from({ length: 40 }, (_, index) => `test/${index}.mjs`),
    ],
    pathsTruncated: false,
    hint: "private-model-text",
    rawError: "private-error",
    provider: "private-provider",
  });
  expect(diagnostic).toMatchObject({
    expectedPaths: ["test/expected.mjs"],
    pathsTruncated: true,
    hint: expect.stringContaining("Omit verificationInputs"),
  });
  expect(diagnostic!.actualPaths).toHaveLength(32);
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /private|secret|rawError|provider/,
  );
  expect(projectDesignDiagnostic({ code: "constructor" })).toEqual({
    code: "constructor",
  });
});
