import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  formatSkillsForPrompt,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const initPromptPath = path.join(packageDir, "prompts", "abel-init.md");
const read = (file) => readFileSync(file, "utf8");

describe("self-contained stage resources", () => {
  it("discovers only independent skills and has no workflow Skill dependency", () => {
    const { skills, diagnostics } = loadSkillsFromDir({
      dir: path.join(packageDir, "skills"),
      source: "package",
    });
    expect(diagnostics).toEqual([]);
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      "context7-auto-research",
      "git-commit",
      "grok-search",
    ]);
    expect(formatSkillsForPrompt(skills)).not.toContain("abel-workflow");
    expect(
      existsSync(path.join(packageDir, "skills/abel-workflow/SKILL.md")),
    ).toBe(false);
    for (const stage of ["init", "design", "implement", "diagnose"]) {
      const prompt = read(path.join(packageDir, `prompts/abel-${stage}.md`));
      expect(prompt).not.toContain("abel-workflow");
      expect(prompt).toContain(
        `only when the user explicitly invokes \`/abel-${stage}\``,
      );
      expect(prompt).toContain(`<!-- ABEL:PROMPT:abel-${stage} -->`);
    }
  });

  it("makes Init deterministic, local, safe, and idempotent", () => {
    const init = read(initPromptPath);
    expect(init).not.toContain("abel-workflow");
    expect(init).toMatch(/Init performs no Subagent or `abel_dispatch` work/i);
    expect(init).toMatch(/Choose Bun when usable, otherwise npm/i);
    expect(init).toMatch(/use only that toolchain for this run/i);
    expect(init).toMatch(/@fission-ai\/openspec@latest/);
    expect(init).toMatch(/Never use `--force`/i);
    expect(init).toMatch(/baseline dirty state/i);
    expect(init).toMatch(/human-authored AGENTS text/i);
    expect(init).toMatch(/nested repository boundary/i);
    expect(init).toMatch(/managed regions/i);
    expect(init).toMatch(/do not cross nested repositories/i);
    expect(init).toMatch(
      /A second identical Init must produce no additional changes/i,
    );
  });

  it("reports optional research-Skill gaps without blocking project repair", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/context7-auto-research/);
    expect(init).toMatch(/grok-search/);
    expect(init).toMatch(/resolved paths/i);
    expect(init).toMatch(/absence does not prevent OpenSpec or AGENTS repair/i);
    expect(init).toMatch(/final readiness is `partial`/i);
    expect(init).toMatch(/git-commit[\s\S]*dev-browser[\s\S]*time Skill/i);
    expect(init).toMatch(/none is an Init prerequisite/i);
  });
});
