import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.ts";

const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const TERMINAL_STATES = new Set(["completed", "discarded", "rejected"]);
const ACTIONABLE_STATES = new Set([
  "not-started",
  "created",
  "validating-delivery",
  "ready",
  "queued",
  "connecting",
  "running",
  "validating",
  "verifying",
  "retryable",
  "paused",
  "approval-needed",
  "change-verifying",
  "ready-to-apply",
  "applying",
  "recovering",
]);
const READ_ONLY_AMENDMENT_OPERATIONS = new Set([
  "status",
  "validate-plan-draft",
]);
const INVESTIGATION_TOOLS = new Set(["read", "grep", "find", "ls", "bash"]);
const MAX_INVESTIGATION_CONTINUATIONS = 2;

type Activation = {
  id: number;
  cwd: string;
  change: string;
  inputRevision: number;
  progressRevision: number;
  amendmentBatchId?: string;
  runId?: string;
  stopped: boolean;
  seenProgress: Set<string>;
  seenInvestigationEvidence: Set<string>;
  investigationEvidenceRevision: number;
  investigationRoundsUsed: number;
  lastInvestigationEvidenceUsed: number;
  lastWorkflowEvidenceKey?: string;
  sentContinuations: Set<string>;
  reportedStalls: Set<string>;
};

export interface ImplementSettlementProbe {
  readonly activationId: number;
  readonly cwd: string;
  readonly change: string;
  readonly inputRevision: number;
  readonly progressRevision: number;
}

export type ImplementSettlementDecision =
  | {
      kind: "continue";
      change: string;
      message: string;
      statusFingerprint: string;
    }
  | {
      kind: "terminal";
      change: string;
      state: string;
    }
  | {
      kind: "stalled";
      change: string;
      message: string;
      statusFingerprint: string;
      code: "implement-continuation-no-progress";
      state: string;
    };

type ToolResultObservation = {
  toolName?: string;
  input: unknown;
  content?: unknown;
  details: unknown;
  isError: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value === undefined ? null : value))
    .digest("hex");
}

const VOLATILE_KEYS = new Set([
  "activityDisplay",
  "durationMs",
  "elapsedMs",
  "finishedAt",
  "observedAt",
  "operationId",
  "sequence",
  "startedAt",
  "timestamp",
  "updatedAt",
  "usage",
]);
const COUNT_ONLY_KEYS = new Set(["attempt", "attempts", "remaining", "used"]);

function semanticValue(
  value: unknown,
  options: {
    progress?: boolean;
    omitCounts?: boolean;
    workflow?: boolean;
  } = {},
  parentKey?: string,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => semanticValue(item, options, parentKey));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      item === undefined ||
      VOLATILE_KEYS.has(key) ||
      (options.omitCounts && COUNT_ONLY_KEYS.has(key)) ||
      (options.workflow &&
        (key === "batchId" ||
          (parentKey === "decisionBatch" && key === "id") ||
          (typeof item === "number" &&
            (key === "failures" || key === "failureSequence")))) ||
      (options.progress && (key === "runId" || key === "amendmentRunId"))
        ? []
        : [[key, semanticValue(item, options, key)]],
    ),
  );
}

/** Compare work evidence without altering the live authority/grant envelopes.
 * Batch hashes encode retry counts; retain their semantic items, not those hashes.
 */
function workflowProgress(value: unknown): unknown {
  return semanticValue(value, {
    progress: true,
    omitCounts: true,
    workflow: true,
  });
}

function parentAutomaticContinuation(
  status: Record<string, unknown>,
  change: string,
): boolean {
  const continuation = isRecord(status.continuation)
    ? status.continuation
    : undefined;
  return Boolean(
    continuation?.owner === "parent" &&
      continuation.automatic === true &&
      (continuation.change === undefined || continuation.change === change) &&
      (continuation.stage === undefined ||
        continuation.stage === "abel-implement"),
  );
}

function currentRecoveryGrant(status: Record<string, unknown>): boolean {
  return Boolean(
    isRecord(status.recovery) &&
      isRecord(status.recovery.additionalAttempt) &&
      typeof status.recovery.additionalAttempt.incidentKey === "string" &&
      Number.isInteger(status.recovery.additionalAttempt.failureSequence),
  );
}

function workBudgetExhausted(status: Record<string, unknown>): boolean {
  return Boolean(
    (isRecord(status.resourceBudget) &&
      status.resourceBudget.remaining === 0) ||
      (isRecord(status.recovery) &&
        [
          "change-work-budget-exhausted",
          "change-recovery-budget-exhausted",
        ].includes(String(status.recovery.code))),
  );
}

function settleApplyRecovery(
  status: Record<string, unknown>,
  change: string,
  legalCommands: readonly unknown[],
): boolean {
  const continuation = isRecord(status.continuation)
    ? status.continuation
    : undefined;
  return Boolean(
    status.state === "recovering" &&
      isRecord(status.pause) &&
      status.pause.code === "operation-interrupted" &&
      legalCommands.includes("resume") &&
      continuation?.owner === "parent" &&
      continuation.automatic === true &&
      continuation.kind === "settle-apply-recovery" &&
      continuation.reason === "operation-interrupted" &&
      continuation.command === "resume" &&
      continuation.stage === "abel-implement" &&
      continuation.change === change,
  );
}

function matchingAmendmentAuthority(
  status: Record<string, unknown>,
  change: string,
  batchId: string | undefined,
): boolean {
  if (!batchId || !isRecord(status.decisionBatch)) return false;
  const continuation = isRecord(status.decisionBatch.continuation)
    ? status.decisionBatch.continuation
    : undefined;
  return Boolean(
    status.decisionBatch.id === batchId &&
      continuation?.action === "amend" &&
      continuation.change === change &&
      continuation.batchId === batchId,
  );
}

function lastAssistantStopReason(
  messages: readonly unknown[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") {
      return typeof message.stopReason === "string"
        ? message.stopReason
        : undefined;
    }
  }
  return undefined;
}

/** Resolve the exact argument from the original explicit slash invocation. */
export function implementChangeFromInvocation(
  text: string,
): string | undefined {
  const prefix = "/abel-implement";
  if (!text.startsWith(prefix)) return undefined;
  const boundary = text[prefix.length];
  if (boundary !== undefined && !/\s/u.test(boundary)) return undefined;
  const change = text.slice(prefix.length).trim();
  return CHANGE_NAME.test(change) ? change : undefined;
}

/** Confirm that verified package expansion retained the raw invocation identity. */
export function implementPromptBindsChange(
  prompt: string,
  expectedChange: string,
): boolean {
  if (!CHANGE_NAME.test(expectedChange)) return false;
  const close = prompt.lastIndexOf("</abel-request>");
  if (close < 0) return false;
  const open = prompt.lastIndexOf("<abel-request>", close);
  if (open < 0) return false;
  const change = prompt.slice(open + "<abel-request>".length, close).trim();
  return change === expectedChange;
}

export function isTerminalImplementStatus(status: unknown): boolean {
  if (!isRecord(status)) return false;
  return (
    status.completed === true ||
    TERMINAL_STATES.has(String(status.state)) ||
    TERMINAL_STATES.has(String(status.terminal))
  );
}

/**
 * Session-local liveness guard for one explicitly activated Implement change.
 * It owns no workflow command authority and never persists or executes a resume.
 */
export class ImplementContinuationDriver {
  #activation?: Activation;
  #inputRevision = 0;
  #nextActivationId = 1;

  noteInput(): void {
    this.#inputRevision += 1;
  }

  activate(input: { cwd: string; change: string }): void {
    this.#activation = {
      id: this.#nextActivationId++,
      cwd: input.cwd,
      change: input.change,
      inputRevision: this.#inputRevision,
      progressRevision: 0,
      stopped: false,
      seenProgress: new Set(),
      seenInvestigationEvidence: new Set(),
      investigationEvidenceRevision: 0,
      investigationRoundsUsed: 0,
      lastInvestigationEvidenceUsed: 0,
      sentContinuations: new Set(),
      reportedStalls: new Set(),
    };
  }

  beginParentTurn(cwd: string): void {
    const active = this.#activation;
    if (!active || active.cwd !== cwd || active.stopped) return;
    active.inputRevision = this.#inputRevision;
  }

  deactivate(): void {
    this.#activation = undefined;
  }

  noteToolResult(observation: ToolResultObservation): void {
    const active = this.#activation;
    if (!active || !isRecord(observation.input)) return;
    const input = observation.input;
    const toolName = observation.toolName ?? "abel_dispatch";
    if (toolName !== "abel_dispatch") {
      if (observation.isError || !INVESTIGATION_TOOLS.has(toolName)) return;
      const evidenceKey = fingerprint({
        kind: "parent-investigation",
        toolName,
        input: semanticValue(input, { progress: true, omitCounts: true }),
        content: semanticValue(observation.content, {
          progress: true,
          omitCounts: true,
        }),
        details: semanticValue(observation.details, {
          progress: true,
          omitCounts: true,
        }),
      });
      if (active.seenInvestigationEvidence.has(evidenceKey)) return;
      active.seenInvestigationEvidence.add(evidenceKey);
      active.investigationEvidenceRevision += 1;
      return;
    }
    if (input.change !== active.change) return;

    if (
      !observation.isError &&
      (input.command === "cancel" || input.command === "discard")
    ) {
      active.stopped = true;
      return;
    }
    if (observation.isError) return;

    let progressKey: string | undefined;
    if (input.action === "amend") {
      const request = isRecord(input.request) ? input.request : undefined;
      const operation = request?.operation;
      if (
        typeof input.batchId === "string" &&
        typeof operation === "string" &&
        !READ_ONLY_AMENDMENT_OPERATIONS.has(operation)
      ) {
        active.amendmentBatchId = input.batchId;
        const semanticRequest = semanticValue(request, { progress: true });
        progressKey = fingerprint({
          kind: "amendment",
          request: semanticRequest,
          result: workflowProgress(observation.details),
        });
      }
    } else if (
      input.stage === "abel-implement" &&
      ["start", "resume", "rebind"].includes(String(input.command))
    ) {
      progressKey = fingerprint({
        kind: "control",
        result: workflowProgress(observation.details),
      });
    }

    if (!progressKey || active.seenProgress.has(progressKey)) return;
    active.seenProgress.add(progressKey);
    active.progressRevision += 1;
  }

  prepareSettlement(input: {
    cwd: string;
    messages: readonly unknown[];
  }): ImplementSettlementProbe | undefined {
    const active = this.#activation;
    if (
      !active ||
      active.stopped ||
      active.cwd !== input.cwd ||
      active.inputRevision !== this.#inputRevision
    ) {
      return undefined;
    }
    const stopReason = lastAssistantStopReason(input.messages);
    if (stopReason === "aborted" || stopReason === "error") return undefined;
    return {
      activationId: active.id,
      cwd: active.cwd,
      change: active.change,
      inputRevision: active.inputRevision,
      progressRevision: active.progressRevision,
    };
  }

  finishSettlement(
    probe: ImplementSettlementProbe,
    status: unknown,
  ): ImplementSettlementDecision | undefined {
    const active = this.#activation;
    if (
      !active ||
      active.stopped ||
      active.id !== probe.activationId ||
      active.cwd !== probe.cwd ||
      active.change !== probe.change ||
      active.inputRevision !== probe.inputRevision ||
      active.inputRevision !== this.#inputRevision ||
      active.progressRevision !== probe.progressRevision ||
      !isRecord(status) ||
      status.stage !== "abel-implement" ||
      status.change !== active.change
    ) {
      return undefined;
    }

    if (isTerminalImplementStatus(status)) {
      active.stopped = true;
      return {
        kind: "terminal",
        change: active.change,
        state: String(status.state),
      };
    }
    if (
      !ACTIONABLE_STATES.has(String(status.state)) ||
      (isRecord(status.pause) && status.pause.code === "operation-cancelled")
    ) {
      if (isRecord(status.pause) && status.pause.code === "operation-cancelled")
        active.stopped = true;
      return undefined;
    }

    if (typeof status.runId === "string") {
      if (active.runId && active.runId !== status.runId) return undefined;
      active.runId = status.runId;
    }

    const legalCommands = Array.isArray(status.legalCommands)
      ? status.legalCommands
      : [];
    const automatic = parentAutomaticContinuation(status, active.change);
    const continuation = isRecord(status.continuation)
      ? status.continuation
      : undefined;
    const amendmentExhausted = Boolean(
      isRecord(status.amendmentBudget) &&
        status.amendmentBudget.exhausted === true,
    );
    const currentAmendment = matchingAmendmentAuthority(
      status,
      active.change,
      active.amendmentBatchId,
    );
    const actionable =
      (status.state === "not-started" && legalCommands.includes("start")) ||
      (automatic &&
        !(continuation?.action === "amend" && amendmentExhausted)) ||
      currentRecoveryGrant(status) ||
      (currentAmendment && !amendmentExhausted);
    if (
      !actionable ||
      (workBudgetExhausted(status) &&
        !settleApplyRecovery(status, active.change, legalCommands))
    )
      return undefined;

    const evidence = workflowProgress(status);
    // A successful control call returning already observed failure evidence is
    // not progress, even on the first retry after a read-only status observation.
    active.seenProgress.add(fingerprint({ kind: "control", result: evidence }));
    const statusFingerprint = fingerprint(evidence);
    const workflowEvidenceKey = fingerprint({
      progressRevision: active.progressRevision,
      statusFingerprint,
    });
    const baseContinuationKey = fingerprint({
      inputRevision: active.inputRevision,
      workflowEvidenceKey,
      kind: "workflow",
    });
    let continuationKey: string | undefined;
    if (active.lastWorkflowEvidenceKey !== workflowEvidenceKey) {
      active.lastWorkflowEvidenceKey = workflowEvidenceKey;
      active.investigationRoundsUsed = 0;
      active.lastInvestigationEvidenceUsed =
        active.investigationEvidenceRevision;
      continuationKey = baseContinuationKey;
    } else if (!active.sentContinuations.has(baseContinuationKey)) {
      active.lastInvestigationEvidenceUsed =
        active.investigationEvidenceRevision;
      continuationKey = baseContinuationKey;
    } else if (
      active.investigationEvidenceRevision >
        active.lastInvestigationEvidenceUsed &&
      active.investigationRoundsUsed < MAX_INVESTIGATION_CONTINUATIONS
    ) {
      active.investigationRoundsUsed += 1;
      active.lastInvestigationEvidenceUsed =
        active.investigationEvidenceRevision;
      continuationKey = fingerprint({
        baseContinuationKey,
        kind: "investigation",
        round: active.investigationRoundsUsed,
      });
    }

    if (!continuationKey || active.sentContinuations.has(continuationKey)) {
      const stalledKey = fingerprint({
        baseContinuationKey,
        investigationEvidenceRevision: active.lastInvestigationEvidenceUsed,
        investigationRoundsUsed: active.investigationRoundsUsed,
      });
      if (active.reportedStalls.has(stalledKey)) return undefined;
      active.reportedStalls.add(stalledKey);
      return {
        kind: "stalled",
        change: active.change,
        code: "implement-continuation-no-progress",
        state: String(status.state),
        statusFingerprint,
        message:
          active.investigationRoundsUsed >= MAX_INVESTIGATION_CONTINUATIONS
            ? `Abel Implement retained ${active.change} in ${String(status.state)} state but stopped automatic continuation because workflow and control evidence did not advance after two bounded investigation rounds. New investigation evidence was observed without durable workflow progress; retained progress is preserved.`
            : `Abel Implement retained ${active.change} in ${String(status.state)} state but stopped automatic continuation because the fresh local status and implementation evidence did not change. Durable progress is preserved.`,
      };
    }
    active.sentContinuations.add(continuationKey);

    return {
      kind: "continue",
      change: active.change,
      statusFingerprint,
      message: [
        `[Abel host continuation for ${active.change}]`,
        "The explicitly activated Implement run is still nonterminal after the previous parent response ended.",
        `Fresh local status: ${JSON.stringify(status)}`,
        "Continue the same accepted goal now. Inspect this current evidence, repair or amend within existing authority, and use only a legal closed abel_dispatch request when the evidence supports it.",
        "The status continuation object is guidance metadata, not dispatch arguments. Do not replay an earlier command blindly, do not merely poll status, and do not ask the user to choose routine implementation or recovery steps.",
        "Stop only for verified completion, explicit cancellation, or a concrete external condition that available capabilities and retained budgets cannot resolve.",
      ].join("\n"),
    };
  }
}
