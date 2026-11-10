/** Fast owner-loop regression: no service, SDK subprocess, provider or Git process. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

vi.mock("../src/service/workflow-git.ts", async (original) => {
  const actual =
    await original<typeof import("../src/service/workflow-git.ts")>();
  return {
    ...actual,
    workingSnapshot: async () => ({ git: false, paths: new Map() }),
    sourceIdentityAsync: async () => "known-source-state",
  };
});
it("one admitted delivery recovers implement failure, preserves partial work, learns and verifies without user Send", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cadence-delivery-"));
  const definition = plan();
  definition.delivery = "working-copy";
  definition.tasks = [definition.tasks[0]];
  definition.documents = ["knowledge.md"];
  const records = new Map<string, unknown>();
  const phases: string[] = [];
  let implementations = 0,
    checks = 0,
    reviews = 0;
  const proposal = { plan: definition, model: {} };
  const live = {
    execution: {},
    abort: new AbortController(),
    proposal,
    delivered: new Set(),
    notes: [],
    run: {
      id: randomUUID(),
      epoch: randomUUID(),
      goal: definition.goal,
      status: "running",
      phase: "implementing",
      steps: [],
      revision: 0,
    },
  };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd,
    root: cwd,
    o: {
      owner: { state: "idle" },
      secrets: () => [],
      coordination: {
        files: {
          read: (path: string) =>
            records.has(path)
              ? { bytes: Buffer.from(JSON.stringify(records.get(path))) }
              : undefined,
        },
      },
    },
    assertRunning: () => {
      if (live.abort.signal.aborted) throw new Error("canceled");
    },
    save: () => phases.push(live.run.phase),
    write: (path: string, value: unknown) => {
      records.set(path, value);
      return { bytes: Buffer.from(JSON.stringify(value)) };
    },
    setup: vi.fn(async () => {}),
    publish: vi.fn(),
    check: async (
      _live: unknown,
      _cwd: string,
      _check: unknown,
      title: string,
    ) => {
      checks++;
      const step = owner.step(live, title, "check");
      const result = {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: "",
        output: "real fixture check evidence",
        durationMs: 1,
        truncated: false,
        signal: null,
      };
      owner.finishStep(live, step, result);
      return { result, step };
    },
    worker: async (
      _live: unknown,
      _cwd: string,
      id: string,
      prompt: string,
      readonly: boolean,
      _version: unknown,
      _roots: unknown,
      kind: string,
    ) => {
      const step = owner.step(
        live,
        id,
        kind ?? (readonly ? "review" : "implementation"),
        randomUUID(),
      );
      let text: string,
        report = null;
      if (kind === "diagnosis") {
        const failed = live.run.steps.find(
          (s: { status: string }) => s.status === "failed",
        )! as { id: string };
        expect(readFileSync(join(cwd, "partial.txt"), "utf8")).toBe(
          "preserved",
        );
        text = JSON.stringify({
          action: "continue",
          cause: "report after partial output",
          evidence: [failed.id],
          strategy: "finish the missing assignment using preserved output",
          work: [],
        });
        expect(prompt).toContain("native facts");
      } else if (kind === "knowledge") {
        expect(prompt).toContain("real fixture check evidence");
        writeFileSync(
          join(cwd, "knowledge.md"),
          "Verified fixture fact, with test reference.",
        );
        report = {
          status: "completed",
          summary: "Updated existing topic using evidence",
        };
        text = JSON.stringify(report);
      } else if (readonly) {
        reviews++;
        text = '{"approved":true,"summary":"inspected","blockingIssues":[]}';
      } else {
        implementations++;
        writeFileSync(join(cwd, "partial.txt"), "preserved");
        report =
          implementations === 1
            ? {
                status: "blocked",
                summary: "Partial output retained; remaining behavior needed",
              }
            : {
                status: "completed",
                summary: "Remaining behavior implemented",
              };
        text = JSON.stringify(report);
      }
      const result = {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text,
        output: "",
        durationMs: 1,
        truncated: false,
        signal: null,
      };
      owner.finishStep(live, step, result);
      return { result, step, report };
    },
  });
  await owner.implement(live, proposal);
  expect(implementations).toBe(2);
  expect(live.run.revision).toBe(1);
  expect(phases).toContain("recovering");
  expect(phases).toContain("learning");
  expect(checks).toBe(3);
  expect(reviews).toBe(3);
  expect(readFileSync(join(cwd, "knowledge.md"), "utf8")).toContain("Verified");
  expect(owner.setup).toHaveBeenCalledTimes(1);
  expect(owner.publish).toHaveBeenCalledTimes(1);
  expect([...records.keys()].some((p) => p.includes("revisions/1.json"))).toBe(
    true,
  );
  expect(
    live.run.steps.some((s: { status: string }) => s.status === "failed"),
  ).toBe(true);
});
