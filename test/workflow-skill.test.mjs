import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(packageDir, "skills", "abel-workflow", "SKILL.md");
const initPromptPath = path.join(packageDir, "prompts", "abel-init.md");
const read = (file) => readFileSync(file, "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`missing contract section: ${start}`);
  const until = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, until < 0 ? undefined : until);
}

describe("shared Abel workflow and Init contracts", () => {
  it("bundles one explicit-invocation-only shared workflow Skill", () => {
    expect(existsSync(skillPath), "abel-workflow/SKILL.md must exist").toBe(
      true,
    );
    const skill = read(skillPath);
    expect(skill).toMatch(/^---[\s\S]*name:\s*abel-workflow/m);
    expect(skill).toMatch(
      /description:[^\n]*only after an explicit \/abel-init/i,
    );
    expect(skill).toMatch(
      /Merely finding these files[\s\S]{0,220}does not activate/i,
    );
    expect(skill).toMatch(
      /do not carry stage authority into an ordinary engineering request/i,
    );
  });

  it("keeps one authoritative delivery, verification, and authority contract", () => {
    const skill = read(skillPath);
    expect(skill).toMatch(/Gate A[\s\S]*observable behavior/i);
    expect(skill).toMatch(/Gate B[\s\S]*technical implementation/i);
    expect(skill).toMatch(/Neither Gate grants tool permission/i);
    expect(skill).toMatch(/SHA-256/i);
    expect(skill).toMatch(/Requirement → Scenario → Verification → Task/);
    expect(skill).toMatch(/ImplementPlan/);
    expect(skill).toMatch(
      /vitest[\s\S]*package-script[\s\S]*static-check[\s\S]*steps/i,
    );
    expect(skill).toMatch(/Red[\s\S]*Green[\s\S]*Refactor/i);
    expect(skill).toMatch(/ABEL:AGENTS-INDEX:START/);
  });

  it("separates all four stage authorities", () => {
    const skill = read(skillPath);
    const stages = section(
      skill,
      "## Stage separation",
      "## Canonical ImplementPlan",
    );
    expect(stages).toMatch(/Init[\s\S]*no Subagent dispatch/i);
    expect(stages).toMatch(
      /Design[\s\S]*evidence and delivery compilation only/i,
    );
    expect(stages).toMatch(/Implement[\s\S]*durable change command surface/i);
    expect(stages).toMatch(
      /Diagnose[\s\S]*reproduce → falsify → failing regression → minimum repair/i,
    );
    expect(stages).toMatch(/Cross-stage calls fail closed/i);
  });

  it("keeps recoverable Implement failures free of workflow routing", () => {
    const skill = read(skillPath);
    const recovery = section(
      skill,
      "## Recovery versus approval",
      "## AGENTS indexes",
    );
    expect(recovery).toMatch(/recoverable Implement facts/i);
    expect(recovery).toMatch(/never select a workflow stage/i);
    expect(recovery).toMatch(/later `resume` starts a new operation budget/i);
    expect(recovery).toMatch(
      /approval-needed` only when continuing requires new authority/i,
    );
    expect(recovery).toMatch(/in-boundary repair as approval-needed/i);
    expect(recovery).not.toMatch(
      /design-required|return-to-design|\/abel-design|nextStep|recommended next/i,
    );
  });

  it("makes Init deterministic, local, safe, and idempotent", () => {
    const init = read(initPromptPath);
    expect(init).toMatch(/Load the bundled `abel-workflow` Skill before/i);
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

  it("keeps AGENTS work parent-owned and managed-only", () => {
    const skill = read(skillPath);
    const agents = section(
      skill,
      "## AGENTS indexes",
      "## Parent and Worker authority",
    );
    expect(agents).toMatch(/Design audits AGENTS read-only/i);
    for (const impact of [
      "none",
      "update-existing",
      "create-index",
      "remove-index",
    ]) {
      expect(agents).toContain(impact);
    }
    expect(agents).toMatch(/Implement applies the sealed operation/i);
    expect(agents).toMatch(/preserves every byte outside/i);
    expect(agents).toMatch(/Worker never receives an AGENTS write path/i);
  });
});
