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
  assessDeliveryTraceability,
  bindTaskVerifications,
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
  outside.tasks[0]!.phases.red!.read = [];
  outside.tasks[0]!.phases.red!.write = ["value.txt"];
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
  second.phases.red!.write = ["value.txt"];
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

it("expands named verifications and explicit common reads while sealing only complete contracts", () => {
  const { consumerRoot, plan } = fixture();
  const draft = structuredClone(plan) as unknown as Record<string, any>;
  draft.verificationDefinitions = {
    regression: {
      kind: "static-check",
      runner: { kind: "node", script: "test/regression.mjs" },
      args: [],
    },
  };
  const task = draft.tasks[0];
  task.read = task.phases.red.read;
  for (const [name, phase] of Object.entries(task.phases) as [string, any][]) {
    delete phase.read;
    delete phase.verificationInputs;
    phase.verification = {
      use: "regression",
      ...(name === "red" ? { expectedFailure: "real-regression" } : {}),
    };
  }
  task.affectedVerification = { use: "regression" };
  task.repairVerification = { use: "regression" };
  delete draft.tracking;
  delete draft.verification.baseline.target;
  delete draft.verification.baseline.affected;
  delete draft.verification.baseline.failureIdentity;
  delete draft.verification.change.affected;
  delete draft.verification.repair.inBoundaryOnly;
  delete draft.verification.repair.approvalOnBoundaryExpansion;
  delete draft.verification.repair.attribution;
  delete task.agents.managedOnly;
  const before = structuredClone(draft);
  const compiled = compileImplementPlan(draft, {
    consumerRoot,
    bindExecutionInputs: true,
  });
  expect(draft).toEqual(before);
  expect(compiled.plan).not.toHaveProperty("verificationDefinitions");
  expect(compiled.plan.tasks[0]).not.toHaveProperty("read");
  expect(compiled.plan.tasks[0]!.phases.red.read).toEqual(
    [...task.read].sort(),
  );
  expect(compiled.plan.tasks[0]!.phases.red.verification.classification).toBe(
    "expected-red",
  );
  expect(compiled.plan.tasks[0]!.phases.green.verification.classification).toBe(
    "expected-green",
  );
  expect(compiled.plan.tasks[0]!.affectedVerification.id).not.toBe(
    compiled.plan.tasks[0]!.repairVerification.id,
  );
  expect(compileImplementPlan(compiled.plan, { consumerRoot }).bytes).toEqual(
    compiled.bytes,
  );
  expect(parseImplementPlan(compiled.bytes)).toEqual(compiled.plan);
  expect(() =>
    parseImplementPlan(Buffer.from(JSON.stringify(draft))),
  ).toThrow();
  const invalid = structuredClone(draft);
  invalid.verification.repair.inBoundaryOnly = false;
  expect(() => compileImplementPlan(invalid, { consumerRoot })).toThrow();
  invalid.verification.repair.inBoundaryOnly = true;
  invalid.tasks[0].phases.red.verification = {
    use: "missing",
    expectedFailure: "real-regression",
  };
  expect(diagnostics(invalid, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "verification-reference-unavailable",
        field: "phases.red.verification",
      }),
    ]),
  );
});

it("never infers missing authority and rejects reference overrides or executable definitions", () => {
  const { consumerRoot, plan } = fixture();
  const draft = structuredClone(plan) as unknown as Record<string, any>;
  draft.verificationDefinitions = {
    regression: {
      kind: "static-check",
      runner: { kind: "node", script: "test/regression.mjs" },
      args: [],
    },
  };
  draft.tasks[0].phases.green.verification = {
    use: "regression",
    runner: { kind: "node", script: "other.mjs" },
  };
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "verification-reference-invalid" }),
    ]),
  );
  draft.tasks[0].phases.green.verification = { use: "regression" };
  draft.verificationDefinitions.regression.executionBindings = {};
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "verification-definition-invalid" }),
    ]),
  );
  delete draft.verificationDefinitions.regression.executionBindings;
  draft.tasks[0].phases.green.read = ["value.txt"];
  expect(() => compileImplementPlan(draft, { consumerRoot })).toThrow();
});

it("derives omitted inline verification identities and classifications without changing explicit ones", () => {
  const { consumerRoot, plan } = fixture();
  const draft = structuredClone(plan) as unknown as Record<string, any>;
  delete draft.tasks[0].phases.red.verification.id;
  delete draft.tasks[0].phases.red.verification.classification;
  const compiled = compileImplementPlan(draft, { consumerRoot });
  expect(compiled.plan.tasks[0]!.phases.red.verification.id).toMatch(
    /^verify-[a-f0-9]{64}$/,
  );
  expect(compiled.plan.tasks[0]!.phases.green.verification.id).toBe(
    plan.tasks[0]!.phases.green.verification.id,
  );
});

it("compiles the shipped dependent-task draft and requires its declared producer edge", () => {
  const { consumerRoot } = fixture();
  mkdirSync(path.join(consumerRoot, "src"));
  for (const file of [
    "src/add.mjs",
    "src/double.mjs",
    "test/add.test.mjs",
    "test/double.test.mjs",
    "test/all.test.mjs",
  ])
    writeFileSync(path.join(consumerRoot, file), "export {};\n");
  const draft = JSON.parse(
    readFileSync(
      new URL(
        "../config/plan-draft.multiple-tasks.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const compiled = compileImplementPlan(draft, {
    consumerRoot,
    bindExecutionInputs: true,
  });
  const downstream = compiled.plan.tasks.find(
    (task) => task.taskId === "fix-double",
  )!;
  expect(downstream.phases.green.verificationInputs).toContainEqual({
    kind: "output",
    outputId: "add-regression",
  });
  expect(
    downstream.impactClosure.relatedTests.find(
      (test) => test.path === "test/add.test.mjs",
    ),
  ).toMatchObject({
    disposition: "regression-task",
    regressionTaskId: "fix-add",
  });
  expect(compileImplementPlan(compiled.plan, { consumerRoot }).bytes).toEqual(
    compiled.bytes,
  );
  // Reordering author task declarations does not change generated verifier identity.
  draft.tasks.reverse();
  const reordered = compileImplementPlan(draft, {
    consumerRoot,
    bindExecutionInputs: true,
  });
  const authored = compiled.plan.tasks
    .map((task) => `- [ ] \`${task.taskId}\` owns its observed behavior.`)
    .join("\n");
  expect(bindTaskVerifications(authored, reordered.plan)).toBe(
    bindTaskVerifications(authored, compiled.plan),
  );
  expect(
    reordered.plan.tasks.find((task) => task.taskId === "fix-add")!.phases.red
      .verification.id,
  ).toBe(
    compiled.plan.tasks.find((task) => task.taskId === "fix-add")!.phases.red
      .verification.id,
  );
  draft.tasks.find(
    (task: { taskId: string }) => task.taskId === "fix-double",
  ).dependsOn = [];
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "producer-not-dependency" }),
    ]),
  );
});

it.each(["behavior", "mechanical", "refactor"] as const)(
  "projects %s bindings with optional Refactor and leaves semantic ownership to the author",
  (mode) => {
    const { consumerRoot, plan } = fixture();
    const compiled = compileImplementPlan(plan, { consumerRoot }).plan;
    const task = compiled.tasks[0]!;
    task.verificationMode = mode;
    task.phases.refactor = structuredClone(task.phases.green);
    task.phases.refactor.verification.id = "refactor-check";
    const author = `## Tasks\n\n- [ ] \`${task.taskId}\` implements the accepted behavior.\n  - Owns \`specs/example/spec.md#Behavior/Accepted case\`\n`;
    const specs = [
      {
        path: "specs/example/spec.md",
        text: "### Requirement: Behavior\n#### Scenario: Accepted case\n",
      },
    ];
    const bound = bindTaskVerifications(author, compiled);
    expect(bound.startsWith(author)).toBe(true);
    expect(bound.includes("  - Red:")).toBe(mode === "behavior");
    expect(bound).toContain("  - Refactor: `refactor-check`");
    expect(
      assessDeliveryTraceability({
        tasksMarkdown: bound,
        specs,
        plan: compiled,
      }),
    ).toMatchObject({ ok: true });
    expect(
      assessDeliveryTraceability({
        tasksMarkdown: bound.replace("[ ]", "[x]"),
        specs,
        plan: compiled,
      }),
    ).toEqual(
      assessDeliveryTraceability({
        tasksMarkdown: bound,
        specs,
        plan: compiled,
      }),
    );
    expect(
      assessDeliveryTraceability({
        tasksMarkdown: bound,
        specs: [
          {
            ...specs[0]!,
            text: specs[0]!.text.replace("Accepted case", "Renamed case"),
          },
        ],
        plan: compiled,
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        "traceability-reference-unresolved",
      ]),
    });
    expect(
      assessDeliveryTraceability({
        tasksMarkdown: `${bound}\n\`specs/example/spec.md#Behavior/Accepted case\``,
        specs,
        plan: compiled,
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining(["traceability-reference-duplicate"]),
    });
    const revised = structuredClone(compiled);
    revised.tasks[0]!.phases.green.verification.id = "revised-green";
    const revisedText = bindTaskVerifications(
      `${bound}\nAuthor footer.\n`,
      revised,
    );
    expect(revisedText.startsWith(author)).toBe(true);
    expect(revisedText.endsWith("\nAuthor footer.\n")).toBe(true);
    expect(revisedText).toContain("Green: `revised-green`");
    expect(bindTaskVerifications(revisedText, revised)).toBe(revisedText);
  },
);

it("rejects ambiguous managed markers rather than replacing author text", () => {
  const { consumerRoot, plan } = fixture();
  const compiled = compileImplementPlan(plan, { consumerRoot });
  for (const markdown of [
    "author\n<!-- ABEL:VERIFICATION-BINDINGS:START -->\nvaluable text",
    "author\n<!-- ABEL:VERIFICATION-BINDINGS:END -->\nvaluable text",
    `${compiled.tasksMarkdown}\n${compiled.tasksMarkdown}`,
    `prefix ${compiled.tasksMarkdown}`,
  ]) {
    expect(() => bindTaskVerifications(markdown, compiled.plan)).toThrow(
      "traceability-managed-region-invalid",
    );
  }
});

it("derives named package-script command bytes before expanding verifier identities while retaining explicit mismatches", () => {
  const { consumerRoot, plan } = fixture();
  const command = "node --test test/regression.mjs";
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: command } }),
  );
  const draft: PlanDraft = structuredClone(plan);
  draft.verificationDefinitions = {
    suite: {
      kind: "package-script",
      packageManager: "npm",
      script: "test",
      args: [],
    },
  };
  for (const [phase, value] of Object.entries(draft.tasks[0]!.phases)) {
    value.verification = {
      use: "suite",
      ...(phase === "red" ? { expectedFailure: "[REGRESSION:changed]" } : {}),
    };
    delete value.verificationInputs;
  }
  const compiled = compileImplementPlan(draft, {
    consumerRoot,
    bindExecutionInputs: true,
  });
  expect(compiled.plan.tasks[0]!.phases.green.verification).toMatchObject({
    kind: "package-script",
    command,
  });
  const explicit = structuredClone(draft);
  const suite = explicit.verificationDefinitions!.suite!;
  if (suite.kind !== "package-script") throw new Error("fixture-suite-kind");
  suite.command = command;
  expect(
    compileImplementPlan(explicit, { consumerRoot, bindExecutionInputs: true })
      .bytes,
  ).toEqual(compiled.bytes);
  suite.command = "npm run test";
  expect(() =>
    compileImplementPlan(explicit, { consumerRoot, bindExecutionInputs: true }),
  ).toThrow("script-command-mismatch");
  expect(() =>
    parseImplementPlan(Buffer.from(JSON.stringify(draft))),
  ).toThrow();
});

it("locates invalid surfaces, duplicate phase paths and missing related-test ownership", () => {
  const { consumerRoot, plan } = fixture();
  const task = plan.tasks[0]!;
  task.phases.red.read.push("test/regression.mjs");
  task.phases.green.read.push("test/health.mjs");
  expect(diagnostics(plan, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        taskId: "real-task",
        phase: "red",
        field: "phases.red.read.4",
        category: "duplicate-path",
        path: "test/regression.mjs",
      }),
      expect.objectContaining({
        taskId: "real-task",
        phase: "green",
        field: "phases.green.read.4",
        category: "duplicate-path",
        path: "test/health.mjs",
      }),
    ]),
  );
  task.phases.red.read.pop();
  task.phases.green.read.pop();
  (task.impactClosure.changedSurfaces as string[]) = ["ui", "api"];
  const surfaces = diagnostics(plan, consumerRoot);
  expect(surfaces).toEqual(
    expect.arrayContaining(
      [0, 1].map((index) =>
        expect.objectContaining({
          field: `impactClosure.changedSurfaces.${index}`,
          category: "enum",
          allowedValues: [
            "none",
            "route-authorization",
            "page-state",
            "api-response",
            "public-html",
          ],
        }),
      ),
    ),
  );
  expect(projectDesignDiagnostic(surfaces[0])).toMatchObject({
    allowedValues: expect.arrayContaining(["api-response"]),
    hint: expect.any(String),
  });
  task.impactClosure.changedSurfaces = ["api-response"];
  task.impactClosure.searchEvidence = ["Reviewed API callers"];
  task.impactClosure.relatedTests = [];
  expect(diagnostics(plan, consumerRoot)).toContainEqual(
    expect.objectContaining({
      field: "impactClosure.affectedSuite.0",
      category: "related-test-missing",
      path: "test/regression.mjs",
    }),
  );
});

it("identifies the fixed change affected marker rather than treating it as a verifier reference", () => {
  const { consumerRoot, plan } = fixture();
  const draft = structuredClone(plan) as unknown as Record<string, any>;
  draft.verification.change.affected = { use: "private-untrusted-definition" };
  const found = diagnostics(draft, consumerRoot);
  expect(found).toContainEqual({
    code: "delivery-verification-plan-invalid",
    field: "verification.change.affected",
    category: "enum",
    allowedValues: ["task-affected-contracts"],
  });
  expect(JSON.stringify(found)).not.toContain("private");
});

it("labels compilation as static checks, not approval or sealing", () => {
  const { consumerRoot, plan } = fixture();
  const result = compileImplementPlan(plan, { consumerRoot });
  expect(result.checks).toEqual({
    structure: "passed",
    verificationCapability: "passed",
    contractCoverage: "not-checked",
    sealing: "not-performed",
  });
  expect(result.closure.executable).toBe(true);
});

it("does not echo submitted enum values or unsafe duplicate paths", () => {
  const { consumerRoot, plan } = fixture();
  (plan.tasks[0]!.impactClosure.changedSurfaces as string[]) = [
    "private-secret\u001b",
  ];
  plan.tasks[0]!.phases.red.read.push("../private-secret", "../private-secret");
  const projected = diagnostics(plan, consumerRoot).map(
    projectDesignDiagnostic,
  );
  expect(JSON.stringify(projected)).not.toContain("private-secret");
});

it("retains unrelated task errors while refining rejected field diagnostics", () => {
  const { consumerRoot, plan } = fixture();
  const draft = structuredClone(plan) as unknown as Record<string, any>;
  draft.tasks[0].changeId = "not-authorized";
  draft.tasks[0].phases.red.read.push("test/regression.mjs");
  expect(diagnostics(draft, consumerRoot)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: "changeId",
        category: "unexpected-field",
      }),
      expect.objectContaining({
        field: "phases.red.read.4",
        category: "duplicate-path",
      }),
    ]),
  );
});
