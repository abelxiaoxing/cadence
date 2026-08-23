import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(packageDir, "skills", "abel-workflow", "SKILL.md");
const initPromptPath = path.join(packageDir, "prompts", "abel-init.md");
const read = (file) => readFileSync(file, "utf8");

describe("shared Abel workflow and Init contracts", () => {
  it("bundles one authoritative shared workflow Skill", () => {
    expect(existsSync(skillPath), "abel-workflow/SKILL.md must exist").toBe(
      true,
    );
    const skill = read(skillPath);
    expect(skill).toMatch(/^---[\s\S]*name:\s*abel-workflow/m);
    expect(skill).toMatch(/Gate A[\s\S]*behavior/i);
    expect(skill).toMatch(/Gate B[\s\S]*technical/i);
    expect(skill).toMatch(
      /not[\s\S]*tool permission|not[\s\S]*permission authorization/i,
    );
    expect(skill).toMatch(/receipt/i);
    expect(skill).toMatch(/SHA-256/i);
    expect(skill).toMatch(
      /Requirement[\s\S]*Scenario[\s\S]*Verification[\s\S]*Task/i,
    );
    expect(skill).toMatch(/Red[\s\S]*Green[\s\S]*Refactor/i);
    expect(skill).toMatch(/baseline/i);
    expect(skill).toMatch(/ABEL:AGENTS-INDEX:START/);
    expect(skill).toMatch(/parent[\s\S]*subagent/i);
  });

  it("makes Init load the core Skill before any writes", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/load[\s\S]*abel-workflow/i);
    expect(init).toMatch(/before[\s\S]*(modif|writ)/i);
    expect(init).toMatch(/unavailable[\s\S]*stop/i);
    expect(init).toMatch(/restore|reinstall/i);
  });

  it("defines research-skill discovery without blocking repair", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/context7-auto-research/);
    expect(init).toMatch(/grok-search/);
    expect(init).toMatch(/resolved[\s\S]*path/i);
    expect(init).toMatch(/missing[\s\S]*not fully ready/i);
    expect(init).toMatch(
      /missing[\s\S]*(does not|must not)[\s\S]*prevent[\s\S]*(OpenSpec|AGENTS)/i,
    );
    expect(init).toMatch(/git-commit[\s\S]*dev-browser[\s\S]*time/);
    expect(init).toMatch(/not required|do not check/i);
  });

  it("selects one toolchain and safely installs then validates OpenSpec", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/Bun[\s\S]*otherwise[\s\S]*npm/i);
    expect(init).toMatch(/single[\s\S]*toolchain/i);
    expect(init).toMatch(/@fission-ai\/openspec@latest/);
    expect(init).toMatch(/global/i);
    expect(init).toMatch(/recheck|re-check/i);
    expect(init).toMatch(/original[\s\S]*error/i);
    expect(init).toMatch(/executable[\s\S]*remediation/i);
    expect(init).toMatch(/without[\s\S]*(force|--force)/i);
    expect(init).toMatch(/schema[\s\S]*template/i);
  });

  it("preserves unrelated and human AGENTS content", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/current working directory/i);
    expect(init).toMatch(/baseline[\s\S]*dirty/i);
    expect(init).toMatch(/nested[\s\S]*repository/i);
    expect(init).toMatch(/human-authored/i);
    expect(init).toMatch(/managed[\s\S]*block/i);
    expect(init).toMatch(/must not[\s\S]*edit[\s\S]*openspec\/AGENTS\.md/i);
  });

  it("separates Design audit-only indexes from Implement checkpoints", () => {
    const skill = read(skillPath);
    expect(skill).toMatch(/Design[\s\S]{0,240}AGENTS[\s\S]{0,160}read-only/i);
    expect(skill).toMatch(
      /Design[\s\S]{0,300}read-only[\s\S]{0,300}(not inherited|does not apply)[\s\S]{0,180}Implement/i,
    );
    expect(skill).toMatch(/update-existing/);
    expect(skill).toMatch(/create-index/);
    expect(skill).toMatch(/remove-index/);
    expect(skill).toMatch(/parent[\s\S]{0,220}stable[\s-]*task checkpoint/i);
    expect(skill).toMatch(
      /subagent[\s\S]{0,160}(never|must not)[\s\S]{0,100}AGENTS/i,
    );
    expect(skill).toMatch(/approved[\s\S]{0,180}AGENTS path/i);
    expect(skill).toMatch(/managed region/i);
  });

  it("[SLICE-5:pi-tool-error] keeps Implement blockers free of workflow control", () => {
    const skill = read(skillPath);
    const implementContract = skill.slice(
      skill.indexOf("## Verification discipline"),
      skill.indexOf("## Parent and subagent authority"),
    );
    expect(implementContract).not.toBe("");
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
      /artifact-correction-required/i,
      /reasonCode/i,
      /artifact-invalid/i,
      /transport-failed/i,
      /environment-unavailable/i,
      /result-too-large/i,
      /split condition/i,
    ]) {
      expect(implementContract).not.toMatch(pattern);
    }
    expect(implementContract).toMatch(/red-not-witnessed/i);
    expect(implementContract).toMatch(/attempts-exhausted/i);
    expect(implementContract).toMatch(/kind:\s*["'`]?environment/i);
    expect(implementContract).toMatch(/result-limit/i);
    expect(skill).toMatch(/approval[- ]boundary|批准边界/i);
    expect(skill).toMatch(/Implement[\s\S]{0,240}(block|阻塞)/i);
    expect(skill).toMatch(
      /Diagnose[\s\S]{0,260}reproduce[\s\S]{0,260}falsif[\s\S]{0,260}regression[\s\S]{0,260}minimum repair/i,
    );
  });
});
