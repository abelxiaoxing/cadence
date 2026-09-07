import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  isValidRelativePath,
  validateEvidenceResult,
} from "../src/contracts.ts";
import { createSubmitTool } from "../src/submit-tool.ts";

const draft = () => ({
  module_name: "src",
  scope: ["src/value.ts"],
  files_read: ["src/value.ts"],
  evidence: [
    { claim: "value exists", path: "src/value.ts", line_start: 1, line_end: 1 },
  ],
  constraints_discovered: [],
  open_questions: [],
  risks: [],
});
const tool = () =>
  createSubmitTool({
    requestId: "packet-1",
    role: "design-explorer",
    phase: "evidence",
    output: "evidence",
  });
const execute = (submit: ReturnType<typeof tool>, value: unknown) =>
  submit.tool.execute(
    "test",
    value as never,
    undefined,
    undefined,
    {} as never,
  );

describe("model-facing evidence drafts", () => {
  it.each([
    ".",
    "src",
    "src/value.ts",
    "模块/文件.ts",
    "x\ny",
    "x\n../y",
    "x\n./y",
    "x\n//y",
    "a/./b",
    "a/.",
    "./a",
    "../a",
    "a..b",
    "/a",
    "C:/a",
    "a\\b",
    "a\0b",
    "a/",
    "a//b",
    "",
    "x".repeat(513),
  ])("matches sealed path validation for %j", (path) => {
    const submit = tool();
    expect(
      Value.Check(submit.tool.parameters, { ...draft(), module_name: path }),
    ).toBe(isValidRelativePath(path));
  });

  it("reports enum errors to direct callers without inventing advisory values", async () => {
    const submit = createSubmitTool({
      requestId: "packet-1",
      role: "diagnosis-worker",
      phase: "evidence",
      output: "evidence",
    });
    await expect(
      execute(submit, {
        conclusions: [],
        citations: [],
        constraints: [],
        risks: [],
        blockingQuestions: [],
        hints: { writeSet: [], verification: "", agentsImpact: "no changes" },
      }),
    ).rejects.toThrow(/hints.agentsImpact.*none/u);
  });

  it("admits a small draft and binds identity without weakening sealed validation", async () => {
    const submit = tool();
    const input = draft();
    expect(Value.Check(submit.tool.parameters, input)).toBe(true);
    expect(validateEvidenceResult(input).ok).toBe(false);
    await execute(submit, input);
    expect(submit.getResult()).toMatchObject({
      ...input,
      id: "packet-1",
      packet_id: "packet-1",
      role: "design-explorer",
      kind: "evidence",
      dependencies: [],
      existing_structures: [],
      existing_conventions: [],
      write_set_hints: [],
      validation_hints: [],
      agents_impact_hints: [],
      success_criteria_hints: [],
    });
    expect(validateEvidenceResult(submit.getResult()).ok).toBe(true);
    expect(input).toEqual(draft());
  });

  it.each(["id", "packet_id", "role", "kind"])(
    "never overwrites explicit invalid %s",
    async (field) => {
      const submit = tool();
      await expect(
        execute(submit, { ...draft(), [field]: "wrong" }),
      ).rejects.toThrow();
      expect(submit.getResult()).toBeUndefined();
    },
  );

  it.each([
    "constraints_discovered",
    "open_questions",
    "risks",
    "evidence",
    "files_read",
    "scope",
  ])("does not invent omitted %s", async (field) => {
    const input: Record<string, unknown> = draft();
    delete input[field];
    const submit = tool();
    expect(Value.Check(submit.tool.parameters, input)).toBe(false);
    await expect(execute(submit, input)).rejects.toThrow();
    expect(submit.getResult()).toBeUndefined();
  });

  it("rejects explicit nulls and unknown control fields rather than cleaning them", async () => {
    for (const extra of [{ dependencies: null }, { nextStep: "apply" }]) {
      const submit = tool();
      await expect(execute(submit, { ...draft(), ...extra })).rejects.toThrow();
      expect(submit.getResult()).toBeUndefined();
    }
  });

  it("exposes the actual compact evidence impact enum", () => {
    const submit = createSubmitTool({
      requestId: "packet-1",
      role: "diagnosis-worker",
      phase: "evidence",
      output: "evidence",
    });
    const input = {
      conclusions: [],
      citations: [],
      constraints: [],
      risks: [],
      blockingQuestions: [],
      hints: {
        writeSet: [],
        verification: "none",
        agentsImpact: "no changes needed",
      },
    };
    expect(Value.Check(submit.tool.parameters, input)).toBe(false);
    expect(
      Value.Check(submit.tool.parameters, {
        ...input,
        hints: { ...input.hints, agentsImpact: "none" },
      }),
    ).toBe(true);
  });

  it("reports the precise citation field and remaining correction budget without echoing claims", async () => {
    const submit = tool();
    const bad = {
      ...draft(),
      evidence: [
        {
          claim: "PRIVATE CLAIM",
          path: "src/value.ts",
          line_start: 3,
          line_end: 2,
        },
      ],
    };
    let message = "";
    try {
      await execute(submit, bad);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("evidence[0].line_end");
    expect(message).toContain('"remainingCorrections":1');
    expect(message).not.toContain("PRIVATE CLAIM");
    await execute(submit, draft());
    expect(submit.getResult()).toBeDefined();
  });
});
