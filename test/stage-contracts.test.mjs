import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const read = (relative) =>
  readFileSync(path.join(packageDir, relative), "utf8");
const design = read("prompts/abel-design.md");
const implement = read("prompts/abel-implement.md");
const diagnose = read("prompts/abel-diagnose.md");
const shared = read("skills/abel-workflow/SKILL.md");
const sharedImplement = shared.slice(
  shared.indexOf("## Verification discipline"),
  shared.indexOf("## Parent and subagent authority"),
);

describe("Design stage contract", () => {
  it("keeps new Design read-only through explicit Gate A", () => {
    expect(design).toMatch(/read-only/i);
    expect(design).toMatch(/blocking[\s\S]*(decision|ambigu)/i);
    expect(design).toMatch(/explicit[\s\S]*Gate A/i);
    expect(design).toMatch(/wait/i);
    expect(design).toMatch(/after Gate A[\s\S]*change root/i);
  });

  it("validates resumed delivery and reports readiness only when complete", () => {
    expect(design).toMatch(/--change/);
    expect(design).toMatch(/receipt/i);
    expect(design).toMatch(/hash/i);
    expect(design).toMatch(/trace/i);
    expect(design).toMatch(/strict/i);
    expect(design).toMatch(/READY_TO_IMPLEMENT/);
    expect(design).toMatch(/artifact[\s\S]*(inconsistent|invalid|earliest)/i);
  });

  it("[SLICE-5:pi-tool-error] emits one fixed task boundary and phase-local attempts", () => {
    expect(design).toMatch(/TaskBoundary/);
    expect(design).toMatch(/open-task/);
    expect(design).toMatch(/phase-attempt/);
    expect(design).toMatch(/first|initial|首次|初始/i);
    expect(design).toMatch(/Red/);
    expect(design).toMatch(
      /(once|one time|exactly once|一次)[\s\S]{0,240}(boundary|边界)/i,
    );
    expect(design).toMatch(
      /(later|subsequent|后续)[\s\S]{0,220}(dynamic|snapshot|动态|快照)/i,
    );
  });

  it("scopes AGENTS read-only authority to Design only", () => {
    expect(design).toMatch(/Design stage|Design 阶段/i);
    expect(design).toMatch(/AGENTS\.md[\s\S]{0,160}(read-only|只读)/i);
    expect(design).toMatch(/audit|审计/i);
    expect(design).toMatch(/impact|影响/i);
    expect(design).toMatch(/must not edit|不得编辑|绝不编辑/i);
    expect(design).toMatch(
      /(does not apply|不继承|不适用)[\s\S]{0,160}(Implement|实施)/i,
    );
  });
});

describe("Implement stage contract", () => {
  it("validates a fresh-context handoff without repeating Gates", () => {
    expect(implement).toMatch(/fresh[\s-]*context/i);
    expect(implement).toMatch(/receipt/i);
    expect(implement).toMatch(/hash/i);
    expect(implement).toMatch(/trace/i);
    expect(implement).toMatch(/strict/i);
    expect(implement).toMatch(/without[\s\S]*(request|repeat)[\s\S]*Gate/i);
  });

  it("separates baselines and requires exact Red attribution", () => {
    expect(implement).toMatch(
      /target[\s\S]*affected[\s-]*suite[\s\S]*full[\s-]*suite/i,
    );
    expect(implement).toMatch(/pre-existing[\s\S]*(separate|cannot|never)/i);
    expect(implement).toMatch(/Red[\s\S]*(wrong reason|specified|expected)/i);
    expect(implement).toMatch(/block|阻塞/i);
    expect(implement).toMatch(/Red[\s\S]*Green[\s\S]*Refactor/i);
    expect(implement).toMatch(/stable[\s\S]*AGENTS/i);
    expect(implement).toMatch(/no new[\s\S]*failure/i);
  });

  it("keeps every affected repair inside the fixed task boundary", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(/immutable `?TaskBoundary`?|fixed task boundary/i);
    expect(text).toMatch(/affected verification/i);
    expect(text).toMatch(/never expands|不得扩大|不扩大/i);
    expect(text).toMatch(/pre-existing[\s\S]*separate[\s\S]*task Red/i);
    expect(text).toMatch(
      /minimum[\s-]*in-boundary repair|最小[\s\S]*boundary/i,
    );
    expect(text).toMatch(/pre-existing[\s\S]*introduced[\s\S]*unresolved/i);
    expect(text).toMatch(/unresolved[\s\S]*block/i);
    expect(text).toMatch(/environmental[\s\S]*terminally block/i);
    expect(text).toMatch(/speculative[\s\S]*edit/i);
    expect(text).toMatch(/full-suite-only[\s\S]*outside[\s\S]*task scope/i);
    expect(text).toMatch(/all target and affected[\s\S]*green/i);
    expect(text).toMatch(
      /context and (the )?final report[\s\S]*not[\s\S]*state file/i,
    );
  });

  it("classifies generated artifact failures without stage routing", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(
      /syntax[\s\S]{0,240}import\/load[\s\S]{0,240}no[- ]test[\s\S]{0,240}malformed[- ]diff[\s\S]{0,240}wrong[- ]Red[- ]identity[\s\S]{0,240}(generated )?implementation[- ]artifact rejection/i,
    );
    expect(text).toMatch(
      /artifact rejection[\s\S]{0,300}(finite|bounded)[\s\S]{0,160}(correction|repair) budget/i,
    );
    expect(text).toMatch(
      /(artifact correction budget is exhausted|attempts-exhausted|产物修正预算耗尽)[\s\S]{0,300}(block|阻塞)/i,
    );
  });

  it("does not route a generated or wrong-identity Red automatically to Design", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(
      /wrong[- ]Red[- ]identity[\s\S]{0,240}implementation[- ]artifact rejection/i,
    );
    expect(text).toMatch(
      /wrong[- ]Red[\s\S]{0,300}(finite|bounded)[\s\S]{0,160}(artifact[- ]correction|correction path)/i,
    );
    expect(text).not.toMatch(/wrong reason[\s\S]{0,80}returns? to Design/i);
    expect(text).not.toMatch(
      /fails for another reason[\s\S]{0,80}return to Design/i,
    );
  });

  it("corrects a passing Red artifact unless a contract change is separately proven", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(
      /(?:Red candidate|Red 候选)[\s\S]{0,240}(?:passes|通过)[\s\S]{0,300}(?:code:\s*)?`?red-not-witnessed`?/i,
    );
    expect(text).toMatch(/kind:\s*["'`]?artifact["'`]?/i);
    expect(text).toMatch(/kind:\s*["'`]?retry["'`]?/i);
    expect(text).not.toMatch(
      /artifact-correction-required|reasonCode|artifact-invalid|transport-failed|environment-unavailable|result-too-large|split condition/i,
    );
  });

  it("makes approved AGENTS checkpoints normal parent-only Implement work", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(
      /Design stage|Design 阶段[\s\S]{0,260}(read-only|只读)[\s\S]{0,260}(does not apply|不继承|不适用)[\s\S]{0,160}(Implement|实施)/i,
    );
    for (const impact of [
      "none",
      "update-existing",
      "create-index",
      "remove-index",
    ]) {
      expect(text).toContain(impact);
    }
    expect(text).toMatch(/parent|父代理/i);
    expect(text).toMatch(/subagent|worker|子代理/i);
    expect(text).toMatch(/never|始终|绝不|不能/i);
    expect(text).toMatch(/stable[\s-]*(task )?checkpoint|稳定任务检查点/i);
    expect(text).toMatch(/ABEL:AGENTS-INDEX:START/);
    expect(text).toMatch(
      /AGENTS[\s\S]{0,300}(normal|正常)[\s\S]{0,160}(Implement|实施)/i,
    );
  });

  it("[SLICE-5:pi-tool-error] exposes blockers without recovery control", () => {
    const text = `${implement}\n${sharedImplement}`;
    for (const pattern of [
      /design-required/i,
      /design-contract/i,
      /return-to-design/i,
      /\/abel-design/i,
      /branchBlocked/i,
      /dependentsBlocked/i,
      /dependent successors?/i,
      /recommended next (workflow )?step/i,
      /nextStep/,
    ]) {
      expect(text).not.toMatch(pattern);
    }
    expect(text).toMatch(/approval[- ]boundary|批准边界/i);
    expect(text).toMatch(/current task|当前任务/i);
    expect(text).toMatch(/block|阻塞/i);
  });

  it("requires impact closure for public routes, authorization, APIs, and HTML", () => {
    const text = `${design}\n${implement}\n${shared}`;
    expect(text).toMatch(/impact closure|影响闭包/i);
    expect(text).toMatch(/route authorization|路由授权/i);
    expect(text).toMatch(/page state|页面状态/i);
    expect(text).toMatch(/API response|API 响应/i);
    expect(text).toMatch(/public HTML|公共 HTML/i);
    expect(text).toMatch(/E2E[\s\S]{0,260}theme|theme[\s\S]{0,260}E2E/i);
    expect(text).toMatch(/authorization|授权/i);
    expect(text).toMatch(/template|模板/i);
    expect(text).toMatch(/API contract|API 契约/i);
    expect(text).toMatch(
      /affected[- ]suite[\s\S]{0,200}((new|新增)[\s\S]{0,100}(only|不能只|不得只)|(only|不能只|不得只)[\s\S]{0,100}(new|新增))/i,
    );
    expect(text).toMatch(
      /(old|existing|旧|既有)[\s\S]{0,180}(test|fixture|测试)[\s\S]{0,260}(approved|boundary|批准|边界)/i,
    );
  });

  it("does not archive, publish, or commit implicitly", () => {
    expect(implement).toMatch(/must not[\s\S]*archive/i);
    expect(implement).toMatch(/must not[\s\S]*publish/i);
    expect(implement).toMatch(/must not[\s\S]*commit|no implicit commit/i);
  });
});

describe("Diagnose and browser-E2E contracts", () => {
  it("[SLICE-5:pi-tool-error] preserves regression-first repair without nextStep", () => {
    expect(diagnose).toMatch(/reproduce/i);
    expect(diagnose).toMatch(/falsif/i);
    expect(diagnose).toMatch(/root cause/i);
    expect(diagnose).toMatch(/regression[\s\S]*fail/i);
    expect(diagnose).toMatch(/minimum[\s\S]*(repair|fix)/i);
    expect(diagnose).toMatch(/new behavior|architecture/i);
    expect(diagnose).toMatch(/return[\s\S]*Design/i);
    expect(diagnose).not.toMatch(/nextStep|recommended next (workflow )?step/i);
  });

  it("blocks only approved browser-E2E tasks when dev-browser is absent", () => {
    const text = `${shared}\n${design}\n${implement}\n${diagnose}`;
    expect(text).toMatch(/dev-browser/);
    expect(text).toMatch(/browser E2E/);
    expect(text).toMatch(/only[\s\S]*approved/i);
    expect(text).toMatch(/missing|unavailable/i);
    expect(text).toMatch(/executable[\s\S]*remediation/i);
    expect(text).toMatch(/does not block|must not block/i);
  });
});
