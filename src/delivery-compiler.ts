import { createHash } from "node:crypto";
import {
  type AgentsImpact,
  type ImplementGraphBoundary,
  type ImplementGraphOutput,
  type ImplementTaskBoundary,
  isAgentsPath,
  isValidRelativePath,
  type PhaseBoundary,
  type StructuredVerificationContract,
  validateImplementGraphBoundary,
  validateVerificationContract,
} from "./contracts.ts";
import {
  assessImplementGraphReadiness,
  canonicalJson,
  hashCanonicalValue,
  type ImplementGraphReadiness,
} from "./implement-graph.ts";
import { validateVerificationAdapterCapability } from "./verification-capability.ts";

export const IMPLEMENT_PLAN_PATH = "implement-plan.json" as const;
export const GATE_A_RECEIPT_PATH = "gate-a.yaml" as const;
export const READY_RECEIPT_PATH = "ready.yaml" as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const CHANGE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
const AGENTS_START = "<!-- ABEL:AGENTS-INDEX:START -->";
const AGENTS_END = "<!-- ABEL:AGENTS-INDEX:END -->";

export interface DeliveryArtifactBinding {
  path: string;
  rawSha256: string;
}

export interface GateApprovalProof {
  revision: number;
  contractHash: string;
  recordHash: string;
}

export interface GateAReceipt {
  change: string;
  schema: string;
  approval: GateApprovalProof;
  artifacts: DeliveryArtifactBinding[];
}

export interface DeliveryTraceability {
  taskPath: "tasks.md";
  referenceCount: number;
  taskCount: number;
  verificationCount: number;
  canonicalHash: string;
}

export interface ReadyReceipt {
  change: string;
  schema: string;
  deliveryRevision: number;
  approvals: {
    gateA: {
      path: typeof GATE_A_RECEIPT_PATH;
      rawSha256: string;
    };
    gateB: {
      revision: number;
      contractHash: string;
      recordHash: string;
    };
  };
  artifacts: DeliveryArtifactBinding[];
  plan: CompiledDelivery["receipt"]["plan"];
  verificationClosure: ImplementGraphReadiness["closure"];
  traceability: DeliveryTraceability;
  openspec: {
    strict: true;
    planningComplete: true;
  };
}

export type DeliveryTraceabilityAssessment =
  | { ok: true; value: DeliveryTraceability }
  | { ok: false; diagnostics: string[] };

export class DeliveryValidationError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    const normalized = [...new Set(diagnostics)].sort();
    super("delivery-invalid");
    this.name = "DeliveryValidationError";
    this.diagnostics = Object.freeze(normalized);
  }
}

export function assessDeliveryTraceability(input: {
  tasksMarkdown: string;
  specs: readonly { path: string; text: string }[];
  plan: ImplementPlan;
}): DeliveryTraceabilityAssessment {
  const diagnostics = new Set<string>();
  const headings = new Set<string>();
  for (const spec of input.specs) {
    if (!isValidRelativePath(spec.path) || !spec.path.endsWith("/spec.md")) {
      diagnostics.add("traceability-spec-path-invalid");
      continue;
    }
    let requirement = "";
    for (const line of spec.text.split(/\r?\n/u)) {
      const requirementMatch = /^### Requirement: (.+)$/u.exec(line);
      if (requirementMatch?.[1]) {
        requirement = requirementMatch[1].trim();
        continue;
      }
      const scenarioMatch = /^#### Scenario: (.+)$/u.exec(line);
      if (scenarioMatch?.[1] && requirement) {
        const heading = `${spec.path}#${requirement}/${scenarioMatch[1].trim()}`;
        if (headings.has(heading)) {
          diagnostics.add("traceability-heading-duplicate");
        }
        headings.add(heading);
      }
    }
  }
  const references = [
    ...input.tasksMarkdown.matchAll(/`(specs\/[^`\n]+\/spec\.md#[^`\n]+)`/gu),
  ].flatMap((match) => (match[1] ? [match[1].trim()] : []));
  if (references.length === 0) diagnostics.add("traceability-reference-empty");
  const referenceSet = new Set(references);
  if (referenceSet.size !== references.length) {
    diagnostics.add("traceability-reference-duplicate");
  }
  if (references.some((reference) => !headings.has(reference))) {
    diagnostics.add("traceability-reference-unresolved");
  }
  if ([...headings].some((heading) => !referenceSet.has(heading))) {
    diagnostics.add("traceability-scenario-unowned");
  }
  const taskIds = input.plan.tasks.map((task) => task.taskId).sort();
  if (
    taskIds.some((taskId) => !input.tasksMarkdown.includes(`\`${taskId}\``))
  ) {
    diagnostics.add("traceability-task-unmapped");
  }
  const verificationIds = input.plan.tasks
    .flatMap((task) => [
      task.phases.red.verification.id,
      task.phases.green.verification.id,
      ...(task.phases.refactor ? [task.phases.refactor.verification.id] : []),
    ])
    .sort();
  if (
    verificationIds.some(
      (verificationId) => !input.tasksMarkdown.includes(verificationId),
    )
  ) {
    diagnostics.add("traceability-verification-unmapped");
  }
  if (diagnostics.size > 0) {
    return { ok: false, diagnostics: [...diagnostics].sort() };
  }
  return {
    ok: true,
    value: {
      taskPath: "tasks.md",
      referenceCount: references.length,
      taskCount: taskIds.length,
      verificationCount: verificationIds.length,
      canonicalHash: hashCanonicalValue({
        references: [...referenceSet].sort(),
        taskIds,
        verificationIds,
      }),
    },
  };
}

export type PlanPhaseDraft = PhaseBoundary;

export interface PlanTaskDraft extends Omit<ImplementTaskBoundary, "phases"> {
  phases: {
    red: PlanPhaseDraft;
    green: PlanPhaseDraft;
    refactor?: PlanPhaseDraft;
  };
  affectedVerification: StructuredVerificationContract;
  repairVerification: StructuredVerificationContract;
}

export interface PlanVerification {
  baseline: {
    target: "task-red-contracts";
    affected: "task-affected-contracts";
    fullSuite: StructuredVerificationContract;
    failureIdentity: "normalized";
  };
  change: {
    affected: "task-affected-contracts";
    fullSuite: StructuredVerificationContract;
    postApply: StructuredVerificationContract;
  };
  artifactCorrection: {
    maxAttempts: number;
  };
  repair: {
    maxAttempts: number;
    inBoundaryOnly: true;
    approvalOnBoundaryExpansion: true;
    attribution: ["pre-existing", "introduced", "unresolved", "environment"];
  };
  agentsCheckpoint: {
    required: boolean;
    verification: StructuredVerificationContract | null;
    operations: PlanAgentsCheckpointOperation[];
  };
}

export interface PlanAgentsCheckpointOperation {
  target: string;
  impact: Exclude<AgentsImpact, "none">;
  taskIds: string[];
  managedBlock: string | null;
}

export interface PlanTracking {
  path: "tasks.md";
  format: "markdown-checkbox";
  taskIds: string[];
  completionOwner: "parent";
}

export interface PlanDraft {
  changeId: string;
  tasks: PlanTaskDraft[];
  outputs: ImplementGraphOutput[];
  verification: PlanVerification;
  tracking: PlanTracking;
}

export type ImplementPlan = PlanDraft;

export interface CompiledDelivery {
  plan: ImplementPlan;
  bytes: Uint8Array;
  rawSha256: string;
  planHash: string;
  closure: ImplementGraphReadiness["closure"];
  receipt: {
    plan: {
      path: typeof IMPLEMENT_PLAN_PATH;
      rawSha256: string;
      canonicalHash: string;
    };
    verificationClosure: ImplementGraphReadiness["closure"];
  };
  tasksMarkdown: string;
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

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`);
}

function normalizeArtifactBindings(
  value: readonly DeliveryArtifactBinding[],
): DeliveryArtifactBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("delivery-artifacts-invalid");
  }
  const paths = new Set<string>();
  const normalized = value.map((binding) => {
    if (
      !isRecord(binding) ||
      !exactKeys(binding, ["path", "rawSha256"]) ||
      typeof binding.path !== "string" ||
      !isValidRelativePath(binding.path) ||
      binding.path === READY_RECEIPT_PATH ||
      typeof binding.rawSha256 !== "string" ||
      !SHA256.test(binding.rawSha256) ||
      paths.has(binding.path)
    ) {
      throw new Error("delivery-artifacts-invalid");
    }
    paths.add(binding.path);
    return { path: binding.path, rawSha256: binding.rawSha256 };
  });
  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function requireReceiptIdentity(
  change: unknown,
  schema: unknown,
): asserts change is string {
  if (
    typeof change !== "string" ||
    !CHANGE_NAME.test(change) ||
    typeof schema !== "string" ||
    schema.length === 0 ||
    schema.length > 128
  ) {
    throw new Error("delivery-receipt-identity-invalid");
  }
}

function normalizeGateProof(value: GateApprovalProof): GateApprovalProof {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["revision", "contractHash", "recordHash"]) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.contractHash !== "string" ||
    !SHA256.test(value.contractHash) ||
    typeof value.recordHash !== "string" ||
    !SHA256.test(value.recordHash)
  ) {
    throw new Error("delivery-gate-proof-invalid");
  }
  return structuredClone(value);
}

function parseCanonicalReceipt<T>(bytes: Uint8Array, code: string): T {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(code);
  }
  if (`${canonicalJson(parsed)}\n` !== text) throw new Error(code);
  return parsed as T;
}

export function compileGateAReceipt(input: {
  change: string;
  schema: string;
  approval: GateApprovalProof;
  artifacts: readonly DeliveryArtifactBinding[];
}): { receipt: GateAReceipt; bytes: Uint8Array; rawSha256: string } {
  requireReceiptIdentity(input.change, input.schema);
  const receipt: GateAReceipt = {
    change: input.change,
    schema: input.schema,
    approval: normalizeGateProof(input.approval),
    artifacts: normalizeArtifactBindings(input.artifacts),
  };
  const bytes = canonicalBytes(receipt);
  return {
    receipt,
    bytes,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function parseGateAReceipt(bytes: Uint8Array): GateAReceipt {
  const receipt = parseCanonicalReceipt<GateAReceipt>(
    bytes,
    "gate-a-receipt-invalid",
  );
  if (
    !isRecord(receipt) ||
    !exactKeys(receipt, ["change", "schema", "approval", "artifacts"]) ||
    !isRecord(receipt.approval) ||
    !exactKeys(receipt.approval, ["revision", "contractHash", "recordHash"])
  ) {
    throw new Error("gate-a-receipt-invalid");
  }
  requireReceiptIdentity(receipt.change, receipt.schema);
  const approval = normalizeGateProof(receipt.approval);
  const artifacts = normalizeArtifactBindings(receipt.artifacts);
  if (
    canonicalJson(approval) !== canonicalJson(receipt.approval) ||
    canonicalJson(artifacts) !== canonicalJson(receipt.artifacts)
  ) {
    throw new Error("gate-a-receipt-invalid");
  }
  return structuredClone(receipt);
}

function normalizeTraceability(
  value: DeliveryTraceability,
): DeliveryTraceability {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "taskPath",
      "referenceCount",
      "taskCount",
      "verificationCount",
      "canonicalHash",
    ]) ||
    value.taskPath !== "tasks.md" ||
    !Number.isSafeInteger(value.referenceCount) ||
    value.referenceCount < 1 ||
    !Number.isSafeInteger(value.taskCount) ||
    value.taskCount < 1 ||
    !Number.isSafeInteger(value.verificationCount) ||
    value.verificationCount < 1 ||
    typeof value.canonicalHash !== "string" ||
    !SHA256.test(value.canonicalHash)
  ) {
    throw new Error("delivery-traceability-invalid");
  }
  return structuredClone(value);
}

export function compileReadyReceipt(input: {
  change: string;
  schema: string;
  deliveryRevision: number;
  gateA: { rawSha256: string };
  gateB: GateApprovalProof;
  artifacts: readonly DeliveryArtifactBinding[];
  compiledPlan: CompiledDelivery;
  traceability: DeliveryTraceability;
}): { receipt: ReadyReceipt; bytes: Uint8Array; rawSha256: string } {
  requireReceiptIdentity(input.change, input.schema);
  if (
    !Number.isSafeInteger(input.deliveryRevision) ||
    input.deliveryRevision < 1 ||
    !SHA256.test(input.gateA.rawSha256) ||
    input.compiledPlan.plan.changeId !== input.change ||
    input.gateB.contractHash !== input.compiledPlan.planHash
  ) {
    throw new Error("delivery-receipt-invalid");
  }
  const receipt: ReadyReceipt = {
    change: input.change,
    schema: input.schema,
    deliveryRevision: input.deliveryRevision,
    approvals: {
      gateA: {
        path: GATE_A_RECEIPT_PATH,
        rawSha256: input.gateA.rawSha256,
      },
      gateB: normalizeGateProof(input.gateB),
    },
    artifacts: normalizeArtifactBindings(input.artifacts),
    plan: structuredClone(input.compiledPlan.receipt.plan),
    verificationClosure: structuredClone(
      input.compiledPlan.receipt.verificationClosure,
    ),
    traceability: normalizeTraceability(input.traceability),
    openspec: { strict: true, planningComplete: true },
  };
  const bytes = canonicalBytes(receipt);
  return {
    receipt,
    bytes,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function parseReadyReceipt(bytes: Uint8Array): ReadyReceipt {
  const receipt = parseCanonicalReceipt<ReadyReceipt>(
    bytes,
    "delivery-receipt-invalid",
  );
  if (
    !isRecord(receipt) ||
    !exactKeys(receipt, [
      "change",
      "schema",
      "deliveryRevision",
      "approvals",
      "artifacts",
      "plan",
      "verificationClosure",
      "traceability",
      "openspec",
    ]) ||
    !Number.isSafeInteger(receipt.deliveryRevision) ||
    receipt.deliveryRevision < 1 ||
    !isRecord(receipt.approvals) ||
    !exactKeys(receipt.approvals, ["gateA", "gateB"]) ||
    !isRecord(receipt.approvals.gateA) ||
    !exactKeys(receipt.approvals.gateA, ["path", "rawSha256"]) ||
    receipt.approvals.gateA.path !== GATE_A_RECEIPT_PATH ||
    !SHA256.test(receipt.approvals.gateA.rawSha256) ||
    !isRecord(receipt.approvals.gateB) ||
    !exactKeys(receipt.approvals.gateB, [
      "revision",
      "contractHash",
      "recordHash",
    ]) ||
    !isRecord(receipt.plan) ||
    !exactKeys(receipt.plan, ["path", "rawSha256", "canonicalHash"]) ||
    receipt.plan.path !== IMPLEMENT_PLAN_PATH ||
    !SHA256.test(receipt.plan.rawSha256) ||
    !SHA256.test(receipt.plan.canonicalHash) ||
    !isRecord(receipt.verificationClosure) ||
    !exactKeys(receipt.verificationClosure, ["executable", "diagnostics"]) ||
    receipt.verificationClosure.executable !== true ||
    !Array.isArray(receipt.verificationClosure.diagnostics) ||
    receipt.verificationClosure.diagnostics.length !== 0 ||
    !isRecord(receipt.openspec) ||
    !exactKeys(receipt.openspec, ["strict", "planningComplete"]) ||
    receipt.openspec.strict !== true ||
    receipt.openspec.planningComplete !== true
  ) {
    throw new Error("delivery-receipt-invalid");
  }
  requireReceiptIdentity(receipt.change, receipt.schema);
  const artifacts = normalizeArtifactBindings(receipt.artifacts);
  const gateB = normalizeGateProof(receipt.approvals.gateB);
  const traceability = normalizeTraceability(receipt.traceability);
  if (
    gateB.contractHash !== receipt.plan.canonicalHash ||
    canonicalJson(gateB) !== canonicalJson(receipt.approvals.gateB) ||
    canonicalJson(artifacts) !== canonicalJson(receipt.artifacts) ||
    canonicalJson(traceability) !== canonicalJson(receipt.traceability)
  ) {
    throw new Error("delivery-receipt-invalid");
  }
  return structuredClone(receipt);
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortCanonical<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}

function normalizeVerification(
  verification: unknown,
): StructuredVerificationContract {
  const validation = validateVerificationContract(verification);
  if (!validation.ok) throw new Error("delivery-verification-invalid");
  const cloned = validation.value;
  if (cloned.kind === "vitest") {
    cloned.testFiles = sortStrings(cloned.testFiles);
  } else if (cloned.kind === "steps") {
    cloned.steps = cloned.steps.map((step) => {
      if (step.kind !== "vitest") return step;
      return { ...step, testFiles: sortStrings(step.testFiles) };
    });
  }
  return cloned;
}

function normalizePhase(value: unknown): PlanPhaseDraft {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "read",
      "write",
      "delete",
      "verification",
      "verificationInputs",
      ...(Object.hasOwn(value, "verificationLock") ? ["verificationLock"] : []),
    ]) ||
    !Array.isArray(value.read) ||
    !Array.isArray(value.write) ||
    !Array.isArray(value.delete) ||
    !Array.isArray(value.verificationInputs) ||
    !value.read.every(isValidRelativePath) ||
    !value.write.every(isValidRelativePath) ||
    !value.delete.every(isValidRelativePath)
  ) {
    throw new Error("delivery-plan-invalid-phase");
  }
  const write = sortStrings(value.write as string[]);
  const deletions = sortStrings(value.delete as string[]);
  if (write.some((candidate) => deletions.includes(candidate))) {
    throw new Error("delivery-plan-write-delete-overlap");
  }
  return {
    read: sortStrings(value.read as string[]),
    write,
    delete: deletions,
    verification: normalizeVerification(
      value.verification as StructuredVerificationContract,
    ),
    verificationInputs: sortCanonical(
      structuredClone(
        value.verificationInputs,
      ) as PhaseBoundary["verificationInputs"],
    ),
    ...(typeof value.verificationLock === "string"
      ? { verificationLock: value.verificationLock }
      : {}),
  };
}

function normalizeTask(value: unknown): PlanTaskDraft {
  if (
    !isRecord(value) ||
    !isRecord(value.phases) ||
    !isRecord(value.affectedVerification) ||
    !isRecord(value.repairVerification)
  ) {
    throw new Error("delivery-plan-invalid-task");
  }
  const phases = value.phases;
  if (!Object.hasOwn(phases, "red") || !Object.hasOwn(phases, "green")) {
    throw new Error("delivery-plan-invalid-task-phases");
  }
  const cloned = structuredClone(value) as unknown as PlanTaskDraft;
  const affectedVerification = normalizeVerification(
    value.affectedVerification,
  );
  const repairVerification = normalizeVerification(value.repairVerification);
  if (
    affectedVerification.classification !== "expected-green" ||
    repairVerification.classification !== "expected-green"
  ) {
    throw new Error("delivery-task-verification-invalid");
  }
  return {
    ...cloned,
    dependsOn: sortStrings(cloned.dependsOn),
    roots: sortStrings(cloned.roots),
    phases: {
      red: normalizePhase(phases.red),
      green: normalizePhase(phases.green),
      ...(phases.refactor !== undefined
        ? { refactor: normalizePhase(phases.refactor) }
        : {}),
    },
    scheduling: {
      conflicts: sortStrings(cloned.scheduling.conflicts),
      resources: sortStrings(cloned.scheduling.resources),
    },
    approvedDependencies: sortStrings(cloned.approvedDependencies),
    affectedVerification,
    repairVerification,
    impactClosure: {
      changedSurfaces: sortStrings(
        cloned.impactClosure.changedSurfaces,
      ) as PlanTaskDraft["impactClosure"]["changedSurfaces"],
      searchEvidence: sortStrings(cloned.impactClosure.searchEvidence),
      relatedTests: [...cloned.impactClosure.relatedTests].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.disposition.localeCompare(right.disposition),
      ),
      affectedSuite: sortStrings(cloned.impactClosure.affectedSuite),
    },
  };
}

function graphFromPlan(plan: ImplementPlan): ImplementGraphBoundary {
  const stripPhase = (phase: PlanPhaseDraft): PhaseBoundary => ({
    read: phase.read,
    write: phase.write,
    delete: phase.delete,
    verification: phase.verification,
    verificationInputs: phase.verificationInputs,
    ...(phase.verificationLock
      ? { verificationLock: phase.verificationLock }
      : {}),
  });
  return {
    changeId: plan.changeId,
    tasks: plan.tasks.map((task) => {
      const {
        affectedVerification: _affectedVerification,
        repairVerification: _repairVerification,
        ...boundary
      } = task;
      return {
        ...boundary,
        phases: {
          red: stripPhase(task.phases.red),
          green: stripPhase(task.phases.green),
          ...(task.phases.refactor
            ? { refactor: stripPhase(task.phases.refactor) }
            : {}),
        },
      };
    }),
    outputs: structuredClone(plan.outputs),
  };
}

function deliveryVerificationDiagnostics(
  plan: ImplementPlan,
  consumerRoot: string,
): Array<Record<string, unknown>> {
  const contracts: Array<{
    owner: string;
    verification: StructuredVerificationContract;
  }> = plan.tasks.flatMap((task) => [
    {
      owner: `task:${task.taskId}:affected`,
      verification: task.affectedVerification,
    },
    {
      owner: `task:${task.taskId}:repair`,
      verification: task.repairVerification,
    },
  ]);
  contracts.push(
    {
      owner: "baseline:full-suite",
      verification: plan.verification.baseline.fullSuite,
    },
    {
      owner: "change:full-suite",
      verification: plan.verification.change.fullSuite,
    },
    {
      owner: "change:post-apply",
      verification: plan.verification.change.postApply,
    },
  );
  if (plan.verification.agentsCheckpoint.verification) {
    contracts.push({
      owner: "agents-checkpoint",
      verification: plan.verification.agentsCheckpoint.verification,
    });
  }
  return contracts.flatMap(({ owner, verification }) => {
    const capability = validateVerificationAdapterCapability(
      consumerRoot,
      verification,
      { dependencyOwner: consumerRoot },
    );
    if (capability.ok) return [];
    const { message: _message, ...diagnostic } = capability.diagnostic;
    return [{ owner, ...diagnostic }];
  });
}

function normalizeExpectedGreenVerification(
  value: unknown,
): StructuredVerificationContract {
  const verification = normalizeVerification(value);
  if (verification.classification !== "expected-green") {
    throw new Error("delivery-verification-classification-invalid");
  }
  return verification;
}

function normalizeAgentsManagedBlock(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > 64 * 1024 ||
    value.includes("\0") ||
    value.includes("\r")
  ) {
    throw new Error("delivery-agents-checkpoint-invalid");
  }
  const lines = value.endsWith("\n")
    ? value.slice(0, -1).split("\n")
    : value.split("\n");
  if (
    lines[0] !== AGENTS_START ||
    lines.at(-1) !== AGENTS_END ||
    lines.filter((line) => line === AGENTS_START).length !== 1 ||
    lines.filter((line) => line === AGENTS_END).length !== 1
  ) {
    throw new Error("delivery-agents-checkpoint-invalid");
  }
  return lines.join("\n");
}

function normalizeAgentsCheckpointOperations(
  value: unknown,
): PlanAgentsCheckpointOperation[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("delivery-agents-checkpoint-invalid");
  }
  const targets = new Set<string>();
  return value
    .map((operation): PlanAgentsCheckpointOperation => {
      if (
        !isRecord(operation) ||
        !exactKeys(operation, [
          "target",
          "impact",
          "taskIds",
          "managedBlock",
        ]) ||
        !isAgentsPath(operation.target) ||
        !["update-existing", "create-index", "remove-index"].includes(
          String(operation.impact),
        ) ||
        targets.has(operation.target) ||
        !Array.isArray(operation.taskIds) ||
        operation.taskIds.length === 0 ||
        operation.taskIds.some(
          (taskId) => typeof taskId !== "string" || taskId.length === 0,
        ) ||
        new Set(operation.taskIds).size !== operation.taskIds.length
      ) {
        throw new Error("delivery-agents-checkpoint-invalid");
      }
      targets.add(operation.target);
      const impact = operation.impact as Exclude<AgentsImpact, "none">;
      if (
        (impact === "remove-index" && operation.managedBlock !== null) ||
        (impact !== "remove-index" &&
          typeof operation.managedBlock !== "string")
      ) {
        throw new Error("delivery-agents-checkpoint-invalid");
      }
      return {
        target: operation.target,
        impact,
        taskIds: sortStrings(operation.taskIds as string[]),
        managedBlock:
          impact === "remove-index"
            ? null
            : normalizeAgentsManagedBlock(operation.managedBlock),
      };
    })
    .sort((left, right) => left.target.localeCompare(right.target));
}

function normalizeVerificationPlan(value: unknown): PlanVerification {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "baseline",
      "change",
      "artifactCorrection",
      "repair",
      "agentsCheckpoint",
    ]) ||
    !isRecord(value.baseline) ||
    !exactKeys(value.baseline, [
      "target",
      "affected",
      "fullSuite",
      "failureIdentity",
    ]) ||
    value.baseline.target !== "task-red-contracts" ||
    value.baseline.affected !== "task-affected-contracts" ||
    value.baseline.failureIdentity !== "normalized" ||
    !isRecord(value.change) ||
    !exactKeys(value.change, ["affected", "fullSuite", "postApply"]) ||
    value.change.affected !== "task-affected-contracts" ||
    !isRecord(value.artifactCorrection) ||
    !exactKeys(value.artifactCorrection, ["maxAttempts"]) ||
    !Number.isSafeInteger(value.artifactCorrection.maxAttempts) ||
    (value.artifactCorrection.maxAttempts as number) < 2 ||
    (value.artifactCorrection.maxAttempts as number) > 3 ||
    !isRecord(value.repair) ||
    !exactKeys(value.repair, [
      "maxAttempts",
      "inBoundaryOnly",
      "approvalOnBoundaryExpansion",
      "attribution",
    ]) ||
    typeof value.repair.maxAttempts !== "number" ||
    !Number.isSafeInteger(value.repair.maxAttempts) ||
    value.repair.maxAttempts < 1 ||
    value.repair.maxAttempts > 3 ||
    value.repair.inBoundaryOnly !== true ||
    value.repair.approvalOnBoundaryExpansion !== true ||
    canonicalJson(value.repair.attribution) !==
      canonicalJson([
        "pre-existing",
        "introduced",
        "unresolved",
        "environment",
      ]) ||
    !isRecord(value.agentsCheckpoint) ||
    !exactKeys(value.agentsCheckpoint, [
      "required",
      "verification",
      "operations",
    ]) ||
    typeof value.agentsCheckpoint.required !== "boolean" ||
    (value.agentsCheckpoint.required &&
      !isRecord(value.agentsCheckpoint.verification)) ||
    (!value.agentsCheckpoint.required &&
      value.agentsCheckpoint.verification !== null) ||
    !Array.isArray(value.agentsCheckpoint.operations)
  ) {
    throw new Error("delivery-verification-plan-invalid");
  }
  return {
    baseline: {
      target: "task-red-contracts",
      affected: "task-affected-contracts",
      fullSuite: normalizeExpectedGreenVerification(value.baseline.fullSuite),
      failureIdentity: "normalized",
    },
    change: {
      affected: "task-affected-contracts",
      fullSuite: normalizeExpectedGreenVerification(value.change.fullSuite),
      postApply: normalizeExpectedGreenVerification(value.change.postApply),
    },
    artifactCorrection: {
      maxAttempts: value.artifactCorrection.maxAttempts as number,
    },
    repair: {
      maxAttempts: value.repair.maxAttempts as number,
      inBoundaryOnly: true,
      approvalOnBoundaryExpansion: true,
      attribution: ["pre-existing", "introduced", "unresolved", "environment"],
    },
    agentsCheckpoint: {
      required: value.agentsCheckpoint.required,
      verification: value.agentsCheckpoint.required
        ? normalizeExpectedGreenVerification(
            value.agentsCheckpoint.verification,
          )
        : null,
      operations: normalizeAgentsCheckpointOperations(
        value.agentsCheckpoint.operations,
      ),
    },
  };
}

function normalizeTracking(value: unknown): PlanTracking {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["path", "format", "taskIds", "completionOwner"]) ||
    value.path !== "tasks.md" ||
    value.format !== "markdown-checkbox" ||
    !Array.isArray(value.taskIds) ||
    !value.taskIds.every((taskId) => typeof taskId === "string") ||
    new Set(value.taskIds).size !== value.taskIds.length ||
    value.completionOwner !== "parent"
  ) {
    throw new Error("delivery-tracking-invalid");
  }
  return {
    path: "tasks.md",
    format: "markdown-checkbox",
    taskIds: sortStrings(value.taskIds as string[]),
    completionOwner: "parent",
  };
}

function normalizeDraft(value: unknown): ImplementPlan {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "changeId",
      "tasks",
      "outputs",
      "verification",
      "tracking",
    ]) ||
    typeof value.changeId !== "string" ||
    !CHANGE_NAME.test(value.changeId) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.outputs)
  ) {
    throw new Error("delivery-plan-invalid");
  }
  const plan: ImplementPlan = {
    changeId: value.changeId,
    tasks: value.tasks
      .map(normalizeTask)
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
    outputs: (structuredClone(value.outputs) as ImplementGraphOutput[]).sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    verification: normalizeVerificationPlan(value.verification),
    tracking: normalizeTracking(value.tracking),
  };
  if (
    canonicalJson(plan.tracking.taskIds) !==
    canonicalJson(plan.tasks.map((task) => task.taskId).sort())
  ) {
    throw new Error("delivery-tracking-task-mismatch");
  }
  const agentsTasks = plan.tasks.filter(
    (task) => task.agents.impact !== "none" && task.agents.target,
  );
  const agentsByTarget = new Map<string, PlanTaskDraft[]>();
  for (const task of agentsTasks) {
    const target = task.agents.target as string;
    const existing = agentsByTarget.get(target) ?? [];
    existing.push(task);
    agentsByTarget.set(target, existing);
  }
  const operations = plan.verification.agentsCheckpoint.operations;
  const operationsByTarget = new Map(
    operations.map((operation) => [operation.target, operation]),
  );
  const agentsRequired = agentsTasks.length > 0;
  if (
    plan.verification.agentsCheckpoint.required !== agentsRequired ||
    operations.length !== agentsByTarget.size ||
    [...agentsByTarget].some(([target, tasks]) => {
      const operation = operationsByTarget.get(target);
      return (
        !operation ||
        tasks.some((task) => task.agents.impact !== operation.impact) ||
        canonicalJson(operation.taskIds) !==
          canonicalJson(tasks.map((task) => task.taskId).sort())
      );
    })
  ) {
    throw new Error("delivery-agents-checkpoint-mismatch");
  }
  const graphValidation = validateImplementGraphBoundary(graphFromPlan(plan));
  if (!graphValidation.ok) {
    throw new Error(`delivery-plan-invalid:${graphValidation.reason}`);
  }
  return plan;
}

function renderTasks(plan: ImplementPlan): string {
  const lines = ["# Implementation tasks", ""];
  for (const task of plan.tasks) {
    lines.push(`- [ ] ${task.taskId} — ${task.objective}`);
    lines.push(
      `  - Depends on: ${task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "[]"}`,
    );
    lines.push(`  - Red verification: ${task.phases.red.verification.id}`);
    lines.push(`  - Green verification: ${task.phases.green.verification.id}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function compileImplementPlan(
  draft: unknown,
  options: { consumerRoot: string },
): CompiledDelivery {
  const plan = normalizeDraft(draft);
  const graph = graphFromPlan(plan);
  const readiness = assessImplementGraphReadiness(options.consumerRoot, graph, {
    completedTasks: [],
    blockedTasks: [],
    appliedPhases: [],
  });
  const diagnostics = [
    ...readiness.closure.diagnostics,
    ...deliveryVerificationDiagnostics(plan, options.consumerRoot),
  ];
  if (diagnostics.length > 0) {
    throw new Error(
      `delivery-plan-not-executable:${canonicalJson(diagnostics)}`,
    );
  }
  const canonical = canonicalJson(plan);
  const bytes = new TextEncoder().encode(`${canonical}\n`);
  const rawSha256 = createHash("sha256").update(bytes).digest("hex");
  const planHash = hashCanonicalValue(plan);
  const closure = structuredClone(readiness.closure);
  return {
    plan,
    bytes,
    rawSha256,
    planHash,
    closure,
    receipt: {
      plan: {
        path: IMPLEMENT_PLAN_PATH,
        rawSha256,
        canonicalHash: planHash,
      },
      verificationClosure: structuredClone(closure),
    },
    tasksMarkdown: renderTasks(plan),
  };
}

export function parseImplementPlan(bytes: Uint8Array): ImplementPlan {
  const text = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("delivery-plan-json-invalid");
  }
  const normalized = normalizeDraft(parsed);
  if (`${canonicalJson(normalized)}\n` !== text) {
    throw new Error("delivery-plan-not-canonical");
  }
  return normalized;
}
