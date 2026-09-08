import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type AssistantMessage,
  type Context,
  type Model,
  type Usage,
  validateToolArguments,
} from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { childContextBudget, classifyProviderFailure } from "./child-budget.ts";
import {
  abortable,
  type ChildModelClient,
  disposeChildTransport,
  requestChildTurn,
} from "./child-model.ts";
import type {
  ChildFailure,
  DiffResult,
  EvidenceResult,
  IdentityDimension,
  SafeFailureDetails,
} from "./contracts.ts";
import {
  createScopedTools,
  type Observation,
  ScopedObservationCollector,
  TOOL_LIMITS,
} from "./scoped-tools.ts";
import {
  type CandidateArtifactSubmission,
  type CandidateArtifactSubmissionResult,
  createCandidateArtifactTool,
  createStructuredPatchTool,
  createSubmitTool,
  type SubmitClassification,
} from "./submit-tool.ts";
import { serializeTaskLedgerProjection } from "./task-ledger.ts";
import { TransportTimeout } from "./transport-budget.ts";

export const CHILD_EXECUTION_LIMITS = Object.freeze({
  maxTurns: 64,
  maxContextBytes: 4 * 1024 * 1024,
});

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export class UsageAggregator {
  private readonly ids = new Set<string>();
  private usage: Usage = structuredClone(ZERO_USAGE);
  add(id: string, value: Usage): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    const cacheWrite1h =
      this.usage.cacheWrite1h === undefined && value.cacheWrite1h === undefined
        ? undefined
        : (this.usage.cacheWrite1h ?? 0) + (value.cacheWrite1h ?? 0);
    const reasoning =
      this.usage.reasoning === undefined && value.reasoning === undefined
        ? undefined
        : (this.usage.reasoning ?? 0) + (value.reasoning ?? 0);
    this.usage = {
      input: this.usage.input + value.input,
      output: this.usage.output + value.output,
      cacheRead: this.usage.cacheRead + value.cacheRead,
      cacheWrite: this.usage.cacheWrite + value.cacheWrite,
      ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
      ...(reasoning === undefined ? {} : { reasoning }),
      totalTokens: this.usage.totalTokens + value.totalTokens,
      cost: {
        input: this.usage.cost.input + value.cost.input,
        output: this.usage.cost.output + value.cost.output,
        cacheRead: this.usage.cost.cacheRead + value.cost.cacheRead,
        cacheWrite: this.usage.cost.cacheWrite + value.cost.cacheWrite,
        total: this.usage.cost.total + value.cost.total,
      },
    };
    return true;
  }
  hasUsage(): boolean {
    return this.ids.size > 0;
  }
  total(): Usage {
    return structuredClone(this.usage);
  }
}

function wrapScopedTools(
  roots: string[],
  cwd: string,
  allowedPaths?: string[],
  observer?: (observation: Observation) => void,
) {
  const order = ["read", "grep", "find", "ls"];
  return createScopedTools({
    cwd,
    roots,
    ...(allowedPaths
      ? {
          allowedPaths: allowedPaths.map((relative) =>
            path.resolve(cwd, relative),
          ),
        }
      : {}),
    ...(observer ? { observer } : {}),
  })
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    .map((scoped) =>
      defineTool({
        name: scoped.name,
        label: scoped.name,
        description: scoped.description,
        parameters:
          scoped.name === "grep"
            ? Type.Object({
                path: Type.Optional(Type.String()),
                pattern: Type.String(),
              })
            : scoped.name === "find"
              ? Type.Object({
                  path: Type.Optional(Type.String()),
                  pattern: Type.String(),
                  limit: Type.Optional(
                    Type.Integer({
                      minimum: 1,
                      maximum: TOOL_LIMITS.maxEntries,
                    }),
                  ),
                })
              : scoped.name === "read"
                ? Type.Object({
                    path: Type.String(),
                    offset: Type.Optional(Type.Integer({ minimum: 1 })),
                    limit: Type.Optional(Type.Integer({ minimum: 1 })),
                  })
                : Type.Object({
                    path: Type.Optional(Type.String()),
                  }),
        async execute(_id, params, signal) {
          const result = await scoped.execute(
            params as Record<string, unknown>,
            signal,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: result,
          };
        },
      }),
    );
}

export type ChildFailureKind = "failed" | "cancelled" | "timed-out";

function finalDeliveryContent(message: AssistantMessage | undefined) {
  return (
    message?.content.filter(
      (content) =>
        content.type !== "thinking" &&
        !(content.type === "text" && content.text.trim().length === 0),
    ) ?? []
  );
}

function safeChildError(failure: ChildFailure): string {
  switch (failure.kind) {
    case "environment":
      return "child environment unavailable";
    case "transport":
      switch (failure.code) {
        case "child-timeout":
        case "timeout":
          return "child phase timeout";
        case "child-no-final-assistant":
          return "child produced no final assistant";
        case "child-provider-stream-aborted":
          return "child provider stream aborted";
        case "child-provider-stream-error":
        case "transport-failure":
          return "child provider stream failed";
      }
      return "child provider stream failed";
    case "artifact":
      return failure.code === "child-no-structural-submit"
        ? "child produced no structural submission"
        : "child structural submission is invalid";
    case "cancelled":
      return "child phase cancelled";
    case "stale":
    case "approval-boundary":
    case "verification-adapter":
    case "execution-limit":
    case "result-limit":
      return "child result rejected";
  }
}

function submitDetails(
  classification: SubmitClassification,
): SafeFailureDetails {
  const identityMismatch = (
    ["request", "role", "task", "phase"] as IdentityDimension[]
  ).filter((dimension) => !classification.identity[dimension]);
  return {
    finalCategory: classification.finalCategory,
    submitAttempts: Math.min(classification.attempts, 2),
    schema: classification.schema,
    ...(identityMismatch.length > 0 ? { identityMismatch } : {}),
  };
}

function withSubmitDetails(
  failure: ChildFailure,
  classification: SubmitClassification,
): ChildFailure {
  return failure.kind === "artifact"
    ? {
        ...failure,
        details: {
          ...failure.details,
          ...submitDetails(classification),
        },
      }
    : failure;
}

export type ChildSessionResult =
  | {
      ok: true;
      result: EvidenceResult | DiffResult | CandidateArtifactSubmissionResult;
      toolNames: string[];
      submitCount: number;
      disposeCount: number;
      usage: Usage;
      classification: SubmitClassification;
      observations?: { observations: Observation[]; truncated: boolean };
    }
  | {
      ok: false;
      error: string;
      failure: ChildFailure;
      failureKind: ChildFailureKind;
      transportFailure: boolean;
      disposeCount: number;
      usage: Usage;
      classification: SubmitClassification;
      observations?: { observations: Observation[]; truncated: boolean };
    };

export async function runChildSession(input: {
  cwd: string;
  modelRuntime: ChildModelClient;
  model: Model<string>;
  systemPrompt: string;
  requestId: string;
  taskId?: string;
  role: string;
  phase?: string;
  output: "evidence" | "diff";
  roots: string[];
  allowedPaths?: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  ledgerProjection?: unknown;
  captureObservations?: boolean;
  candidateArtifact?: CandidateArtifactSubmission;
  structuredPatch?: {
    workspaceRoot: string;
    writePaths: string[];
    deletePaths: string[];
  };
  onStreamStart?: () => void;
  onStreamHeaders?: () => void;
  onStreamProgress?: () => void;
}): Promise<ChildSessionResult> {
  const submit = input.candidateArtifact
    ? createCandidateArtifactTool(input.candidateArtifact)
    : input.structuredPatch
      ? createStructuredPatchTool({
          requestId: input.requestId,
          taskId: input.taskId,
          role: input.role,
          phase: input.phase ?? "red",
          workspaceRoot: input.structuredPatch.workspaceRoot,
          writePaths: input.structuredPatch.writePaths,
          deletePaths: input.structuredPatch.deletePaths,
        })
      : createSubmitTool({
          requestId: input.requestId,
          taskId: input.taskId,
          role: input.role,
          phase: input.phase ?? "red",
          output: input.output,
        });
  const observationCollector = input.captureObservations
    ? new ScopedObservationCollector()
    : undefined;
  const readTools = wrapScopedTools(
    input.roots,
    input.cwd,
    input.allowedPaths,
    observationCollector?.observe,
  );
  const customTools = [...readTools, submit.tool];
  const toolNames = customTools.map((tool) => tool.name);
  let disposeCount = 0;
  const usage = new UsageAggregator();
  const effectivePrompt =
    input.ledgerProjection === undefined
      ? input.systemPrompt
      : [
          input.systemPrompt,
          "",
          "<abel-task-ledger-projection>",
          serializeTaskLedgerProjection(input.ledgerProjection),
          "</abel-task-ledger-projection>",
        ].join("\n");
  const observationMetadata = () =>
    observationCollector
      ? { observations: observationCollector.projection() }
      : {};
  const abort = new AbortController();
  const forwardCancellation = () =>
    abort.abort(input.signal?.reason ?? new Error("child phase cancelled"));
  if (input.signal?.aborted) forwardCancellation();
  else
    input.signal?.addEventListener("abort", forwardCancellation, {
      once: true,
    });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort(new Error("child phase timeout"));
  }, input.timeoutMs);
  const context: Context = {
    systemPrompt: effectivePrompt,
    messages: [
      {
        role: "user",
        content: "Complete the bounded task and submit its result.",
        timestamp: Date.now(),
      },
    ],
    tools: customTools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
  };
  const sessionId = randomUUID();
  let assistantSequence = 0;
  let structuralAttempts = 0;
  let last: AssistantMessage | undefined;
  let preflightRejected = false;
  let turns = 0;
  const contextBudget = childContextBudget(input.model);
  let reminderUsed = false;
  const observeStart = () => {
    try {
      input.onStreamStart?.();
    } catch {
      /* observation only */
    }
  };
  const observeProgress = () => {
    try {
      input.onStreamProgress?.();
    } catch {
      /* observation only */
    }
  };
  const classification = (): SubmitClassification => ({
    finalCategory:
      submit.getResult() !== undefined
        ? structuralAttempts > 1
          ? "multiple-submit"
          : "single-submit-only"
        : !last
          ? "no-final-assistant"
          : finalDeliveryContent(last).length === 1 &&
              finalDeliveryContent(last)[0]?.type === "text"
            ? "text-only"
            : "mixed",
    attempts: structuralAttempts,
    schema: preflightRejected ? "invalid" : submit.getSchema(),
    identity: submit.getIdentity(),
  });
  let failure: ChildFailure | undefined;
  const missingResult = (): ChildFailure => ({
    kind: "artifact",
    code:
      structuralAttempts === 0
        ? "child-no-structural-submit"
        : "invalid-structural-result",
    stage:
      structuralAttempts === 0 ? "child-finalization" : "structural-submit",
  });
  try {
    for (;;) {
      abort.signal.throwIfAborted();
      if (turns >= CHILD_EXECUTION_LIMITS.maxTurns) {
        failure = { kind: "execution-limit", code: "child-turn-limit" };
        break;
      }
      if (Buffer.byteLength(JSON.stringify(context), "utf8") > contextBudget) {
        failure = { kind: "execution-limit", code: "child-context-limit" };
        break;
      }
      turns++;
      const message = await requestChildTurn({
        client: input.modelRuntime,
        model: input.model,
        context,
        signal: abort.signal,
        sessionId,
        onStart: observeStart,
        onHeaders: input.onStreamHeaders,
        onProgress: observeProgress,
        onMessage: (message) => {
          usage.add(`assistant:${assistantSequence++}`, message.usage);
        },
      });
      last = message;
      if (!message) {
        failure = {
          kind: "transport",
          code: "child-no-final-assistant",
          stage: "child-finalization",
        };
        break;
      }
      context.messages.push(message);
      if (Buffer.byteLength(JSON.stringify(context), "utf8") > contextBudget) {
        failure = { kind: "execution-limit", code: "child-context-limit" };
        break;
      }
      // Only complete, normal turns may execute tools, including terminal submit.
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        failure =
          message.stopReason === "error"
            ? classifyProviderFailure(message.errorMessage)
            : {
                kind: "transport",
                code: "child-provider-stream-aborted",
                stage: "child-provider-stream",
              };
        break;
      }
      if (message.stopReason !== "toolUse" && message.stopReason !== "stop") {
        failure = missingResult();
        break;
      }
      const calls = message.content.filter((part) => part.type === "toolCall");
      if (calls.length === 0) {
        if (
          !reminderUsed &&
          structuralAttempts === 0 &&
          message.stopReason === "stop" &&
          finalDeliveryContent(message).length > 0 &&
          finalDeliveryContent(message).every((part) => part.type === "text")
        ) {
          reminderUsed = true;
          context.messages.push({
            role: "user",
            timestamp: Date.now(),
            content:
              "No result has been accepted. Submit existing findings through abel_submit_result, not prose. Do not repeat investigation or expand scope. Keep evidence gaps explicit; use context-request if available and needed. This is the only missing-submit reminder; the original deadline still applies.",
          });
          continue;
        }
        failure = missingResult();
        break;
      }
      // Source-order execution is a Cadence contract, not Pi's batch scheduling.
      // Process the batch even after acceptance to reject a duplicate terminal
      // submission while still allowing harmless scoped reads in that batch.
      for (const call of calls) {
        abort.signal.throwIfAborted();
        const isSubmit = call.name === "abel_submit_result";
        if (isSubmit) {
          structuralAttempts++;
          if (structuralAttempts > 2) {
            failure = {
              kind: "artifact",
              code: "invalid-structural-result",
              stage: "structural-submit",
            };
            break;
          }
          if (submit.getResult() !== undefined) {
            preflightRejected = true;
            failure = {
              kind: "artifact",
              code: "invalid-structural-result",
              stage: "structural-submit",
            };
            break;
          }
        }
        const tool = customTools.find((tool) => tool.name === call.name);
        let content: Array<{ type: "text"; text: string }>;
        let isError = false;
        let validated = false;
        try {
          if (!tool) throw new Error("unknown scoped tool");
          const params = validateToolArguments(tool, call);
          validated = true;
          if (isSubmit) preflightRejected = false;
          const result = await abortable(
            tool.execute(
              call.id,
              params as never,
              abort.signal,
              undefined,
              {} as never,
            ),
            abort.signal,
          );
          content = result.content as typeof content;
        } catch (error) {
          abort.signal.throwIfAborted();
          isError = true;
          if (isSubmit && !validated) preflightRejected = true;
          content = [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "tool execution failed",
            },
          ];
        }
        context.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content,
          isError,
          timestamp: Date.now(),
        });
      }
      if (failure) break;
      if (submit.getResult() !== undefined) break;
      if (
        structuralAttempts >= 2 ||
        submit.getFailure()?.kind === "result-limit"
      ) {
        failure = missingResult();
        break;
      }
    }
  } catch (error) {
    failure =
      error instanceof TransportTimeout
        ? {
            kind: "transport",
            code: error.code,
            stage: "child-provider-stream",
          }
        : classifyProviderFailure(error);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardCancellation);
    // Dispose our conversation and only this child's provider session resources.
    context.messages.length = 0;
    try {
      disposeChildTransport(sessionId);
    } catch {
      failure ??= {
        kind: "environment",
        code: "sandbox-runtime-unavailable",
        stage: "child-finalization",
      };
    }
    disposeCount++;
  }
  const result = submit.getResult();
  // All exit paths share the same priority, including thrown/empty streams.
  // A later transport failure cannot erase a rejected submission. Preflight
  // rejection never reaches execute, so retain it independently of the tool.
  // A valid correction clears both the tool failure and preflightRejected.
  const terminalFailure: ChildFailure | undefined = timedOut
    ? { kind: "transport", code: "child-timeout", stage: "child-timeout" }
    : input.signal?.aborted
      ? { kind: "cancelled", code: "cancelled" }
      : (submit.getFailure() ??
        (preflightRejected ? missingResult() : undefined) ??
        failure ??
        (!result ? missingResult() : undefined));
  const projection = classification();
  if (terminalFailure) {
    const typed = withSubmitDetails(terminalFailure, projection);
    return {
      ok: false,
      error:
        typed.kind === "cancelled" && input.signal?.reason instanceof Error
          ? input.signal.reason.message
          : safeChildError(typed),
      failure: typed,
      failureKind:
        timedOut ||
        (typed.kind === "transport" &&
          [
            "first-progress-timeout",
            "stream-idle-timeout",
            "attempt-timeout",
          ].includes(typed.code))
          ? "timed-out"
          : typed.kind === "cancelled"
            ? "cancelled"
            : "failed",
      transportFailure: typed.kind === "transport",
      disposeCount,
      usage: usage.total(),
      classification: projection,
      ...observationMetadata(),
    };
  }
  if (!result) throw new Error("child-result-invariant");
  return {
    ok: true,
    result,
    toolNames,
    submitCount: structuralAttempts,
    disposeCount,
    usage: usage.total(),
    classification: projection,
    ...observationMetadata(),
  };
}
