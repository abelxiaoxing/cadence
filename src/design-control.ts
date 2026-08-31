import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isValidRelativePath } from "./contracts.ts";
import {
  assessDeliveryTraceability,
  compileGateAReceipt,
  compileImplementPlan,
  compileReadyReceipt,
  type DeliveryArtifactBinding,
  DesignPlanValidationError,
  type GateApprovalProof,
  parseGateAReceipt,
  parseImplementPlan,
  parseReadyReceipt,
} from "./delivery-compiler.ts";
import {
  type DesignArtifactOperationFacts,
  type DesignArtifactOperationOutcome,
  DesignJournal,
  type DesignStatusProjection,
} from "./design-journal.ts";
import { RunStore } from "./run-store.ts";
import { observeSafePath } from "./safe-path.ts";
import type { ResolvedStateRoot } from "./state-root.ts";

const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const ARTIFACT_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/iu;
const MAX_DESIGN_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DESIGN_REQUIREMENT_BYTES = 64 * 1024;
const MAX_DESIGN_CONTRACT_BYTES = 256 * 1024;

export interface DesignOpenSpecInspection {
  change: string;
  schema: string;
  planningComplete: boolean;
  strictValid: boolean;
  artifactPaths: string[];
}

export type DesignControlRequest =
  | {
      operation: "start";
      operationId: string;
      requirement: string;
    }
  | {
      operation: "start";
      operationId: string;
      change: string;
    }
  | {
      operation: "status";
      runId: string;
    }
  | {
      operation: "bind-change";
      runId: string;
      operationId: string;
      change: string;
    }
  | {
      operation: "record-decision";
      runId: string;
      operationId: string;
      decisionId: string;
      category: "behavior" | "technical";
      contract: string;
      refs: string[];
    }
  | {
      operation: "approve-gate";
      runId: string;
      operationId: string;
      gate: "gate-a";
      contract: string;
    }
  | {
      operation: "approve-gate";
      runId: string;
      operationId: string;
      gate: "gate-b";
    }
  | {
      operation: "validate-plan-draft";
      runId: string;
    }
  | {
      operation: "compile-plan";
      runId: string;
      operationId: string;
    }
  | {
      operation: "finalize-delivery";
      runId: string;
      operationId: string;
    }
  | {
      operation: "write-artifact";
      runId: string;
      operationId: string;
      path: string;
      content: string;
    }
  | {
      operation: "delete-artifact";
      runId: string;
      operationId: string;
      path: string;
    };

export interface DesignControllerOptions {
  consumerRoot: string;
  stateRoot: ResolvedStateRoot;
  now?: () => number;
  finalizationLeaseMs?: number;
  inspectOpenSpec: (
    consumerRoot: string,
    change: string,
  ) => Promise<DesignOpenSpecInspection>;
}

export class DesignFinalizationError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    const normalized = [...new Set(diagnostics)].sort();
    super("design-finalization-invalid");
    this.name = "DesignFinalizationError";
    this.diagnostics = Object.freeze(normalized);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function normalizedTransientText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function transientHash(domain: string, value: string): string {
  return createHash("sha256")
    .update(domain)
    .update("\0")
    .update(normalizedTransientText(value))
    .digest("hex");
}

function lifecycleOperationId(kind: string, runId: string): string {
  return `design-${kind}-${createHash("sha256")
    .update(runId)
    .digest("hex")
    .slice(0, 32)}`;
}

export function validateDesignControlRequest(
  value: unknown,
):
  | { ok: true; value: DesignControlRequest }
  | { ok: false; code: "invalid-design-control-request" } {
  if (!isRecord(value))
    return { ok: false, code: "invalid-design-control-request" };
  if (value.operation === "start") {
    const operationValid =
      typeof value.operationId === "string" &&
      IDENTIFIER.test(value.operationId);
    if (!operationValid)
      return { ok: false, code: "invalid-design-control-request" };
    if (
      exactKeys(value, ["operation", "operationId", "requirement"]) &&
      typeof value.requirement === "string" &&
      value.requirement.trim().length > 0 &&
      Buffer.byteLength(value.requirement, "utf8") <=
        MAX_DESIGN_REQUIREMENT_BYTES
    ) {
      return {
        ok: true,
        value: structuredClone(value) as DesignControlRequest,
      };
    }
    return exactKeys(value, ["operation", "operationId", "change"]) &&
      typeof value.change === "string" &&
      CHANGE_NAME.test(value.change)
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (
    value.operation === "status" ||
    value.operation === "validate-plan-draft"
  ) {
    return exactKeys(value, ["operation", "runId"]) &&
      typeof value.runId === "string" &&
      IDENTIFIER.test(value.runId)
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  const commonValid =
    typeof value.runId === "string" &&
    IDENTIFIER.test(value.runId) &&
    typeof value.operationId === "string" &&
    IDENTIFIER.test(value.operationId);
  if (!commonValid)
    return { ok: false, code: "invalid-design-control-request" };
  if (value.operation === "bind-change") {
    return exactKeys(value, ["operation", "runId", "operationId", "change"]) &&
      typeof value.change === "string" &&
      CHANGE_NAME.test(value.change)
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (value.operation === "write-artifact") {
    return exactKeys(value, [
      "operation",
      "runId",
      "operationId",
      "path",
      "content",
    ]) &&
      typeof value.path === "string" &&
      typeof value.content === "string"
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (value.operation === "delete-artifact") {
    return exactKeys(value, ["operation", "runId", "operationId", "path"]) &&
      typeof value.path === "string"
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (
    value.operation === "compile-plan" ||
    value.operation === "finalize-delivery"
  ) {
    return exactKeys(value, ["operation", "runId", "operationId"])
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (value.operation === "approve-gate") {
    if (value.gate === "gate-b") {
      return exactKeys(value, ["operation", "runId", "operationId", "gate"])
        ? { ok: true, value: structuredClone(value) as DesignControlRequest }
        : { ok: false, code: "invalid-design-control-request" };
    }
    return value.gate === "gate-a" &&
      exactKeys(value, [
        "operation",
        "runId",
        "operationId",
        "gate",
        "contract",
      ]) &&
      typeof value.contract === "string" &&
      value.contract.trim().length > 0 &&
      Buffer.byteLength(value.contract, "utf8") <= MAX_DESIGN_CONTRACT_BYTES
      ? { ok: true, value: structuredClone(value) as DesignControlRequest }
      : { ok: false, code: "invalid-design-control-request" };
  }
  if (value.operation !== "record-decision") {
    return { ok: false, code: "invalid-design-control-request" };
  }
  return exactKeys(value, [
    "operation",
    "runId",
    "operationId",
    "decisionId",
    "category",
    "contract",
    "refs",
  ]) &&
    typeof value.decisionId === "string" &&
    IDENTIFIER.test(value.decisionId) &&
    (value.category === "behavior" || value.category === "technical") &&
    typeof value.contract === "string" &&
    value.contract.trim().length > 0 &&
    Buffer.byteLength(value.contract, "utf8") <= MAX_DESIGN_CONTRACT_BYTES &&
    Array.isArray(value.refs) &&
    value.refs.every((ref) => typeof ref === "string")
    ? { ok: true, value: structuredClone(value) as DesignControlRequest }
    : { ok: false, code: "invalid-design-control-request" };
}

function safeRelative(change: string, name: string): string {
  if (!CHANGE_NAME.test(change)) throw new Error("design-change-invalid");
  return `openspec/changes/${change}/${name}`;
}

function isAllowedDesignArtifactPath(relative: string): boolean {
  if (!isValidRelativePath(relative)) return false;
  if (
    [
      ".openspec.yaml",
      "proposal.md",
      "design.md",
      "tasks.md",
      "plan-draft.json",
    ].includes(relative)
  ) {
    return true;
  }
  const segments = relative.split("/");
  return (
    segments.length >= 3 &&
    segments[0] === "specs" &&
    segments.at(-1) === "spec.md" &&
    segments.slice(1, -1).every((segment) => ARTIFACT_SEGMENT.test(segment))
  );
}

function designArtifactRelative(change: string, relative: string): string {
  if (!isAllowedDesignArtifactPath(relative)) {
    throw new Error("design-artifact-path-invalid");
  }
  return safeRelative(change, relative);
}

function ensureSafeDirectory(root: string, relative: string): void {
  const segments = relative.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments.slice(0, index + 1).join("/");
    const observation = observeSafePath(root, current);
    if (observation.kind === "directory") continue;
    if (observation.kind !== "absent") {
      throw new Error("design-artifact-path-unsafe");
    }
    const parent = index === 0 ? "." : segments.slice(0, index).join("/");
    if (observeSafePath(root, parent).kind !== "directory") {
      throw new Error("design-artifact-path-unsafe");
    }
    try {
      mkdirSync(path.join(root, ...current.split("/")), { mode: 0o755 });
    } catch {
      if (observeSafePath(root, current).kind !== "directory") {
        throw new Error("design-artifact-path-unsafe");
      }
    }
    if (observeSafePath(root, current).kind !== "directory") {
      throw new Error("design-artifact-path-unsafe");
    }
  }
}

function boundedArtifactBytes(root: string, relative: string): Buffer {
  if (observeSafePath(root, relative).kind !== "file") {
    throw new Error("design-artifact-path-unsafe");
  }
  const absolute = path.join(root, ...relative.split("/"));
  const size = lstatSync(absolute).size;
  if (size > MAX_DESIGN_FILE_BYTES) {
    throw new Error("design-artifact-content-too-large");
  }
  return readFileSync(absolute);
}

function readSafeFile(
  root: string,
  relative: string,
  maximum = MAX_DESIGN_FILE_BYTES,
): Buffer {
  if (observeSafePath(root, relative).kind !== "file") {
    throw new Error("design-file-unavailable");
  }
  const absolute = path.join(root, ...relative.split("/"));
  const size = lstatSync(absolute).size;
  if (size < 1 || size > maximum) throw new Error("design-file-size-invalid");
  return readFileSync(absolute);
}

function removeSafeFile(root: string, relative: string): void {
  const observation = observeSafePath(root, relative);
  if (observation.kind === "absent") return;
  if (observation.kind !== "file") throw new Error("design-file-unsafe");
  unlinkSync(path.join(root, ...relative.split("/")));
}

function removeSafeFileWithHash(
  root: string,
  relative: string,
  expectedHash: string,
): void {
  const observation = observeSafePath(root, relative);
  if (observation.kind === "absent") return;
  if (observation.kind !== "file") throw new Error("design-file-unsafe");
  const bytes = readSafeFile(root, relative, 4 * 1024 * 1024);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) return;
  unlinkSync(path.join(root, ...relative.split("/")));
}

function atomicWrite(root: string, relative: string, bytes: Uint8Array): void {
  const parent = path.posix.dirname(relative);
  if (observeSafePath(root, parent).kind !== "directory") {
    throw new Error("design-file-parent-unsafe");
  }
  const targetObservation = observeSafePath(root, relative);
  if (
    targetObservation.kind !== "file" &&
    targetObservation.kind !== "absent"
  ) {
    throw new Error("design-file-unsafe");
  }
  const temporary = `${parent}/.abel-${path.posix.basename(relative)}-${randomUUID()}.tmp`;
  if (observeSafePath(root, temporary).kind !== "absent") {
    throw new Error("design-temporary-file-conflict");
  }
  const temporaryAbsolute = path.join(root, ...temporary.split("/"));
  try {
    writeFileSync(temporaryAbsolute, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporaryAbsolute, path.join(root, ...relative.split("/")));
  } catch (error) {
    try {
      if (observeSafePath(root, temporary).kind === "file") {
        unlinkSync(temporaryAbsolute);
      }
    } catch {
      // The original safe failure remains authoritative.
    }
    throw error;
  }
}

function proof(status: DesignStatusProjection, gate: "gateA" | "gateB") {
  const projection = status.gates[gate];
  if (!projection.current || !projection.proof) {
    throw new DesignFinalizationError([
      gate === "gateA" ? "design-gate-a-stale" : "design-gate-b-stale",
    ]);
  }
  return structuredClone(projection.proof) as GateApprovalProof;
}

export class DesignController {
  readonly consumerRoot: string;
  readonly #journal: DesignJournal;
  readonly #runs: RunStore;
  readonly #inspectOpenSpec: DesignControllerOptions["inspectOpenSpec"];
  #closed = false;

  private constructor(options: DesignControllerOptions) {
    this.consumerRoot = path.resolve(options.consumerRoot);
    this.#runs = RunStore.open(options.stateRoot);
    this.#journal = DesignJournal.open(options.stateRoot, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.finalizationLeaseMs !== undefined
        ? { finalizationLeaseMs: options.finalizationLeaseMs }
        : {}),
    });
    this.#inspectOpenSpec = options.inspectOpenSpec;
  }

  static open(options: DesignControllerOptions): DesignController {
    return new DesignController(options);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("design-controller-closed");
  }

  status(runId: string): DesignStatusProjection {
    this.#assertOpen();
    return this.#journal.status(runId);
  }

  assertDesignRun(runId: string): void {
    this.#assertOpen();
    this.#journal.assertDesignRun(runId);
  }

  recordEvidence(input: Parameters<DesignJournal["recordEvidence"]>[0]) {
    this.#assertOpen();
    return this.#journal.recordEvidence(input);
  }

  verifyGateProof(input: Parameters<DesignJournal["verifyGateProof"]>[0]) {
    this.#assertOpen();
    return this.#journal.verifyGateProof(input);
  }

  verifyFinalizedDelivery(
    input: Parameters<DesignJournal["verifyFinalizedDelivery"]>[0],
  ) {
    this.#assertOpen();
    return this.#journal.verifyFinalizedDelivery(input);
  }

  async execute(value: unknown): Promise<Record<string, unknown>> {
    this.#assertOpen();
    const validation = validateDesignControlRequest(value);
    if (!validation.ok) throw new Error(validation.code);
    const request = validation.value;
    switch (request.operation) {
      case "start":
        return this.#start(request);
      case "status":
        return this.#statusOutcome(request.runId);
      case "bind-change":
        return this.#bindChange(request);
      case "record-decision":
        return this.#journal.recordDecision(request);
      case "approve-gate":
        return this.#journal.approveGate(request);
      case "validate-plan-draft":
        return this.#validatePlanDraft(request);
      case "compile-plan":
        return this.#compilePlan(request);
      case "finalize-delivery":
        return this.#finalizeDelivery(request);
      case "write-artifact":
        return this.#writeArtifact(request);
      case "delete-artifact":
        return this.#deleteArtifact(request);
    }
  }

  #statusOutcome(runId: string): Record<string, unknown> {
    const run = this.#runs.status(runId);
    if (run.stage !== "abel-design") throw new Error("design-run-invalid");
    const terminal = ["completed", "discarded", "rejected"].includes(run.state);
    const design = this.#journal.status(runId);
    const latestDecisionSequence = design.decisions.reduce(
      (latest, decision) => Math.max(latest, decision.sequence),
      0,
    );
    const planReadyForGateB =
      design.gates.gateA.current &&
      design.plan !== null &&
      design.plan.sequence >
        Math.max(
          design.gates.gateA.approvedSequence ?? 0,
          latestDecisionSequence,
        );
    const canApproveGate =
      !design.gates.gateA.current ||
      (planReadyForGateB && !design.gates.gateB.current);
    const legalOperations = terminal
      ? ["status"]
      : [
          "status",
          "record-decision",
          ...(canApproveGate ? ["approve-gate"] : []),
          ...(design.gates.gateA.current && !design.change
            ? ["bind-change"]
            : []),
          ...(design.gates.gateA.current && design.change
            ? [
                "write-artifact",
                "delete-artifact",
                "validate-plan-draft",
                "compile-plan",
              ]
            : []),
          ...(design.change &&
          design.plan &&
          design.gates.gateA.current &&
          design.gates.gateB.current
            ? ["finalize-delivery"]
            : []),
        ];
    return {
      runId: run.runId,
      stage: run.stage,
      ...(run.change ? { change: run.change } : {}),
      state: run.state,
      completed: run.state === "completed",
      ...(run.pauseCode ? { pause: { code: run.pauseCode } } : {}),
      legalOperations,
      packetActions: terminal ? [] : ["finish"],
      design,
    };
  }

  #start(request: Extract<DesignControlRequest, { operation: "start" }>) {
    const fromRequirement = "requirement" in request;
    const run = this.#runs.startRun({
      stage: "abel-design",
      ...(fromRequirement
        ? {
            provisionalKey: transientHash(
              "abel-design-requirement",
              request.requirement,
            ),
          }
        : { change: request.change }),
      operationId: request.operationId,
    });
    if (run.state === "created") {
      this.#runs.transition({
        runId: run.runId,
        to: "paused",
        operationId: lifecycleOperationId(
          fromRequirement ? "await-gate-a" : "await-evidence",
          run.runId,
        ),
        code: fromRequirement
          ? "design-awaiting-gate-a"
          : "design-awaiting-evidence",
      });
    }
    return this.#statusOutcome(run.runId);
  }

  #bindChange(
    request: Extract<DesignControlRequest, { operation: "bind-change" }>,
  ) {
    const run = this.#runs.status(request.runId);
    if (run.change && run.change !== request.change) {
      throw new Error("design-operation-conflict");
    }
    if (!run.change) {
      const design = this.#journal.status(request.runId);
      if (!design.gates.gateA.current)
        throw new Error("design-gate-a-required");
    }
    const bound = this.#runs.bindChange({
      runId: request.runId,
      change: request.change,
      operationId: request.operationId,
    });
    if (bound.state === "paused") {
      this.#runs.transition({
        runId: request.runId,
        to: "paused",
        operationId: lifecycleOperationId("bound", request.runId),
        code: "design-awaiting-evidence",
      });
    }
    return this.#statusOutcome(request.runId);
  }

  #artifactRun(runId: string): { change: string; gateACurrent: boolean } {
    const status = this.#journal.status(runId);
    if (!status.change) throw new Error("design-change-required");
    return {
      change: status.change,
      gateACurrent: status.gates.gateA.current,
    };
  }

  #writeArtifact(
    request: Extract<DesignControlRequest, { operation: "write-artifact" }>,
  ): DesignArtifactOperationOutcome {
    const artifactRun = this.#artifactRun(request.runId);
    const change = artifactRun.change;
    const relative = designArtifactRelative(change, request.path);
    const bytes = Buffer.from(request.content, "utf8");
    if (bytes.toString("utf8") !== request.content) {
      throw new Error("design-artifact-content-invalid");
    }
    if (bytes.length > MAX_DESIGN_FILE_BYTES) {
      throw new Error("design-artifact-content-too-large");
    }
    const facts: DesignArtifactOperationFacts = {
      runId: request.runId,
      operationId: request.operationId,
      operation: request.operation,
      path: request.path,
      bytes: bytes.length,
      rawSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const replay = this.#journal.artifactOperationState(facts);
    if (replay?.state === "committed") return replay.outcome;
    if (!replay && !artifactRun.gateACurrent) {
      throw new Error("design-gate-a-required");
    }
    const lease = this.#journal.acquireFinalizationLease({
      runId: request.runId,
      operationId: request.operationId,
    });
    try {
      const outcome: DesignArtifactOperationOutcome = {
        operation: request.operation,
        runId: request.runId,
        path: request.path,
        bytes: facts.bytes,
        rawSha256: facts.rawSha256,
      };
      ensureSafeDirectory(this.consumerRoot, path.posix.dirname(relative));
      const target = observeSafePath(this.consumerRoot, relative);
      if (target.kind !== "file" && target.kind !== "absent") {
        throw new Error("design-artifact-path-unsafe");
      }
      const prepared = this.#journal.prepareArtifactOperation(
        facts,
        lease,
        outcome,
      );
      if (prepared.state === "committed") return prepared.outcome;
      atomicWrite(this.consumerRoot, relative, bytes);
      return this.#journal.commitArtifactOperation(facts, lease);
    } finally {
      this.#journal.releaseFinalizationLease(lease);
    }
  }

  #deleteArtifact(
    request: Extract<DesignControlRequest, { operation: "delete-artifact" }>,
  ): DesignArtifactOperationOutcome {
    const artifactRun = this.#artifactRun(request.runId);
    const change = artifactRun.change;
    const relative = designArtifactRelative(change, request.path);
    const facts: DesignArtifactOperationFacts = {
      runId: request.runId,
      operationId: request.operationId,
      operation: request.operation,
      path: request.path,
    };
    const replay = this.#journal.artifactOperationState(facts);
    if (replay?.state === "committed") return replay.outcome;
    if (!replay && !artifactRun.gateACurrent) {
      throw new Error("design-gate-a-required");
    }
    const lease = this.#journal.acquireFinalizationLease({
      runId: request.runId,
      operationId: request.operationId,
    });
    try {
      let outcome = replay?.outcome;
      if (!outcome) {
        const observation = observeSafePath(this.consumerRoot, relative);
        if (observation.kind === "absent") {
          outcome = {
            operation: request.operation,
            runId: request.runId,
            path: request.path,
            deleted: false,
          };
        } else if (observation.kind === "file") {
          const bytes = boundedArtifactBytes(this.consumerRoot, relative);
          outcome = {
            operation: request.operation,
            runId: request.runId,
            path: request.path,
            deleted: true,
            bytes: bytes.length,
            rawSha256: createHash("sha256").update(bytes).digest("hex"),
          };
        } else {
          throw new Error("design-artifact-path-unsafe");
        }
      }
      const prepared = this.#journal.prepareArtifactOperation(
        facts,
        lease,
        outcome,
      );
      if (prepared.state === "committed") return prepared.outcome;
      const intended = prepared.outcome;
      if (intended.operation !== "delete-artifact") {
        throw new Error("design-artifact-operation-outcome-invalid");
      }
      if (intended.deleted) {
        const observation = observeSafePath(this.consumerRoot, relative);
        if (observation.kind === "file") {
          const current = boundedArtifactBytes(this.consumerRoot, relative);
          if (
            current.length !== intended.bytes ||
            createHash("sha256").update(current).digest("hex") !==
              intended.rawSha256
          ) {
            throw new Error("design-artifact-currentness-invalid");
          }
          unlinkSync(path.join(this.consumerRoot, ...relative.split("/")));
        } else if (observation.kind !== "absent") {
          throw new Error("design-artifact-path-unsafe");
        }
      }
      return this.#journal.commitArtifactOperation(facts, lease);
    } finally {
      this.#journal.releaseFinalizationLease(lease);
    }
  }

  #readCompiledDraft(runId: string) {
    const status = this.#journal.status(runId);
    if (!status.change) throw new Error("design-change-required");
    if (!status.gates.gateA.current) throw new Error("design-gate-a-required");
    const draftPath = safeRelative(status.change, "plan-draft.json");
    const draftBytes = readSafeFile(this.consumerRoot, draftPath);
    let draft: unknown;
    try {
      draft = JSON.parse(draftBytes.toString("utf8"));
    } catch {
      throw new DesignPlanValidationError("design-plan-draft-invalid", [
        { code: "design-plan-draft-invalid", field: "plan-draft.json" },
      ]);
    }
    const compiled = compileImplementPlan(draft, {
      consumerRoot: this.consumerRoot,
    });
    if (compiled.plan.changeId !== status.change) {
      throw new DesignPlanValidationError("design-plan-change-mismatch", [
        { code: "design-plan-change-mismatch", field: "changeId" },
      ]);
    }
    return { status, compiled };
  }

  #validatePlanDraft(
    request: Extract<
      DesignControlRequest,
      { operation: "validate-plan-draft" }
    >,
  ) {
    const { compiled } = this.#readCompiledDraft(request.runId);
    return {
      operation: request.operation,
      runId: request.runId,
      valid: true,
      plan: {
        taskCount: compiled.plan.tasks.length,
        outputCount: compiled.plan.outputs.length,
        rawSha256: compiled.rawSha256,
        canonicalHash: compiled.planHash,
      },
    };
  }

  #compilePlan(
    request: Extract<DesignControlRequest, { operation: "compile-plan" }>,
  ) {
    const replay = this.#journal.operationOutcome(
      request.runId,
      request.operationId,
      request.operation,
    );
    if (replay) return replay;
    const lease = this.#journal.acquireFinalizationLease({
      runId: request.runId,
      operationId: request.operationId,
    });
    try {
      this.#journal.assertNoPendingArtifactOperations(request.runId);
      const { status, compiled } = this.#readCompiledDraft(request.runId);
      const change = status.change;
      if (!change) throw new Error("design-change-required");
      const readyPath = safeRelative(change, "ready.yaml");
      const gateAPath = safeRelative(change, "gate-a.yaml");
      removeSafeFile(this.consumerRoot, readyPath);
      removeSafeFile(this.consumerRoot, gateAPath);
      this.#journal.assertFinalizationLease(lease);
      atomicWrite(
        this.consumerRoot,
        safeRelative(change, "implement-plan.json"),
        compiled.bytes,
      );
      return this.#journal.recordCompiledPlan({
        runId: request.runId,
        operationId: request.operationId,
        bytes: compiled.bytes,
        rawSha256: compiled.rawSha256,
        canonicalHash: compiled.planHash,
        lease,
      });
    } finally {
      this.#journal.releaseFinalizationLease(lease);
    }
  }

  async #finalizeDelivery(
    request: Extract<DesignControlRequest, { operation: "finalize-delivery" }>,
  ) {
    const replay = this.#journal.operationOutcome(
      request.runId,
      request.operationId,
      request.operation,
    );
    if (replay) {
      this.#completeFinalizedRun(request.runId, request.operationId);
      return replay;
    }
    const committed = this.#journal.latestFinalizationOutcome(request.runId);
    if (committed) {
      this.#completeFinalizedRun(request.runId, committed.operationId);
      return committed.outcome;
    }
    const status = this.#journal.status(request.runId);
    if (!status.change) throw new Error("design-change-required");
    const gateA = proof(status, "gateA");
    const gateB = proof(status, "gateB");
    const storedPlan = this.#journal.currentCompiledPlan(request.runId);
    if (!storedPlan) throw new DesignFinalizationError(["design-plan-missing"]);
    const change = status.change;
    const readyPath = safeRelative(change, "ready.yaml");
    const gateAPath = safeRelative(change, "gate-a.yaml");
    const lease = this.#journal.acquireFinalizationLease({
      runId: request.runId,
      operationId: request.operationId,
    });
    let readyInstalled = false;
    let readyHash: string | undefined;
    let finalizationCommitted = false;
    try {
      this.#journal.assertNoPendingArtifactOperations(request.runId);
      removeSafeFile(this.consumerRoot, readyPath);
      const diagnostics = new Set<string>();
      let inspection: DesignOpenSpecInspection | undefined;
      try {
        inspection = await this.#inspectOpenSpec(this.consumerRoot, change);
      } catch {
        diagnostics.add("design-openspec-unavailable");
      }
      if (inspection) {
        if (inspection.change !== change)
          diagnostics.add("design-change-mismatch");
        if (!inspection.strictValid)
          diagnostics.add("design-openspec-strict-invalid");
        if (!inspection.planningComplete)
          diagnostics.add("design-openspec-incomplete");
        if (!inspection.schema)
          diagnostics.add("design-openspec-schema-invalid");
      }
      const installedPlanBytes = readSafeFile(
        this.consumerRoot,
        safeRelative(change, "implement-plan.json"),
      );
      if (
        !Buffer.from(installedPlanBytes).equals(Buffer.from(storedPlan.bytes))
      ) {
        diagnostics.add("design-plan-binding-invalid");
      }
      let compiled: ReturnType<typeof compileImplementPlan> | undefined;
      try {
        const plan = parseImplementPlan(installedPlanBytes);
        compiled = compileImplementPlan(plan, {
          consumerRoot: this.consumerRoot,
        });
        if (
          compiled.planHash !== storedPlan.projection.canonicalHash ||
          compiled.rawSha256 !== storedPlan.projection.rawSha256
        ) {
          diagnostics.add("design-plan-binding-invalid");
        }
      } catch {
        diagnostics.add("design-plan-invalid");
      }
      const artifacts: DeliveryArtifactBinding[] = [];
      const artifactBytes = new Map<string, Buffer>();
      for (const relative of inspection?.artifactPaths ?? []) {
        if (
          [
            "gate-a.yaml",
            "ready.yaml",
            "implement-plan.json",
            "plan-draft.json",
          ].includes(relative)
        ) {
          diagnostics.add(`design-artifact-reserved:${relative}`);
          continue;
        }
        try {
          const bytes = readSafeFile(
            this.consumerRoot,
            safeRelative(change, relative),
          );
          artifactBytes.set(relative, bytes);
          artifacts.push({
            path: relative,
            rawSha256: createHash("sha256").update(bytes).digest("hex"),
          });
        } catch {
          diagnostics.add(`design-artifact-unavailable:${relative}`);
        }
      }
      let traceability:
        | ReturnType<typeof assessDeliveryTraceability>
        | undefined;
      if (compiled) {
        const tasks = artifactBytes.get("tasks.md");
        const specs = [...artifactBytes]
          .filter(
            ([relative]) =>
              relative.startsWith("specs/") && relative.endsWith("/spec.md"),
          )
          .map(([relative, bytes]) => ({
            path: relative,
            text: bytes.toString("utf8"),
          }));
        if (!tasks || specs.length === 0) {
          diagnostics.add("design-traceability-input-unavailable");
        } else {
          traceability = assessDeliveryTraceability({
            tasksMarkdown: tasks.toString("utf8"),
            specs,
            plan: compiled.plan,
          });
          if (!traceability.ok) {
            for (const diagnostic of traceability.diagnostics)
              diagnostics.add(diagnostic);
          }
        }
      }
      if (
        !inspection ||
        !compiled ||
        !traceability?.ok ||
        diagnostics.size > 0
      ) {
        throw new DesignFinalizationError([...diagnostics]);
      }
      const gateAReceipt = compileGateAReceipt({
        change,
        schema: inspection.schema,
        approval: gateA,
        artifacts,
      });
      const deliveryRevision = this.#journal.nextDeliveryRevision(
        request.runId,
      );
      const readyReceipt = compileReadyReceipt({
        change,
        schema: inspection.schema,
        deliveryRevision,
        gateA: { rawSha256: gateAReceipt.rawSha256 },
        gateB,
        artifacts,
        compiledPlan: compiled,
        traceability: traceability.value,
      });
      readyHash = readyReceipt.rawSha256;
      this.#journal.assertFinalizationLease(lease);
      atomicWrite(this.consumerRoot, gateAPath, gateAReceipt.bytes);
      atomicWrite(this.consumerRoot, readyPath, readyReceipt.bytes);
      readyInstalled = true;
      const installedGateA = readSafeFile(this.consumerRoot, gateAPath);
      const installedReady = readSafeFile(this.consumerRoot, readyPath);
      parseGateAReceipt(installedGateA);
      parseReadyReceipt(installedReady);
      if (
        !Buffer.from(installedGateA).equals(Buffer.from(gateAReceipt.bytes)) ||
        !Buffer.from(installedReady).equals(Buffer.from(readyReceipt.bytes))
      ) {
        throw new Error("design-installed-delivery-mismatch");
      }
      removeSafeFile(
        this.consumerRoot,
        safeRelative(change, "plan-draft.json"),
      );
      const outcome = this.#journal.recordFinalization({
        runId: request.runId,
        operationId: request.operationId,
        lease,
        deliveryRevision,
        receiptHash: readyReceipt.rawSha256,
        gateA,
        gateB,
        planCanonicalHash: compiled.planHash,
      });
      finalizationCommitted = true;
      this.#completeFinalizedRun(request.runId, request.operationId);
      return outcome;
    } catch (error) {
      if (readyInstalled && readyHash && !finalizationCommitted) {
        try {
          removeSafeFileWithHash(this.consumerRoot, readyPath, readyHash);
        } catch {
          // The original finalization failure remains authoritative.
        }
      }
      throw error;
    } finally {
      this.#journal.releaseFinalizationLease(lease);
    }
  }

  #completeFinalizedRun(runId: string, operationId: string): void {
    const currentRun = this.#runs.status(runId);
    if (currentRun.state === "completed") return;
    this.#runs.transition({
      runId,
      to: "completed",
      operationId: `${operationId}:design-completed`,
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#journal.close();
    this.#runs.close();
    this.#closed = true;
  }
}
