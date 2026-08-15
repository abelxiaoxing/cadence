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
    expect(implement).toMatch(/return[\s\S]*Design/i);
    expect(implement).toMatch(/Red[\s\S]*Green[\s\S]*Refactor/i);
    expect(implement).toMatch(/stable[\s\S]*AGENTS/i);
    expect(implement).toMatch(/no new[\s\S]*failure/i);
  });

  it("uses exact affected commands as an Implement-only dynamic repair boundary", () => {
    const text = `${implement}\n${shared}`;
    expect(text).toMatch(
      /exact affected[\s-]*suite commands[\s\S]*dynamic[\s\S]*repair boundary/i,
    );
    expect(text).toMatch(/outside[\s\S]*(original module|target-file list)/i);
    expect(text).toMatch(/pre-existing[\s\S]*separate[\s\S]*task Red/i);
    expect(text).toMatch(/verified root cause[\s\S]*minimum repair/i);
    expect(text).toMatch(/pre-existing[\s\S]*introduced[\s\S]*unresolved/i);
    expect(text).toMatch(/unresolved[\s\S]*block/i);
    expect(text).toMatch(/environmental[\s\S]*executable recovery condition/i);
    expect(text).toMatch(/speculative[\s\S]*(edit|repair)/i);
    expect(text).toMatch(/substantive decision[\s\S]*return[\s\S]*Design/i);
    expect(text).toMatch(
      /full-suite-only[\s\S]*outside[\s\S]*automatic scope/i,
    );
    expect(text).toMatch(/all target and affected[\s\S]*green/i);
    expect(text).toMatch(
      /context and final report[\s\S]*not[\s\S]*state file/i,
    );
  });

  it("does not archive, publish, or commit implicitly", () => {
    expect(implement).toMatch(/must not[\s\S]*archive/i);
    expect(implement).toMatch(/must not[\s\S]*publish/i);
    expect(implement).toMatch(/must not[\s\S]*commit|no implicit commit/i);
  });
});

describe("Diagnose and browser-E2E contracts", () => {
  it("requires evidence, falsification, and regression-first repair", () => {
    expect(diagnose).toMatch(/reproduce/i);
    expect(diagnose).toMatch(/falsif/i);
    expect(diagnose).toMatch(/root cause/i);
    expect(diagnose).toMatch(/regression[\s\S]*fail/i);
    expect(diagnose).toMatch(/minimum[\s\S]*(repair|fix)/i);
    expect(diagnose).toMatch(/new behavior|architecture/i);
    expect(diagnose).toMatch(/return[\s\S]*Design/i);
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
