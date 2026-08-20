import { describe, expect, it } from "vitest";
import {
  diffWritePaths,
  LIMITS,
  validateDiffResult,
} from "../src/contracts.ts";
import { createSubmitTool } from "../src/submit-tool.ts";

const REQUEST_ID = "candidate-diff-admission";
const patch = (...lines: string[]) => [...lines, ""].join("\n");

const ordinary = {
  add: patch(
    "--- /dev/null",
    "+++ b/src/added.ts",
    "@@ -0,0 +1,2 @@",
    "+one",
    "+two",
  ),
  modify: patch(
    "--- a/src/changed.ts",
    "+++ b/src/changed.ts",
    "@@ -1,2 +1,2 @@",
    " old",
    "-before",
    "+after",
  ),
  delete: patch(
    "--- a/src/deleted.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-one",
    "-two",
  ),
};

function candidate(diff: string, summary = "Candidate ordinary unified diff") {
  return {
    id: REQUEST_ID,
    role: "implementation-worker",
    kind: "diff" as const,
    taskId: REQUEST_ID,
    phase: "red",
    summary,
    diff,
    expectedVerification:
      "bun run test:target test/candidate-diff-admission.property.test.ts",
    risks: [],
    nextStep: "reject malformed candidates before retention",
    contractCompliant: true as const,
  };
}

const malformed = [
  [
    "impossible hunk underflow",
    patch(
      "--- a/src/underflow.ts",
      "+++ b/src/underflow.ts",
      "@@ -1,2 +1,2 @@",
      " only-one-line",
    ),
  ],
  [
    "impossible hunk overflow",
    patch(
      "--- a/src/overflow.ts",
      "+++ b/src/overflow.ts",
      "@@ -1 +1 @@",
      " first",
      " extra",
    ),
  ],
  ["unconsumed End Patch suffix", `${ordinary.modify}*** End Patch\n`],
  ["unconsumed Markdown fence", `${ordinary.modify}\`\`\`\n`],
  ["missing final LF", ordinary.modify.slice(0, -1)],
  ["binary patch", patch("GIT binary patch", "literal 0", "HcmV?d00001")],
  [
    "copy metadata",
    patch(
      "copy from src/source.ts",
      "copy to src/copied.ts",
      "--- a/src/source.ts",
      "+++ b/src/copied.ts",
      "@@ -1 +1 @@",
      " value",
    ),
  ],
  [
    "rename metadata",
    patch(
      "rename from src/old.ts",
      "rename to src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -1 +1 @@",
      " value",
    ),
  ],
  [
    "mode transition",
    patch(
      "old mode 100644",
      "new mode 100755",
      "--- a/src/mode.ts",
      "+++ b/src/mode.ts",
      "@@ -1 +1 @@",
      " value",
    ),
  ],
  [
    "submodule",
    patch(
      "new file mode 160000",
      "--- /dev/null",
      "+++ b/vendor/dependency",
      "@@ -0,0 +1 @@",
      "+Subproject commit 0123456789abcdef",
    ),
  ],
  ["duplicate target", ordinary.modify + ordinary.modify],
  [
    "escaping target",
    patch("--- a/../escape.ts", "+++ b/../escape.ts", "@@ -1 +1 @@", " value"),
  ],
  [
    "noncanonical target",
    patch(
      "--- a/src//double.ts",
      "+++ b/src//double.ts",
      "@@ -1 +1 @@",
      " value",
    ),
  ],
] as const;

describe("candidate diff complete-consumption properties", () => {
  it("accepts valid ordinary add, modify, and delete controls", () => {
    const controls = [
      ["add", ordinary.add, ["src/added.ts"]],
      ["modify", ordinary.modify, ["src/changed.ts"]],
      ["delete", ordinary.delete, ["src/deleted.ts"]],
    ] as const;

    for (const [label, diff, paths] of controls) {
      expect(
        diffWritePaths(diff).paths,
        `[CAD-CONTROL:${label}:paths]`,
      ).toEqual(paths);
      expect(
        validateDiffResult(candidate(diff)),
        `[CAD-CONTROL:${label}:admission]`,
      ).toMatchObject({ ok: true, paths: [...paths] });
    }
  });

  it("rejects a result over the configured complete-result limit", () => {
    const result = validateDiffResult(
      candidate(ordinary.modify, "x".repeat(LIMITS.maxCompleteResultBytes)),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bytes|exceeds|limit/i);
  });

  it("[CAD-CONSUME:impossible hunk underflow]", async () => {
    let violations = 0;
    for (const [, diff] of malformed) {
      violations += Number(validateDiffResult(candidate(diff)).ok);
    }

    const submit = createSubmitTool({
      requestId: REQUEST_ID,
      role: "implementation-worker",
      phase: "red",
      output: "diff",
    });
    let submitRejected = false;
    try {
      await (submit.tool.execute as any)(
        "cad-invalid-candidate",
        candidate(malformed[0][1]),
      );
    } catch {
      submitRejected = true;
    }
    violations += Number(!submitRejected);
    violations += Number(submit.getResult() !== undefined);

    expect(violations, "[CAD-CONSUME:impossible hunk underflow]").toBe(0);
  });
});
