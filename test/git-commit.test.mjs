import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(packageDir, "skills", "git-commit", "SKILL.md");

describe("explicit-request Git commit Skill", () => {
  it("is declarative and activates only on an explicit commit request", () => {
    expect(existsSync(skillPath), "git-commit/SKILL.md must exist").toBe(true);
    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toMatch(/^---[\s\S]*name:\s*git-commit/m);
    expect(skill).toMatch(/explicit[\s\S]*(request|ask)/i);
    expect(skill).toMatch(
      /workflow completion[\s\S]*(does not|must not|never)/i,
    );
    expect(skill).toMatch(
      /Gate[\s\S]*(does not|must not|never)[\s\S]*authoriz/i,
    );
    expect(skill).toMatch(
      /installed[\s\S]*(does not|must not|never)[\s\S]*(commit|authoriz)/i,
    );
    expect(skill).not.toMatch(/\.mjs|\.js|\.py|scripts\//);
  });

  it("audits AGENTS and all staged and unstaged changes", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toMatch(/root[\s\S]*nested[\s\S]*AGENTS\.md/i);
    expect(skill).toMatch(/git status --short/);
    expect(skill).toMatch(/git diff(?! --staged)/);
    expect(skill).toMatch(/git diff --staged/);
    expect(skill).toMatch(/\.env/i);
    expect(skill).toMatch(/credential/i);
    expect(skill).toMatch(/private key/i);
    expect(skill).toMatch(/user[\s\S]*session[\s\S]*state/i);
    expect(skill).toMatch(/unrelated/i);
  });

  it("stages only an explicit safe path list for one logical commit", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toMatch(/one[\s\S]*logical[\s\S]*commit/i);
    expect(skill).toMatch(/git add -- <paths>/);
    expect(skill).toMatch(/explicit[\s\S]*path/i);
    expect(skill).toMatch(/Conventional Commit/i);
    expect(skill).toMatch(/actual[\s\S]*diff/i);
    expect(skill).toMatch(/ambigu[\s\S]*(unchanged|ask)/i);
    expect(skill).toMatch(/multiple[\s\S]*logical/i);
    expect(skill).toMatch(/deletion/i);
  });

  it("prohibits broad or history-changing commands", () => {
    const skill = readFileSync(skillPath, "utf8");
    for (const command of [
      "git add .",
      "git add -A",
      "git add -p",
      "--no-verify",
      "--amend",
      "reset",
      "force push",
      "git config",
    ]) {
      expect(skill).toContain(command);
    }
    expect(skill).toMatch(/prohibit|must not|never/i);
  });

  it("preserves staged state and reports hook failures without bypass", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toMatch(/hook[\s\S]*failure/i);
    expect(skill).toMatch(/report[\s\S]*(received|verbatim|original)/i);
    expect(skill).toMatch(/staged[\s\S]*preserv/i);
    expect(skill).toMatch(/not[\s\S]*bypass/i);
  });
});
