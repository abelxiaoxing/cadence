import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Activation } from "../src/activation.ts";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { PacketRuntime } from "../src/packet-runtime.ts";
import {
  buildSubagentPrompt,
  runSubagentProcess,
} from "../src/subagent-process.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  delete process.env.CADENCE_PI_EXECUTABLE;
});

function child(script: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-packet-process-"));
  roots.push(root);
  const executable = path.join(root, "pi");
  writeFileSync(executable, `#!/bin/sh\n${script}\n`);
  chmodSync(executable, 0o755);
  process.env.CADENCE_PI_EXECUTABLE = executable;
  return executable;
}

function runtime() {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new PacketRuntime({ activation });
}

const context = {
  cwd: process.cwd(),
  modelRegistry: {
    getProvider: () => undefined,
    getApiKeyAndHeaders: async () => ({ ok: false as const }),
  },
};

function packet(stage: "abel-design" | "abel-diagnose") {
  return {
    stage,
    role: stage === "abel-design" ? "design-explorer" : "diagnosis-worker",
    ...(stage === "abel-design" ? { runId: "run-process-test" } : {}),
    id: `${stage}-process-test`,
    phase: "evidence",
    objective: "inspect the fixture",
    roots: ["."],
    context: { agents: "", contract: "" },
    declared: { read: ["."], write: [], conflicts: [], resources: [] },
    output: "evidence",
  } as const;
}

const evidence = {
  id: "bound-by-parent",
  role: "design-explorer",
  kind: "evidence",
  packet_id: "abel-design-process-test",
  module_name: "fixture",
  scope: ["."],
  files_read: ["."],
  evidence: [
    { claim: "fixture inspected", path: ".", line_start: 1, line_end: 1 },
  ],
  existing_structures: [],
  existing_conventions: [],
  constraints_discovered: [],
  open_questions: [],
  dependencies: [],
  write_set_hints: [],
  validation_hints: [],
  agents_impact_hints: [],
  risks: [],
  success_criteria_hints: [],
};

const diagnosisEvidence = {
  id: "diagnosis-process-test",
  role: "diagnosis-worker",
  kind: "evidence",
  conclusions: ["fixture inspected"],
  citations: [{ path: ".", lines: "1" }],
  constraints: [],
  dependencies: [],
  risks: [],
  blockingQuestions: [],
  hints: { writeSet: [], verification: "none", agentsImpact: "none" },
};

describe("process-backed packet dispatch", () => {
  it("returns adapted Design evidence from one Pi child", async () => {
    const event = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `\`\`\`json\n${JSON.stringify(evidence)}\n\`\`\``,
          },
        ],
        usage: {},
      },
    });
    child(`cat >/dev/null; printf '%s\\n' '${event}'`);
    const result = await runSubagentProcess({
      role: "design-explorer",
      cwd: process.cwd(),
      prompt: buildSubagentPrompt({
        role: "design-explorer",
        agentContent: loadAgentDefinitions().find(
          (agent) => agent.role === "design-explorer",
        )?.content,
        objective: "inspect the fixture",
        context: [
          "",
          "",
          JSON.stringify({
            id: "abel-design-process-test",
            phase: "evidence",
            read: ["."],
            write: [],
            output: "evidence",
          }),
        ].join("\\n\\n"),
      }),
    });
    expect(result).toMatchObject({ status: "completed" });
    expect(result.finalText).toContain(JSON.stringify(evidence));
  });

  it("returns adapted Diagnose evidence from one Pi child", async () => {
    const event = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `\`\`\`json\n${JSON.stringify(diagnosisEvidence)}\n\`\`\``,
          },
        ],
        usage: {},
      },
    });
    child(`cat >/dev/null; printf '%s\\n' '${event}'`);
    await expect(
      runtime().execute("run", { request: packet("abel-diagnose") }, context),
    ).resolves.toMatchObject({
      ok: true,
      action: "run",
      result: diagnosisEvidence,
    });
  });

  it("reports child process failure without success", async () => {
    child("cat >/dev/null; exit 7");
    await expect(
      runtime().execute("run", { request: packet("abel-diagnose") }, context),
    ).resolves.toMatchObject({ ok: false, failure: { kind: "transport" } });
  });

  it("propagates cancellation to a running child", async () => {
    child("cat >/dev/null; sleep 10");
    const controller = new AbortController();
    const running = runtime().execute(
      "run",
      { request: packet("abel-diagnose") },
      context,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20).unref();
    await expect(running).resolves.toMatchObject({
      ok: false,
      failure: { kind: "cancelled" },
    });
  });
});
