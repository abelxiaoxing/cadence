import path from "node:path";
import type { AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  defineTool,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
  ChildFailure,
  DiffResult,
  EvidenceResult,
  IdentityDimension,
  SafeFailureDetails,
} from "./contracts.ts";
import { EmptyResourceLoader } from "./empty-resource-loader.ts";
import { createScopedTools, TOOL_LIMITS } from "./scoped-tools.ts";
import {
  createSubmitTool,
  type FinalCategory,
  type SubmitClassification,
} from "./submit-tool.ts";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const ABORT_SETTLE_GRACE_MS = 250;

async function settleAbort(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ABORT_SETTLE_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
) {
  const order = ["read", "grep", "find", "ls"];
  return createScopedTools({
    roots,
    ...(allowedPaths
      ? {
          allowedPaths: allowedPaths.map((relative) =>
            path.resolve(cwd, relative),
          ),
        }
      : {}),
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
        async execute(_id, params) {
          const result = await scoped.execute(
            params as Record<string, unknown>,
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

function isSingleStructuralSubmit(message: AssistantMessage | undefined) {
  const content = finalDeliveryContent(message);
  return (
    message?.role === "assistant" &&
    content.length === 1 &&
    content[0]?.type === "toolCall" &&
    content[0].name === "abel_submit_result"
  );
}

function safeChildError(failure: ChildFailure): string {
  switch (failure.kind) {
    case "environment":
      return failure.code === "child-session-create-failed"
        ? "child session creation failed"
        : "child environment unavailable";
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
      result: EvidenceResult | DiffResult;
      toolNames: string[];
      submitCount: number;
      disposeCount: number;
      usage: Usage;
      classification: SubmitClassification;
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
    };

export async function runChildSession(input: {
  cwd: string;
  modelRuntime: ModelRuntime;
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
  failureOverride?: () => ChildFailure | undefined;
}): Promise<ChildSessionResult> {
  const submit = createSubmitTool({
    requestId: input.requestId,
    taskId: input.taskId,
    role: input.role,
    phase: input.phase ?? "red",
    output: input.output,
  });
  const readTools = wrapScopedTools(input.roots, input.cwd, input.allowedPaths);
  const customTools = [...readTools, submit.tool];
  const toolNames = customTools.map((tool) => tool.name);
  let disposeCount = 0;
  const usage = new UsageAggregator();
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
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>["session"]
    | undefined;
  let unsubscribe: (() => void) | undefined;
  let abortSettlement: Promise<void> | undefined;
  let assistantSequence = 0;
  const disposeOnce = () => {
    if (session) {
      session.dispose();
      disposeCount++;
      session = undefined;
    }
  };
  const classifySession = (): SubmitClassification => {
    const assistants =
      session?.messages.filter((m) => m.role === "assistant") ?? [];
    const last = assistants.at(-1);
    let finalCategory: FinalCategory;
    if (!last) {
      finalCategory = "no-final-assistant";
    } else if (isSingleStructuralSubmit(last)) {
      finalCategory =
        submit.getAttempts() > 1 ? "multiple-submit" : "single-submit-only";
    } else {
      const content = finalDeliveryContent(last);
      finalCategory =
        content.length === 1 && content[0]?.type === "text"
          ? "text-only"
          : "mixed";
    }
    return {
      finalCategory,
      attempts: submit.getAttempts(),
      schema: submit.getSchema(),
      identity: submit.getIdentity(),
    };
  };
  const transportFailure = ():
    | Extract<ChildFailure, { kind: "transport" }>
    | undefined => {
    const final = session?.messages
      .filter((message) => message.role === "assistant")
      .at(-1);
    if (final === undefined) {
      return {
        kind: "transport",
        code: "child-no-final-assistant",
        stage: "child-finalization",
      };
    }
    if (final.stopReason === "error") {
      return submit.getAttempts() === 0 &&
        !final.content.some(
          (content) =>
            content.type === "toolCall" &&
            content.name === "abel_submit_result",
        )
        ? {
            kind: "transport",
            code: "child-provider-stream-error",
            stage: "child-provider-stream",
          }
        : undefined;
    }
    if (final.stopReason === "aborted") {
      return {
        kind: "transport",
        code: "child-provider-stream-aborted",
        stage: "child-provider-stream",
      };
    }
    return undefined;
  };
  const noStructuralSubmit = (): ChildFailure =>
    submit.getAttempts() === 0
      ? {
          kind: "artifact",
          code: "child-no-structural-submit",
          stage: "child-finalization",
        }
      : {
          kind: "artifact",
          code: "invalid-structural-result",
          stage: "structural-submit",
        };
  try {
    abort.signal.throwIfAborted();
    const creation = createAgentSession({
      cwd: input.cwd,
      modelRuntime: input.modelRuntime,
      model: input.model,
      thinkingLevel: "off",
      tools: toolNames,
      customTools,
      resourceLoader: new EmptyResourceLoader(input.systemPrompt),
      sessionManager: SessionManager.inMemory(input.cwd),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      }),
    });
    try {
      ({ session } = await abortable(creation, abort.signal));
    } catch (error) {
      void creation
        .then(({ session: lateSession }) => lateSession.dispose())
        .catch(() => undefined);
      throw error;
    }
    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        usage.add(`assistant:${assistantSequence++}`, event.message.usage);
      }
    });
    const startAbortSettlement = () => {
      if (session && !abortSettlement) abortSettlement = session.abort();
      return abortSettlement;
    };
    const onAbort = () => {
      void startAbortSettlement()?.catch(() => undefined);
    };
    abort.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (abort.signal.aborted) {
        onAbort();
        throw abort.signal.reason;
      }
      await Promise.race([
        session.prompt(input.systemPrompt, { expandPromptTemplates: false }),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener(
            "abort",
            () => reject(abort.signal.reason),
            { once: true },
          ),
        ),
      ]);
    } finally {
      abort.signal.removeEventListener("abort", onAbort);
    }
    const result = submit.getResult();
    const attempts = submit.getAttempts();
    const classification = classifySession();
    if (!result || attempts !== 1) {
      const failure = withSubmitDetails(
        submit.getFailure() ??
          input.failureOverride?.() ??
          transportFailure() ??
          noStructuralSubmit(),
        classification,
      );
      const isTransport = failure.kind === "transport";
      disposeOnce();
      return {
        ok: false,
        error: safeChildError(failure),
        failure,
        failureKind: "failed",
        transportFailure: isTransport,
        disposeCount,
        usage: usage.total(),
        classification,
      };
    }
    const assistants = session.messages.filter((m) => m.role === "assistant");
    const final = assistants.at(-1);
    if (!isSingleStructuralSubmit(final)) {
      const failure = {
        kind: "artifact",
        code: "invalid-structural-result",
        stage: "child-finalization",
        details: submitDetails(classification),
      } as const;
      disposeOnce();
      return {
        ok: false,
        error: safeChildError(failure),
        failure,
        failureKind: "failed",
        transportFailure: false,
        disposeCount,
        usage: usage.total(),
        classification,
      };
    }
    disposeOnce();
    return {
      ok: true,
      result,
      toolNames,
      submitCount: attempts,
      disposeCount,
      usage: usage.total(),
      classification,
    };
  } catch (error) {
    if (abort.signal.aborted && session) {
      const settlement = abortSettlement ?? session.abort();
      abortSettlement = settlement;
      await settleAbort(settlement);
    }
    const failureKind: ChildFailureKind = timedOut
      ? "timed-out"
      : input.signal !== undefined &&
          (input.signal.aborted || abort.signal.reason === input.signal.reason)
        ? "cancelled"
        : "failed";
    const classification = classifySession();
    const failure: ChildFailure = withSubmitDetails(
      timedOut
        ? {
            kind: "transport",
            code: "child-timeout",
            stage: "child-timeout",
          }
        : failureKind === "cancelled"
          ? { kind: "cancelled", code: "cancelled" }
          : session === undefined
            ? {
                kind: "environment",
                code: "child-session-create-failed",
                stage: "child-session-create",
              }
            : (submit.getFailure() ??
              input.failureOverride?.() ??
              transportFailure() ??
              noStructuralSubmit()),
      classification,
    );
    const isTransport = failure.kind === "transport";
    disposeOnce();
    return {
      ok: false,
      error:
        failure.kind === "cancelled" && error instanceof Error
          ? error.message
          : safeChildError(failure),
      failure,
      failureKind,
      transportFailure: isTransport,
      disposeCount,
      usage: usage.total(),
      classification,
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardCancellation);
    unsubscribe?.();
    disposeOnce();
  }
}
