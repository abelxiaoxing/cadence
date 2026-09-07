import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  createEvaluationMetrics,
  evaluationScenarios,
} from "../scripts/workflow-evaluation.mjs";

it("does not count cancellation, discarded runs or Design completion as Implement success", () => {
  const metrics = createEvaluationMetrics();
  for (const state of ["operation-cancelled", "discarded", "paused"])
    metrics.observe({
      type: "tool_execution_end",
      toolName: "abel_dispatch",
      result: { details: { state, completed: false } },
    });
  metrics.observe({
    type: "tool_execution_start",
    toolName: "abel_dispatch",
    toolCallId: "design",
    args: { action: "design" },
  });
  metrics.observe({
    type: "tool_execution_end",
    toolName: "abel_dispatch",
    toolCallId: "design",
    result: { details: { state: "completed", operation: "finalize-delivery" } },
  });
  expect(metrics.result.designCompleted).toBe(true);
  expect(metrics.result.completed).toBe(false);
  metrics.observe({
    type: "tool_execution_end",
    toolName: "abel_dispatch",
    result: { details: { state: "completed", completed: true } },
  });
  expect(metrics.result.completed).toBe(true);
});

it("counts duplicate amendments across operation IDs without retaining their text", () => {
  const metrics = createEvaluationMetrics();
  for (const operationId of ["one", "two"])
    metrics.observe({
      type: "tool_execution_start",
      toolName: "abel_dispatch",
      args: {
        action: "amend",
        request: { operationId, content: "private fixture text" },
      },
    });
  expect(metrics.result).toMatchObject({
    amendments: 2,
    repeatedAmendments: 1,
  });
  expect(JSON.stringify(metrics.result)).not.toContain("private fixture text");
  expect(evaluationScenarios.map((item) => item.id)).toEqual([
    "small-fix",
    "multiple-tasks",
    "restart-recovery",
    "missing-capability",
  ]);
});

it("reports provider failures without fabricating user intervention or success", () => {
  const metrics = createEvaluationMetrics();
  metrics.observe({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "Authentication failed: private credential detail",
    },
  });
  expect(metrics.result).toMatchObject({
    modelErrors: 1,
    modelFailure: "authentication",
    userInterventions: 0,
    completed: false,
  });
  expect(JSON.stringify(metrics.result)).not.toContain(
    "private credential detail",
  );
});

it.each([
  [
    "OpenAI API error (429): rate_limit_exceeded",
    "provider",
    "rate-limit",
    429,
  ],
  ["429 insufficient_quota", "provider", "quota", 429],
  ["OpenAI API error (503): overloaded_error", "provider", "server-error", 503],
  ["HTTP 502: upstream unavailable", "provider", "server-error", 502],
  ["504 status code (no body)", "provider", "server-error", 504],
  [
    "OpenAI API error (400): unsupported_parameter",
    "provider",
    "request-rejected",
    400,
  ],
  ["400 context_length_exceeded", "provider", "context-limit", 400],
  [
    "OpenAI API error (401): invalid_api_key",
    "authentication",
    "authentication",
    401,
  ],
  ["connection failed: ECONNRESET", "transport", "transport", null],
  ["request timed out", "transport", "timeout", null],
  [
    "stream ended without a stop reason",
    "transport",
    "stream-interrupted",
    null,
  ],
  ["opaque failure; request id 503", "provider", "unclassified", null],
])("retains a safe diagnosis for %s", (message, category, kind, httpStatus) => {
  const metrics = createEvaluationMetrics();
  metrics.observe({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: `${message}; private response, https://private.invalid/token`,
    },
  });
  expect(metrics.result).toMatchObject({
    modelFailure: category,
    modelFailureDiagnostics: [{ kind, httpStatus }],
  });
  expect(JSON.stringify(metrics.result)).not.toMatch(/private|https:/u);
});

it("bounds diagnostic samples and counts actual retry events separately from failures", () => {
  const metrics = createEvaluationMetrics();
  for (let index = 0; index < 20; index++) {
    metrics.observe({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "HTTP 503: private",
      },
    });
  }
  for (const delayMs of [2000, 4000, 8000]) {
    metrics.observe({
      type: "auto_retry_start",
      delayMs,
      errorMessage: "private",
    });
  }
  expect(metrics.result.modelErrors).toBe(20);
  expect(metrics.result.modelFailureDiagnostics).toHaveLength(16);
  expect(metrics.result).toMatchObject({ autoRetries: 3, retryDelayMs: 14000 });
  expect(JSON.stringify(metrics.result)).not.toContain("private");
});

// Exercise the actual CLI with a deterministic RPC host, without model calls.
it.skipIf(process.platform === "win32").each([
  { failure: "provider", restart: false },
  { failure: "transport", restart: false },
  { failure: "provider", restart: true },
  { failure: "none", restart: false },
  { failure: "recovered-design", restart: false },
])(
  "classifies Implement $failure after Design (restart: $restart)",
  async ({ failure, restart }) => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-eval-rpc-test-"));
    const host = path.join(root, "pi.mjs");
    writeFileSync(
      host,
      `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import path from 'node:path';
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const failure = ${JSON.stringify(failure)};
createInterface({input:process.stdin}).on('line', line => {
  const command = JSON.parse(line);
  const response = data => send({type:'response',id:command.id,command:command.type,success:true,data});
  const modelError = errorMessage => send({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage}});
  if(command.type === 'get_commands') {
    const extension = process.argv[process.argv.indexOf('--extension')+1];
    response({commands:[{name:'abel-design',sourceInfo:{origin:'package',baseDir:path.resolve(extension,'../..')}}]});
  } else if(command.type === 'prompt') {
    response({});
    if(command.message.startsWith('/abel-design')) {
      if(failure === 'recovered-design') modelError('temporary provider failure');
      send({type:'tool_execution_start',toolName:'abel_dispatch',toolCallId:'design',args:{action:'design'}});
      send({type:'tool_execution_end',toolName:'abel_dispatch',toolCallId:'design',result:{details:{operation:'finalize-delivery',state:'completed'}}});
    } else if(failure === 'provider' || failure === 'transport') {
      modelError(failure === 'transport' ? 'network connection failed: private detail' : 'provider unavailable: private detail');
    }
    send({type:'agent_settled'});
  } else response({});
});
`,
      { mode: 0o755 },
    );
    try {
      let stdout;
      try {
        await promisify(execFile)(
          process.execPath,
          [
            path.resolve(
              import.meta.dirname,
              "../scripts/evaluate-workflow.mjs",
            ),
            "--live",
            "--pi",
            host,
            "--scenario",
            restart ? "restart-recovery" : "small-fix",
            "--timeout-ms",
            "10000",
          ],
          { timeout: 20000 },
        );
        throw new Error("incomplete evaluation should fail");
      } catch (error) {
        expect(error.code).toBe(1);
        stdout = error.stdout;
      }
      const report = JSON.parse(stdout);
      const unavailable = failure === "provider" || failure === "transport";
      expect(report).toMatchObject({
        designCompleted: true,
        completed: false,
        success: false,
        reason: unavailable
          ? "evaluation-model-unavailable"
          : "implementation-stalled",
        userInterventions: unavailable ? 0 : 1,
        sessions: restart ? 2 : 1,
      });
      if (unavailable) expect(report.modelFailure).toBe(failure);
      expect(stdout).not.toContain("private detail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  25000,
);

it.skipIf(process.platform === "win32").each([
  { phase: "design", restart: false },
  { phase: "implement", restart: false },
  { phase: "implement", restart: true },
])(
  "settles timed-out $phase before closing RPC and counts each host once (restart: $restart)",
  async ({ phase, restart }) => {
    const root = mkdtempSync(
      path.join(tmpdir(), "cadence-eval-deadline-test-"),
    );
    const host = path.join(root, "pi.mjs");
    writeFileSync(
      host,
      `#!/usr/bin/env node
import {createInterface} from 'node:readline';
import path from 'node:path';
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
let tokens = 0;
createInterface({input:process.stdin}).on('line', line => {
  const command = JSON.parse(line);
  const response = data => send({type:'response',id:command.id,command:command.type,success:true,data});
  if(command.type === 'get_commands') {
    const extension = process.argv[process.argv.indexOf('--extension')+1];
    response({commands:[{name:'abel-design',sourceInfo:{origin:'package',baseDir:path.resolve(extension,'../..')}}]});
  } else if(command.type === 'get_session_stats') response({tokens:{total:tokens},cost:tokens/100});
  else if(command.type === 'prompt') {
    tokens += 17;
    response({});
    if(${JSON.stringify(phase)} === 'implement' && command.message.startsWith('/abel-design')) {
      send({type:'tool_execution_start',toolName:'abel_dispatch',toolCallId:'design',args:{action:'design'}});
      send({type:'tool_execution_end',toolName:'abel_dispatch',toolCallId:'design',result:{details:{operation:'finalize-delivery',state:'completed'}}});
      send({type:'agent_settled'});
    }
  } else if(command.type === 'abort') {
    response({});
    send({type:'agent_settled'});
  } else response({});
});
`,
      { mode: 0o755 },
    );
    try {
      const error = await promisify(execFile)(
        process.execPath,
        [
          path.resolve(import.meta.dirname, "../scripts/evaluate-workflow.mjs"),
          "--live",
          "--pi",
          host,
          "--scenario",
          restart ? "restart-recovery" : "small-fix",
          "--timeout-ms",
          "1000",
        ],
        { timeout: 10000 },
      ).then(
        () => {
          throw new Error("deadline must fail");
        },
        (error) => error,
      );
      expect(error.code).toBe(1);
      expect(error.stderr).not.toContain("ERR_STREAM_WRITE_AFTER_END");
      expect(JSON.parse(error.stdout)).toMatchObject({
        reason: "evaluation-deadline",
        success: false,
        completed: false,
        userInterventions: 0,
        sessions: restart ? 2 : 1,
        tokens: phase === "design" ? 17 : 34,
        cost: phase === "design" ? 0.17 : 0.34,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15000,
);
