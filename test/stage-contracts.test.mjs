import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const read = (relative) =>
  readFileSync(path.join(packageDir, relative), "utf8");
const design = read("prompts/abel-design.md");
const implement = read("prompts/abel-implement.md");
const diagnose = read("prompts/abel-diagnose.md");

function section(source, start, end) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`missing contract section: ${start}`);
  const until = end ? source.indexOf(end, from + start.length) : -1;
  return source.slice(from, until < 0 ? undefined : until);
}

const forbiddenStageRouting = [
  /design-required/i,
  /design-contract/i,
  /return-to-design/i,
  /recommended next (workflow )?step/i,
  /nextStep/,
];

describe("Design stage contract", () => {
  it("uses bounded read-only evidence packets without an implementation launch", () => {
    expect(design).toMatch(/`abel_dispatch`/);
    expect(design).toMatch(/`action:\s*["']run["']`/);
    expect(design).toMatch(/["']stage["']:\s*["']abel-design["']/);
    expect(design).toMatch(/["']runId["']:\s*["']<durable-design-run-id>["']/);
    expect(design).toMatch(/Each packet is one tool call/i);
    expect(design).toMatch(/sibling calls in the same assistant turn/i);
    expect(design).toMatch(/Do not wrap them in a `requests` array/i);
    expect(design).toMatch(/never launches an implementation Worker/i);
    expect(design).toMatch(/must not run product tests/i);
    expect(design).toMatch(/never[\s\S]{0,180}Red\/Green\/Refactor/i);
  });

  it("keeps repository writes inside the approved change root", () => {
    expect(design).toMatch(/Before explicit Gate A approval[\s\S]*read-only/i);
    expect(design).toMatch(/After Gate A[\s\S]*change root/i);
    expect(design).toMatch(
      /parent tool set[\s\S]{0,240}`read`, `grep`, `find`, and `ls`/i,
    );
    expect(design).toMatch(/"operation":"write-artifact"/);
    expect(design).toMatch(/"operation":"delete-artifact"/);
    expect(design).toMatch(/path relative to the active change root/i);
    expect(design).toMatch(/gate-a\.yaml[\s\S]{0,160}ready\.yaml/i);
    expect(design).toMatch(/implement-plan\.json[\s\S]{0,160}unreachable/i);
    expect(design).toMatch(
      /Every repository `AGENTS\.md` remains read-only throughout Design/i,
    );
    expect(design).toMatch(/never edit the index here/i);
  });

  it("compiles one executable delivery before reporting readiness", () => {
    expect(design).toMatch(/ImplementPlan/);
    expect(design).toMatch(/"operation":"validate-plan-draft"/);
    expect(design).toMatch(/structured diagnostics/i);
    expect(design).toMatch(/"operation":"compile-plan"/);
    expect(design).toMatch(/"operation":"finalize-delivery"/);
    expect(design).toMatch(/implement-plan\.json/);
    expect(design).toMatch(/verification closure/i);
    expect(design).toMatch(/Requirement → Scenario → Verification → Task/);
    expect(design).toMatch(/regular-file outputs/i);
    expect(design).toMatch(/AGENTS operation/i);
    expect(design).toMatch(/READY_TO_IMPLEMENT/);
    expect(design).toMatch(/Never send `operation: "finish"`/i);
    expect(design).toMatch(/\{"action":"finish"\}/);
  });

  it("does not reopen approvals for mechanical delivery repair", () => {
    const recovery = section(design, "## Recovery without approval loops");
    expect(recovery).toMatch(/mechanical hash/i);
    expect(recovery).toMatch(/does not reopen a user decision/i);
    expect(recovery).toMatch(
      /Reopen Gate A only for changed behavior authority/i,
    );
    expect(recovery).toMatch(/compiler regenerates Gate B/i);
  });

  it("seals compatibility and public-surface impact closure", () => {
    expect(design).toMatch(/affected existing tests and fixtures/i);
    expect(design).toMatch(/only from newly added tests is insufficient/i);
    expect(design).toMatch(/route authorization/i);
    expect(design).toMatch(/page state/i);
    expect(design).toMatch(/API response and contract/i);
    expect(design).toMatch(/public HTML\/template\/theme/i);
    expect(design).toMatch(/browser E2E/i);
  });
});

describe("Implement stage contract", () => {
  it("exposes only the closed change-oriented command surface", () => {
    const commands = [...implement.matchAll(/"command":"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(commands).toEqual([
      "start",
      "status",
      "resume",
      "rebind",
      "cancel",
      "discard",
    ]);
    expect(implement).toMatch(/never send `action: "run"`/i);
    expect(implement).toMatch(/caller-owned snapshots/i);
    expect(implement).toMatch(/status[\s\S]{0,120}local/i);
    expect(implement).toMatch(
      /same operation id[\s\S]{0,120}committed outcome/i,
    );
  });

  it("validates trusted delivery in a fresh context without repeating approval", () => {
    expect(implement).toMatch(/fresh context/i);
    expect(implement).toMatch(/ready\.yaml/);
    expect(implement).toMatch(/implement-plan\.json/);
    expect(implement).toMatch(/raw and canonical hashes/i);
    expect(implement).toMatch(/strict\/planning status/i);
    expect(implement).toMatch(
      /does not ask the user to approve unchanged decisions/i,
    );
  });

  it("keeps ordinary failures recoverable inside the same Implement run", () => {
    const recovery = section(
      implement,
      "## Failure attribution and recovery",
      "## The only approval-needed boundary",
    );
    for (const value of [
      "artifact",
      "wrong-Red identity",
      "transport failure",
      "environment",
      "pre-existing",
      "introduced",
      "unresolved",
      "workspace-revision-stale",
      "result-limit",
    ]) {
      expect(recovery).toContain(value);
    }
    expect(recovery).toMatch(/bounded automatic attempt policy/i);
    expect(recovery).toMatch(/after exhaustion pause/i);
    expect(recovery).toMatch(
      /Resume[\s\S]{0,160}baseline facts and completed phases are reused/i,
    );
    expect(recovery).toMatch(/reopen the owning task as `repairable`/i);
    expect(recovery).toMatch(/record `repair-verified`/i);
    expect(recovery).toMatch(/No item above carries stage-routing metadata/i);
    for (const pattern of forbiddenStageRouting)
      expect(recovery).not.toMatch(pattern);
  });

  it("uses approval-needed only for actual authority expansion", () => {
    const approval = section(
      implement,
      "## The only approval-needed boundary",
      "## AGENTS and tracking",
    );
    expect(approval).toMatch(
      /only when continuing requires authority not present/i,
    );
    expect(approval).toMatch(/new observable behavior/i);
    expect(approval).toMatch(/new\/changed dependency/i);
    expect(approval).toMatch(
      /undeclared write\/delete target or a read outside sealed discovery roots/i,
    );
    expect(approval).toMatch(/changed verification contract/i);
    expect(approval).toMatch(/AGENTS target\/impact\/managed block change/i);
    expect(approval).toMatch(/never `approval-needed`/i);
    expect(approval).toMatch(/endpoint outage/i);
    expect(approval).toMatch(/introduced in-boundary repair/i);
    expect(approval).toMatch(/`decisionBatch.items`/);
    expect(approval).toMatch(/"action":"amend"/);
    expect(approval).toMatch(/does not activate Design/i);
    expect(approval).toMatch(/stale batch ids/i);
    expect(approval).not.toMatch(/return-to-design|nextStep/i);
    for (const pattern of forbiddenStageRouting)
      expect(approval).not.toMatch(pattern);
  });

  it("owns Red-Green-Refactor, cumulative verification, and AGENTS checkpoints", () => {
    expect(implement).toMatch(
      /target-contract, task-affected, and full-suite baselines/i,
    );
    expect(implement).toMatch(/pre-existing failure remains separate/i);
    expect(implement).toMatch(/Red[\s\S]*Green[\s\S]*Refactor/i);
    expect(implement).toMatch(/private cumulative revision/i);
    expect(implement).toMatch(/managed-only AGENTS checkpoint/i);
    expect(implement).toMatch(/never gives an AGENTS write path to a Worker/i);
  });

  it("reports success only for durable completion", () => {
    expect(implement).toMatch(/queued[\s\S]*recovering[\s\S]*nonterminal/i);
    expect(implement).toMatch(/Tool-call settlement is not success/i);
    expect(implement).toMatch(/durable state is `completed`/i);
    expect(implement).toMatch(
      /Never hide an incomplete run behind a success checkmark/i,
    );
    expect(implement).toMatch(
      /Do not archive, publish, release, stage, or commit implicitly/i,
    );
  });
});

describe("Diagnose and browser-E2E contracts", () => {
  it("keeps Diagnose independent and evidence-first", () => {
    expect(diagnose).toMatch(/not an Implement recovery route/i);
    expect(diagnose).toMatch(
      /never becomes an instruction to change workflow stage/i,
    );
    expect(diagnose).toMatch(
      /Reproduce[\s\S]*falsify[\s\S]*regression[\s\S]*minimum repair/i,
    );
    expect(diagnose).toMatch(
      /parent runs reproduction and verification commands/i,
    );
    expect(diagnose).toMatch(/scope-decision-required/i);
    expect(diagnose).not.toMatch(/return-to-design|\/abel-design|nextStep/i);
  });

  it("pauses only an approved browser check when dev-browser is absent", () => {
    const text = `${design}\n${implement}\n${diagnose}`;
    expect(text).toMatch(/dev-browser/);
    expect(text).toMatch(/approved browser E2E/i);
    expect(text).toMatch(/pause only that check/i);
    expect(text).toMatch(/does not block unrelated tasks or stages/i);
  });
});
