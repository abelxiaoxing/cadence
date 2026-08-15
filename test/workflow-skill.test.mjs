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
});
