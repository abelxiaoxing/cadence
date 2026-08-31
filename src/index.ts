// Private workflow orchestration extension. Registers the abel_dispatch tool
// on load, then keeps it inactive by default by removing only that name from
// the active set at session start. Eligible-stage activation is wired by the
// workflow routing (abel-design/implement/diagnose provenance) in the prompts
// integration; abel-init and ordinary prompts never activate dispatch.
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Activation, activateTool, deactivateTool } from "./activation.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import { runChildSession } from "./child-session.ts";
import {
  type AtomicVerificationContract,
  type DesignEvidenceResult,
  isValidRelativePath,
  LIMITS,
  type StructuredVerificationContract,
  verificationSteps,
} from "./contracts.ts";
import {
  CONTROL_COMMAND_PARAMETERS,
  canonicalizeControlCommandToolInput,
  validateControlCommand,
} from "./control-contracts.ts";
import {
  assessDeliveryTraceability,
  compileImplementPlan,
  DeliveryValidationError,
  DesignPlanValidationError,
  type GateApprovalProof,
  parseGateAReceipt,
  parseImplementPlan,
  parseReadyReceipt,
} from "./delivery-compiler.ts";
import {
  DesignController,
  DesignFinalizationError,
  validateDesignControlRequest,
} from "./design-control.ts";
import { canonicalJson, hashCanonicalValue } from "./implement-graph.ts";
import { BubblewrapIsolationBackend } from "./isolation-backend.ts";
import { PACKET_ACTIONS, PacketRuntime } from "./packet-runtime.ts";
import { ParentPayloadBridge } from "./parent-payload-bridge.ts";
import { runtimeForWorkerRoute } from "./parent-provider.ts";
import {
  inspectRoutePolicy,
  loadRoutePolicy,
  type RoutePolicyResolution,
  unavailableRoutePolicy,
  type WorkerRoutePolicy,
} from "./route-policy.ts";
import { RunStoreFormatError } from "./run-store.ts";
import { observeSafePath } from "./safe-path.ts";
import { resolveStateRoot } from "./state-root.ts";
import {
  ACTIVITY_DETAILS_KEY,
  ActivityController,
  renderActivityCall,
  renderActivityResult,
  type WorkflowActivityUpdate,
} from "./subagent-activity.ts";
import { classifyCandidateContextRequest } from "./submit-tool.ts";
import {
  bindCurrentVerificationCapability,
  isVerificationCapabilityCurrent,
  type VerificationRunnerBinding,
} from "./verification-capability.ts";
import {
  openDurableWorkflowEngine,
  type WorkflowAvailableDelivery,
  type WorkflowDeliverySource,
} from "./workflow-engine.ts";

export const DISPATCH_TOOL = "abel_dispatch";
const DESIGN_PARENT_READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ELIGIBLE_PROMPTS = [
  "abel-design",
  "abel-implement",
  "abel-diagnose",
] as const;
type EligiblePrompt = (typeof ELIGIBLE_PROMPTS)[number];

const GENERIC_REQUEST_SCHEMA = {
  type: "object",
  description:
    "Stage-specific request envelope for action=run. The verified Abel prompt refreshes this schema before the stage's first model turn.",
} as const;

const DESIGN_REQUEST_SCHEMA = {
  type: "object",
  description:
    "One bounded read-only design-explorer packet. Send one sibling abel_dispatch tool call per packet; do not wrap multiple packets in requests.",
  properties: {
    stage: {
      type: "string",
      enum: ["abel-design"],
      description: "Exact verified workflow stage.",
    },
    role: {
      type: "string",
      enum: ["design-explorer"],
      description: "Exact package-owned read-only Agent role.",
    },
    runId: {
      type: "string",
      description: "Durable Design run identity returned by Design start.",
    },
    id: {
      type: "string",
      description:
        "Unique packet and request identity, at most 128 characters.",
    },
    phase: {
      type: "string",
      enum: ["evidence"],
      description: "Design exploration phase.",
    },
    objective: {
      type: "string",
      description: "Bounded evidence objective for this packet only.",
    },
    roots: {
      type: "array",
      items: { type: "string" },
      description: 'Approved relative workspace roots, normally ["."].',
    },
    context: {
      type: "object",
      properties: {
        agents: {
          type: "string",
          description: "Applicable AGENTS.md instructions for this packet.",
        },
        contract: {
          type: "string",
          description:
            "Packet scope, retrieval, read-only, and structured-output contract.",
        },
      },
      required: ["agents", "contract"],
      additionalProperties: false,
    },
    declared: {
      type: "object",
      properties: {
        read: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact relative files or directories this packet may read.",
        },
        write: {
          type: "array",
          items: { type: "string" },
          description: "Must be empty for design-explorer.",
        },
        conflicts: {
          type: "array",
          items: { type: "string" },
          description:
            "Declared conflict edges; normally empty for read-only packets.",
        },
        resources: {
          type: "array",
          items: { type: "string" },
          description: "Declared exclusive resources; normally empty.",
        },
      },
      required: ["read", "write", "conflicts", "resources"],
      additionalProperties: false,
    },
    output: {
      type: "string",
      enum: ["evidence"],
      description: "Exact structured child-result kind.",
    },
  },
  required: [
    "stage",
    "role",
    "runId",
    "id",
    "phase",
    "objective",
    "roots",
    "context",
    "declared",
    "output",
  ],
  additionalProperties: false,
} as const;

const DESIGN_CONTROL_REQUEST_SCHEMA = {
  description:
    "One closed durable Design control operation. The operation body is strict and idempotent by operationId.",
  oneOf: [
    ...(["requirement", "change"] as const).map((field) => ({
      type: "object" as const,
      properties: {
        operation: { type: "string" as const, enum: ["start"] },
        operationId: { type: "string" as const },
        [field]: {
          type: "string" as const,
          description:
            field === "requirement"
              ? "Raw Design requirement; code derives and stores only its stable hash."
              : "Existing canonical change name to resume or revise.",
        },
      },
      required: ["operation", "operationId", field],
      additionalProperties: false,
    })),
    ...(["status", "validate-plan-draft"] as const).map((operation) => ({
      type: "object" as const,
      properties: {
        operation: { type: "string" as const, enum: [operation] },
        runId: { type: "string" as const },
      },
      required: ["operation", "runId"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["bind-change"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        change: { type: "string" },
      },
      required: ["operation", "runId", "operationId", "change"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["record-decision"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        decisionId: { type: "string" },
        category: { type: "string", enum: ["behavior", "technical"] },
        contract: {
          type: "string",
          description:
            "Normalized decision contract; code hashes it and never persists the text.",
        },
        refs: { type: "array", items: { type: "string" } },
      },
      required: [
        "operation",
        "runId",
        "operationId",
        "decisionId",
        "category",
        "contract",
        "refs",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["approve-gate"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        gate: { type: "string", enum: ["gate-a"] },
        contract: {
          type: "string",
          description:
            "Complete approved WHAT contract; code hashes it and never persists the text.",
        },
      },
      required: ["operation", "runId", "operationId", "gate", "contract"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["approve-gate"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        gate: { type: "string", enum: ["gate-b"] },
      },
      required: ["operation", "runId", "operationId", "gate"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["write-artifact"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        path: {
          type: "string",
          description: "Allowed path relative to this Design change root.",
        },
        content: {
          type: "string",
          maxLength: 16 * 1024 * 1024,
          description: "Exact bounded UTF-8 artifact content.",
        },
      },
      required: ["operation", "runId", "operationId", "path", "content"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["delete-artifact"] },
        runId: { type: "string" },
        operationId: { type: "string" },
        path: {
          type: "string",
          description: "Allowed path relative to this Design change root.",
        },
      },
      required: ["operation", "runId", "operationId", "path"],
      additionalProperties: false,
    },
    ...(["compile-plan", "finalize-delivery"] as const).map((operation) => ({
      type: "object" as const,
      properties: {
        operation: { type: "string" as const, enum: [operation] },
        runId: { type: "string" as const },
        operationId: { type: "string" as const },
      },
      required: ["operation", "runId", "operationId"],
      additionalProperties: false,
    })),
  ],
} as const;

function invokedPrompt(text: string): EligiblePrompt | undefined {
  const name = text.match(/^\/([^\s]+)(?:\s|$)/)?.[1];
  return ELIGIBLE_PROMPTS.find((candidate) => candidate === name);
}

function promptMarker(name: EligiblePrompt): string {
  return `<!-- ABEL:PROMPT:${name} -->`;
}

function hasPackageProvenance(pi: ExtensionAPI, name: EligiblePrompt): boolean {
  const commands = pi
    .getCommands()
    .filter((candidate) => candidate.name === name);
  return (
    commands.length === 1 &&
    commands[0]?.source === "prompt" &&
    commands[0].sourceInfo.origin === "package" &&
    commands[0].sourceInfo.baseDir === PACKAGE_ROOT &&
    commands[0].sourceInfo.path === join(PACKAGE_ROOT, "prompts", `${name}.md`)
  );
}

function hasExpandedPromptMarker(
  prompt: string,
  name: EligiblePrompt,
): boolean {
  const requestEnd = prompt.lastIndexOf("</abel-request>");
  if (requestEnd < 0) return false;
  const body = prompt.slice(requestEnd + "</abel-request>".length);
  const marker = promptMarker(name);
  return (
    body.includes(marker) && body.indexOf(marker) === body.lastIndexOf(marker)
  );
}

function isVerifiedStageInvocation(
  pi: ExtensionAPI,
  activation: Activation,
  name: EligiblePrompt,
  prompt: string,
): boolean {
  return (
    hasPackageProvenance(pi, name) &&
    hasExpandedPromptMarker(prompt, name) &&
    (activation.isActive() || activation.state === "inactive")
  );
}

function activateDispatcher(
  pi: ExtensionAPI,
  activation: Activation,
  name: EligiblePrompt,
  prompt: string,
): void {
  if (!isVerifiedStageInvocation(pi, activation, name, prompt)) return;
  if (!activation.isActive()) {
    activation.request();
    activation.activate();
  }
  const active = pi.getActiveTools();
  if (!active.includes(DISPATCH_TOOL)) {
    pi.setActiveTools(activateTool(active, DISPATCH_TOOL));
  }
}

function splitUsage(result: unknown): { payload: unknown; usage?: unknown } {
  if (typeof result !== "object" || result === null || !("usage" in result)) {
    return { payload: result };
  }
  const { usage, ...payload } = result as Record<string, unknown>;
  return { payload, usage };
}

const SAFE_DESIGN_ERROR_CODE = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/iu;
const MAX_DESIGN_ERROR_DIAGNOSTICS = 64;

type SafeDesignFailure = {
  kind: "design-control-failure";
  operation: string;
  code: string;
  diagnostics: ReadonlyArray<Record<string, string>>;
};

function safeDesignFailure(
  error: unknown,
  operation: string,
): SafeDesignFailure {
  const message = error instanceof Error ? error.message : "";
  const code =
    error instanceof DesignPlanValidationError
      ? "design-plan-validation-invalid"
      : SAFE_DESIGN_ERROR_CODE.test(message)
        ? message
        : "design-control-failed";
  const rawDiagnostics: readonly unknown[] =
    error instanceof DesignFinalizationError ||
    error instanceof DesignPlanValidationError ||
    error instanceof DeliveryValidationError
      ? error.diagnostics
      : [];
  const diagnostics = rawDiagnostics
    .flatMap((candidate) => {
      if (typeof candidate === "string") {
        const diagnosticCode = candidate.split(":", 1)[0] ?? "";
        return SAFE_DESIGN_ERROR_CODE.test(diagnosticCode)
          ? [{ code: diagnosticCode }]
          : [];
      }
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        Array.isArray(candidate)
      ) {
        return [];
      }
      const admitted = Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .filter(
            (entry): entry is [string, string] =>
              [
                "code",
                "taskId",
                "phase",
                "field",
                "category",
                "owner",
                "verificationId",
                "outputId",
                "dependencyTaskId",
                "producerTaskId",
                "producerPhase",
              ].includes(entry[0]) &&
              typeof entry[1] === "string" &&
              SAFE_DESIGN_ERROR_CODE.test(entry[1]),
          )
          .sort(([left], [right]) => left.localeCompare(right)),
      );
      return typeof admitted.code === "string" ? [admitted] : [];
    })
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    )
    .filter(
      (candidate, index, values) =>
        index === 0 ||
        canonicalJson(candidate) !== canonicalJson(values[index - 1]),
    )
    .slice(0, MAX_DESIGN_ERROR_DIAGNOSTICS);
  return {
    kind: "design-control-failure",
    operation: SAFE_DESIGN_ERROR_CODE.test(operation) ? operation : "unknown",
    code,
    diagnostics,
  };
}

export interface WorkflowControlEngine {
  execute(
    command: unknown,
    context?: ExtensionContext,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>>;
  executeDesign?(request: unknown): Promise<Record<string, unknown>>;
  assertDesignRun?(runId: string): void;
  recordDesignEvidence?(input: {
    runId: string;
    evidence: DesignEvidenceResult;
  }): unknown;
  close(): void | Promise<void>;
}

export type WorkflowControlEngineFactory = (
  ctx: ExtensionContext,
  parentPayloadBridge: ParentPayloadBridge,
) => WorkflowControlEngine | Promise<WorkflowControlEngine>;

const PACKAGE_DELIVERY_MAX_BYTES = 16 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export interface OpenSpecDeliveryInspection {
  change: string;
  schema: string;
  planningComplete: boolean;
  strictValid: boolean;
  artifactPaths: string[];
}

export interface PackageDeliverySourceOptions {
  inspectOpenSpec?: (
    consumerRoot: string,
    change: string,
  ) => Promise<OpenSpecDeliveryInspection>;
  verifyGateProof?: (input: {
    change: string;
    gate: "gate-a" | "gate-b";
    proof: GateApprovalProof;
  }) => boolean;
  verifyFinalizedDelivery?: (input: {
    change: string;
    deliveryRevision: number;
    receiptHash: string;
    gateA: GateApprovalProof;
    gateB: GateApprovalProof;
    planCanonicalHash: string;
  }) => boolean;
}

export interface PackageWorkflowDeliverySource extends WorkflowDeliverySource {
  discoverLatest(input: {
    stage: "abel-implement";
    change: string;
  }): Promise<WorkflowAvailableDelivery | undefined>;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function proofVerified(verify: () => boolean): boolean {
  try {
    return verify() === true;
  } catch {
    return false;
  }
}

function normalizedTrackingArtifact(
  bytes: Uint8Array,
  taskIds: readonly string[],
): Buffer | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const identities = taskIds.map((taskId) => ({
    taskId,
    pattern: new RegExp(
      `(?:^|[^A-Za-z0-9._:-])${taskId.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      )}(?![A-Za-z0-9._:-])`,
      "u",
    ),
    matches: 0,
  }));
  const normalized = text
    .split(/(?<=\n)/u)
    .map((segment) => {
      const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
      if (!/^\s*-\s+\[[ xX]\]/u.test(line)) return segment;
      const matching = identities.filter(({ pattern }) => pattern.test(line));
      if (matching.length !== 1) return segment;
      matching[0].matches += 1;
      return segment.replace(/^(\s*-\s+)\[[xX]\]/u, "$1[ ]");
    })
    .join("");
  if (identities.some(({ matches }) => matches !== 1)) return undefined;
  return Buffer.from(normalized, "utf8");
}

function readPackageDeliveryFile(
  root: string,
  relative: string,
  maximumBytes = PACKAGE_DELIVERY_MAX_BYTES,
): Buffer {
  const observation = observeSafePath(root, relative);
  if (observation.kind !== "file") {
    throw new Error("delivery-file-unavailable");
  }
  const target = path.join(root, ...relative.split("/"));
  const stat = lstatSync(target);
  if (stat.size < 1 || stat.size > maximumBytes) {
    throw new Error("delivery-file-size-invalid");
  }
  return readFileSync(target);
}

function deliveryRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseCommandJson(
  value: string,
  code: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(code);
  }
  const record = deliveryRecord(parsed);
  if (!record) throw new Error(code);
  return record;
}

export async function inspectOpenSpecDelivery(
  consumerRoot: string,
  change: string,
): Promise<OpenSpecDeliveryInspection> {
  const [statusExecution, validationExecution] = await Promise.all([
    execFileAsync("openspec", ["status", "--change", change, "--json"], {
      cwd: consumerRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    }),
    execFileAsync(
      "openspec",
      ["validate", change, "--strict", "--json", "--no-interactive"],
      {
        cwd: consumerRoot,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    ),
  ]);
  const status = parseCommandJson(
    statusExecution.stdout,
    "delivery-openspec-status-invalid",
  );
  const validation = parseCommandJson(
    validationExecution.stdout,
    "delivery-openspec-validation-invalid",
  );
  const changeRoot = path.resolve(consumerRoot, "openspec", "changes", change);
  const artifactPathsRecord = deliveryRecord(status.artifactPaths);
  const artifactPaths = artifactPathsRecord
    ? Object.values(artifactPathsRecord).flatMap((entry) => {
        const record = deliveryRecord(entry);
        if (!record || !Array.isArray(record.existingOutputPaths)) return [];
        return record.existingOutputPaths.flatMap((candidate) => {
          if (typeof candidate !== "string") return [];
          const resolved = path.resolve(candidate);
          const relative = path.relative(changeRoot, resolved);
          return relative &&
            !relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative)
            ? [relative.split(path.sep).join("/")]
            : [];
        });
      })
    : [];
  const items = Array.isArray(validation.items) ? validation.items : [];
  const strictValid =
    items.length === 1 &&
    deliveryRecord(items[0])?.id === change &&
    deliveryRecord(items[0])?.valid === true;
  if (
    status.changeName !== change ||
    typeof status.schemaName !== "string" ||
    artifactPaths.length === 0
  ) {
    throw new Error("delivery-openspec-status-invalid");
  }
  return {
    change,
    schema: status.schemaName,
    planningComplete:
      status.isPlanningComplete === true && status.isComplete === true,
    strictValid,
    artifactPaths: [...new Set(artifactPaths)].sort(),
  };
}

export function packageDeliverySource(
  consumerRoot: string,
  options: PackageDeliverySourceOptions = {},
): PackageWorkflowDeliverySource {
  const inspect = options.inspectOpenSpec ?? inspectOpenSpecDelivery;
  const verifyGateProof = options.verifyGateProof;
  const verifyFinalizedDelivery = options.verifyFinalizedDelivery;
  return {
    async discoverLatest(input) {
      if (
        input.stage !== "abel-implement" ||
        !verifyGateProof ||
        !verifyFinalizedDelivery
      ) {
        return undefined;
      }
      try {
        const changeRoot = `openspec/changes/${input.change}`;
        const receiptBytes = readPackageDeliveryFile(
          consumerRoot,
          `${changeRoot}/ready.yaml`,
          4 * 1024 * 1024,
        );
        const receipt = parseReadyReceipt(receiptBytes);
        if (receipt.change !== input.change) return undefined;
        const gateABytes = readPackageDeliveryFile(
          consumerRoot,
          `${changeRoot}/${receipt.approvals.gateA.path}`,
          4 * 1024 * 1024,
        );
        if (sha256(gateABytes) !== receipt.approvals.gateA.rawSha256) {
          return undefined;
        }
        const gateA = parseGateAReceipt(gateABytes);
        if (
          gateA.change !== receipt.change ||
          gateA.schema !== receipt.schema ||
          !proofVerified(() =>
            verifyGateProof({
              change: input.change,
              gate: "gate-a",
              proof: gateA.approval,
            }),
          ) ||
          !proofVerified(() =>
            verifyGateProof({
              change: input.change,
              gate: "gate-b",
              proof: receipt.approvals.gateB,
            }),
          )
        ) {
          return undefined;
        }
        const receiptHash = sha256(receiptBytes);
        if (
          !proofVerified(() =>
            verifyFinalizedDelivery({
              change: input.change,
              deliveryRevision: receipt.deliveryRevision,
              receiptHash,
              gateA: gateA.approval,
              gateB: receipt.approvals.gateB,
              planCanonicalHash: receipt.plan.canonicalHash,
            }),
          )
        ) {
          return undefined;
        }
        return {
          deliveryRevision: receipt.deliveryRevision,
          receiptHash,
        };
      } catch {
        return undefined;
      }
    },
    async load(input) {
      if (input.stage !== "abel-implement") {
        throw new DeliveryValidationError(["delivery-stage-invalid"]);
      }
      const changeRoot = `openspec/changes/${input.change}`;
      const receiptRelative = `${changeRoot}/ready.yaml`;
      const planRelative = `${changeRoot}/implement-plan.json`;
      let receiptBytes: Buffer;
      try {
        receiptBytes = readPackageDeliveryFile(
          consumerRoot,
          receiptRelative,
          4 * 1024 * 1024,
        );
      } catch {
        throw new DeliveryValidationError(["delivery-receipt-unavailable"]);
      }
      let receipt: ReturnType<typeof parseReadyReceipt>;
      try {
        receipt = parseReadyReceipt(receiptBytes);
      } catch {
        throw new DeliveryValidationError([
          "delivery-receipt-invalid",
          "delivery-recompile-required",
        ]);
      }
      const diagnostics = new Set<string>();
      if (receipt.change !== input.change) {
        diagnostics.add("delivery-change-mismatch");
      }
      const receiptHash = sha256(receiptBytes);
      if (
        (input.deliveryRevision !== undefined &&
          input.deliveryRevision !== receipt.deliveryRevision) ||
        (input.receiptHash !== undefined && input.receiptHash !== receiptHash)
      ) {
        diagnostics.add("delivery-revision-mismatch");
      }

      let inspection: OpenSpecDeliveryInspection | undefined;
      try {
        inspection = await inspect(consumerRoot, input.change);
      } catch {
        diagnostics.add("delivery-openspec-unavailable");
      }
      if (inspection) {
        if (!inspection.strictValid) {
          diagnostics.add("delivery-openspec-strict-invalid");
        }
        if (!inspection.planningComplete) {
          diagnostics.add("delivery-openspec-incomplete");
        }
        if (inspection.schema !== receipt.schema) {
          diagnostics.add("delivery-schema-mismatch");
        }
      }

      let gateABytes: Buffer | undefined;
      let gateA: ReturnType<typeof parseGateAReceipt> | undefined;
      try {
        gateABytes = readPackageDeliveryFile(
          consumerRoot,
          `${changeRoot}/${receipt.approvals.gateA.path}`,
          4 * 1024 * 1024,
        );
        if (sha256(gateABytes) !== receipt.approvals.gateA.rawSha256) {
          diagnostics.add("delivery-gate-a-hash-mismatch");
        }
        gateA = parseGateAReceipt(gateABytes);
        if (
          gateA.change !== receipt.change ||
          gateA.schema !== receipt.schema
        ) {
          diagnostics.add("delivery-gate-a-binding-mismatch");
        }
      } catch {
        diagnostics.add("delivery-gate-a-invalid");
      }

      const artifactBytes = new Map<string, Buffer>();
      const artifactHashes = new Map(
        receipt.artifacts.map((artifact) => [
          artifact.path,
          artifact.rawSha256,
        ]),
      );
      for (const artifact of receipt.artifacts) {
        try {
          const bytes = readPackageDeliveryFile(
            consumerRoot,
            `${changeRoot}/${artifact.path}`,
          );
          artifactBytes.set(artifact.path, bytes);
          if (
            artifact.path !== receipt.traceability.taskPath &&
            sha256(bytes) !== artifact.rawSha256
          ) {
            diagnostics.add(`delivery-artifact-hash-mismatch:${artifact.path}`);
          }
        } catch {
          diagnostics.add(`delivery-artifact-unavailable:${artifact.path}`);
        }
      }
      if (inspection) {
        const covered = new Set(receipt.artifacts.map((entry) => entry.path));
        const expected = new Set(inspection.artifactPaths);
        for (const relative of expected) {
          if (!isValidRelativePath(relative) || !covered.has(relative)) {
            diagnostics.add(`delivery-artifact-unbound:${relative}`);
          }
        }
        for (const relative of covered) {
          if (!expected.has(relative)) {
            diagnostics.add(`delivery-artifact-not-in-openspec:${relative}`);
          }
        }
      }
      if (gateA) {
        if (!verifyGateProof) {
          diagnostics.add("delivery-gate-proof-verifier-unavailable");
        } else if (
          !proofVerified(() =>
            verifyGateProof({
              change: input.change,
              gate: "gate-a",
              proof: gateA.approval,
            }),
          )
        ) {
          diagnostics.add("delivery-gate-a-proof-invalid");
        }
        for (const artifact of gateA.artifacts) {
          if (artifactHashes.get(artifact.path) !== artifact.rawSha256) {
            diagnostics.add(
              `delivery-gate-a-artifact-mismatch:${artifact.path}`,
            );
          }
        }
      }
      if (
        verifyGateProof &&
        !proofVerified(() =>
          verifyGateProof({
            change: input.change,
            gate: "gate-b",
            proof: receipt.approvals.gateB,
          }),
        )
      ) {
        diagnostics.add("delivery-gate-b-proof-invalid");
      }
      if (gateA) {
        if (!verifyFinalizedDelivery) {
          diagnostics.add("delivery-finalization-verifier-unavailable");
        } else if (
          !proofVerified(() =>
            verifyFinalizedDelivery({
              change: input.change,
              deliveryRevision: receipt.deliveryRevision,
              receiptHash,
              gateA: gateA.approval,
              gateB: receipt.approvals.gateB,
              planCanonicalHash: receipt.plan.canonicalHash,
            }),
          )
        ) {
          diagnostics.add("delivery-finalization-proof-invalid");
        }
      }

      let plan: ReturnType<typeof parseImplementPlan> | undefined;
      let planBytes: Buffer | undefined;
      try {
        planBytes = readPackageDeliveryFile(consumerRoot, planRelative);
        plan = parseImplementPlan(planBytes);
      } catch {
        diagnostics.add("delivery-plan-invalid");
      }
      if (plan && planBytes) {
        if (plan.changeId !== input.change) {
          diagnostics.add("delivery-plan-change-mismatch");
        }
        let compiled: ReturnType<typeof compileImplementPlan> | undefined;
        try {
          compiled = compileImplementPlan(plan, { consumerRoot });
        } catch {
          diagnostics.add("delivery-verification-closure-invalid");
        }
        if (
          receipt.plan.path !== "implement-plan.json" ||
          receipt.plan.rawSha256 !== sha256(planBytes) ||
          receipt.plan.canonicalHash !== hashCanonicalValue(plan)
        ) {
          diagnostics.add("delivery-plan-binding-invalid");
        }
        if (
          compiled &&
          canonicalJson(compiled.closure) !==
            canonicalJson(receipt.verificationClosure)
        ) {
          diagnostics.add("delivery-verification-closure-mismatch");
        }
      }

      if (plan) {
        const tasksBytes = artifactBytes.get(receipt.traceability.taskPath);
        const expectedTasksHash = artifactHashes.get(
          receipt.traceability.taskPath,
        );
        if (
          tasksBytes &&
          expectedTasksHash &&
          sha256(tasksBytes) !== expectedTasksHash
        ) {
          const normalized = normalizedTrackingArtifact(
            tasksBytes,
            plan.tracking.taskIds,
          );
          if (!normalized || sha256(normalized) !== expectedTasksHash) {
            diagnostics.add(
              `delivery-artifact-hash-mismatch:${receipt.traceability.taskPath}`,
            );
          }
        }
        const specs = [...artifactBytes]
          .filter(
            ([relative]) =>
              relative.startsWith("specs/") && relative.endsWith("/spec.md"),
          )
          .flatMap(([relative, bytes]) => {
            try {
              return [
                {
                  path: relative,
                  text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                },
              ];
            } catch {
              diagnostics.add(`delivery-artifact-encoding-invalid:${relative}`);
              return [];
            }
          });
        if (!tasksBytes || specs.length === 0) {
          diagnostics.add("delivery-traceability-input-unavailable");
        } else {
          try {
            const traceability = assessDeliveryTraceability({
              tasksMarkdown: new TextDecoder("utf-8", { fatal: true }).decode(
                tasksBytes,
              ),
              specs,
              plan,
            });
            if (!traceability.ok) {
              for (const diagnostic of traceability.diagnostics) {
                diagnostics.add(diagnostic);
              }
            } else if (
              canonicalJson(traceability.value) !==
              canonicalJson(receipt.traceability)
            ) {
              diagnostics.add("delivery-traceability-binding-mismatch");
            }
          } catch {
            diagnostics.add("delivery-traceability-invalid");
          }
        }
      }
      if (!plan || !gateA || diagnostics.size > 0) {
        throw new DeliveryValidationError([...diagnostics]);
      }
      return {
        gate: "gate-b",
        revision: receipt.deliveryRevision,
        receiptHash,
        plan,
        approvalProofs: {
          gateA: structuredClone(gateA.approval),
          gateB: structuredClone(receipt.approvals.gateB),
        },
      };
    },
  };
}

function packageScriptInvocation(
  packageManager: string,
  script: string,
  args: string[],
): string[] {
  return packageManager === "npm" || packageManager === "pnpm"
    ? ["run", script, "--", ...args]
    : ["run", script, ...args];
}

function bindingFor(
  bindings: readonly VerificationRunnerBinding[],
  command: string,
): VerificationRunnerBinding | undefined {
  return bindings.find((binding) => binding.command === command);
}

function prepareRunnerBindings(
  root: string,
  bindings: readonly VerificationRunnerBinding[],
): {
  bindings: VerificationRunnerBinding[];
  mounts: Array<{ source: string; target: string }>;
  cleanupRoot?: string;
} {
  if (!bindings.some((binding) => binding.mountSource)) {
    return {
      bindings: bindings.map((binding) => ({
        ...binding,
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      })),
      mounts: [],
    };
  }
  const cleanupRoot = mkdtempSync(path.join(root, ".cadence-runners-"));
  try {
    const mounted = new Map<
      string,
      { source: string; target: string; sandboxTarget: string }
    >();
    const prepared = bindings.map((binding) => {
      if (!binding.mountSource) return { ...binding };
      const source = path.resolve(binding.mountSource);
      const sourceStat = lstatSync(source);
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
        throw new Error("runner-mount-unavailable");
      }
      let mount = mounted.get(source);
      if (!mount) {
        const target = path.join(cleanupRoot, String(mounted.size));
        mkdirSync(target, { mode: 0o700 });
        const sandboxRelative = path
          .relative(root, target)
          .split(path.sep)
          .join("/");
        mount = {
          source,
          target,
          sandboxTarget: `/workspace/${sandboxRelative}`,
        };
        mounted.set(source, mount);
      }
      const executable = realpathSync(binding.executablePath);
      const relative = path.relative(source, executable);
      if (
        relative === "" ||
        relative.startsWith("..") ||
        path.isAbsolute(relative)
      ) {
        throw new Error("runner-mount-unavailable");
      }
      return {
        command: binding.command,
        executablePath: path.posix.join(
          mount.sandboxTarget,
          ...relative.split(path.sep),
        ),
        ...(binding.fixedArgs ? { fixedArgs: [...binding.fixedArgs] } : {}),
      };
    });
    return {
      bindings: prepared,
      mounts: [...mounted.values()].map(({ source, sandboxTarget }) => ({
        source,
        target: sandboxTarget,
      })),
      cleanupRoot,
    };
  } catch (error) {
    rmSync(cleanupRoot, { recursive: true, force: true });
    throw error;
  }
}

function verificationInvocation(
  step: AtomicVerificationContract,
  bindings: readonly VerificationRunnerBinding[],
): { executable: string; args: string[] } | undefined {
  const reporter = step.kind === "vitest" ? ["--reporter=json"] : [];
  if (step.kind === "package-script") {
    const binding = bindingFor(bindings, step.packageManager);
    return binding
      ? {
          executable: binding.executablePath,
          args: [
            ...(binding.fixedArgs ?? []),
            ...packageScriptInvocation(
              step.packageManager,
              step.script,
              step.args,
            ),
          ],
        }
      : undefined;
  }
  const runner = step.runner;
  if (runner.kind === "package-script") {
    const binding = bindingFor(bindings, runner.packageManager);
    const args =
      step.kind === "vitest"
        ? [...step.testFiles, ...step.args, ...reporter]
        : step.args;
    return binding
      ? {
          executable: binding.executablePath,
          args: [
            ...(binding.fixedArgs ?? []),
            ...packageScriptInvocation(
              runner.packageManager,
              runner.script,
              args,
            ),
          ],
        }
      : undefined;
  }
  if (runner.kind === "local-binary") {
    const binding = bindingFor(bindings, runner.executable);
    return {
      executable:
        binding?.executablePath ??
        `/workspace/node_modules/.bin/${runner.executable}`,
      args: [
        ...(binding?.fixedArgs ?? []),
        ...(step.kind === "vitest"
          ? [...step.testFiles, ...step.args, ...reporter]
          : step.args),
      ],
    };
  }
  const command = runner.kind === "node" ? "node" : "npx";
  const binding = bindingFor(bindings, command);
  if (!binding) return undefined;
  return {
    executable: binding.executablePath,
    args:
      runner.kind === "node"
        ? [...(binding.fixedArgs ?? []), runner.script, ...step.args]
        : [
            ...(binding.fixedArgs ?? []),
            "--no-install",
            runner.executable,
            ...(step.kind === "vitest" ? step.testFiles : []),
            ...step.args,
            ...reporter,
          ],
  };
}

function vitestReport(stdout: string):
  | {
      total: number;
      failed: number;
      success: boolean;
      failures: string[];
      failedText: string[];
    }
  | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const report = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(report.numTotalTests) ||
    !Number.isSafeInteger(report.numFailedTests) ||
    typeof report.success !== "boolean"
  ) {
    return undefined;
  }
  const failedAssertions = (
    Array.isArray(report.testResults) ? report.testResults : []
  ).flatMap((suite): Array<{ identity: string; text: string[] }> => {
    if (!suite || typeof suite !== "object" || Array.isArray(suite)) return [];
    const record = suite as Record<string, unknown>;
    const suiteName =
      typeof record.name === "string"
        ? record.name.replace(/^\/workspace\//u, "")
        : "unknown-suite";
    if (!Array.isArray(record.assertionResults)) return [];
    return record.assertionResults.flatMap(
      (assertion): Array<{ identity: string; text: string[] }> => {
        if (
          !assertion ||
          typeof assertion !== "object" ||
          Array.isArray(assertion)
        ) {
          return [];
        }
        const entry = assertion as Record<string, unknown>;
        if (entry.status !== "failed") return [];
        const title =
          typeof entry.fullName === "string"
            ? entry.fullName
            : typeof entry.title === "string"
              ? entry.title
              : "unknown-assertion";
        const diagnostics = Array.isArray(entry.failureMessages)
          ? entry.failureMessages.filter(
              (message): message is string => typeof message === "string",
            )
          : [];
        return [
          {
            identity: `${suiteName}\0${title}`,
            text: [title, ...diagnostics],
          },
        ];
      },
    );
  });
  return {
    total: report.numTotalTests as number,
    failed: report.numFailedTests as number,
    success: report.success,
    failures: failedAssertions.map((failure) => failure.identity),
    failedText: failedAssertions.flatMap((failure) => failure.text),
  };
}

function normalizedFailureIdentities(input: {
  step: AtomicVerificationContract;
  report?: ReturnType<typeof vitestReport>;
  output: string;
  exitCode: number;
}): string[] {
  const vitestFailures = input.report?.failures ?? [];
  if (vitestFailures.length > 0) {
    return [...new Set(vitestFailures)]
      .sort()
      .map((failure) => sha256(`vitest-failure\0${failure}`));
  }
  const normalizedOutput = input.output
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gu, "<duration>")
    .slice(0, 64 * 1024);
  return [
    sha256(
      canonicalJson({
        verificationId: input.step.id,
        exitCode: input.exitCode,
        output: normalizedOutput,
      }),
    ),
  ];
}

export async function executePackageVerification(input: {
  root: string;
  dependencyOwner: string;
  verification: StructuredVerificationContract;
  signal: AbortSignal;
}) {
  const capability = bindCurrentVerificationCapability(
    input.root,
    input.verification,
    { dependencyOwner: input.dependencyOwner },
  );
  if (!capability.ok) {
    return {
      ok: false as const,
      kind: "paused" as const,
      code: capability.diagnostic.code,
    };
  }
  let runners: ReturnType<typeof prepareRunnerBindings>;
  try {
    runners = prepareRunnerBindings(
      input.root,
      capability.value.runnerBindings,
    );
  } catch {
    return {
      ok: false as const,
      kind: "paused" as const,
      code: "runner-mount-unavailable",
    };
  }
  try {
    const nodeModules = path.join(input.dependencyOwner, "node_modules");
    const dependency = lstatSync(nodeModules, { throwIfNoEntry: false });
    const mounts = [] as Array<{
      source: string;
      target: string;
      writable?: boolean;
    }>;
    if (dependency) {
      if (!dependency.isDirectory() || dependency.isSymbolicLink()) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "dependency-path-unsafe",
        };
      }
      const target = path.join(input.root, "node_modules");
      const targetStat = lstatSync(target, { throwIfNoEntry: false });
      if (
        targetStat &&
        (!targetStat.isDirectory() || targetStat.isSymbolicLink())
      ) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "dependency-path-unsafe",
        };
      }
      if (!targetStat) mkdirSync(target, { mode: 0o700 });
      mounts.push({ source: nodeModules, target: "/workspace/node_modules" });
    }
    mounts.push(...runners.mounts);
    const isolation = new BubblewrapIsolationBackend();
    const steps = verificationSteps(input.verification);
    let final:
      | {
          exitCode: number;
          classification: AtomicVerificationContract["classification"];
          diagnostic: { kind: "assertion" | "compiler"; id: string };
        }
      | undefined;
    for (const step of steps) {
      const invocation = verificationInvocation(step, runners.bindings);
      if (!invocation) {
        return {
          ok: false as const,
          kind: "paused" as const,
          code: "runner-missing",
        };
      }
      const executed = await isolation.run({
        root: input.root,
        executable: invocation.executable,
        args: invocation.args,
        mounts,
        environment: { CI: "1" },
        signal: input.signal,
      });
      if (!executed.ok) {
        if (executed.state === "cancelled") throw input.signal.reason;
        return {
          ok: false as const,
          kind: "paused" as const,
          code: executed.code,
        };
      }
      const report =
        step.kind === "vitest" ? vitestReport(executed.stdout) : undefined;
      const output = `${executed.stdout}\n${executed.stderr}`;
      const identity =
        step.classification !== "expected-red" ||
        (step.kind === "vitest"
          ? report?.failedText.some((text) =>
              text.includes(step.expectedFailure ?? ""),
            ) === true
          : output.includes(step.expectedFailure ?? ""));
      const accepted =
        step.classification === "expected-red"
          ? executed.exitCode !== 0 &&
            identity &&
            (step.kind !== "vitest" ||
              (report !== undefined &&
                report.failed > 0 &&
                report.total >= step.minTests))
          : executed.exitCode === 0 &&
            (step.kind !== "vitest" ||
              (report?.success === true && report.total >= step.minTests));
      if (!accepted) {
        return {
          ok: false as const,
          kind: "retryable" as const,
          code:
            step.classification === "expected-red" && executed.exitCode === 0
              ? "red-not-witnessed"
              : "verification-rejected",
          failureIdentities: normalizedFailureIdentities({
            step,
            report,
            output,
            exitCode: executed.exitCode,
          }),
        };
      }
      if (!isVerificationCapabilityCurrent(input.root, capability.value)) {
        return {
          ok: false as const,
          kind: "retryable" as const,
          code: "verification-input-unavailable",
        };
      }
      final = {
        exitCode: executed.exitCode,
        classification: step.classification,
        diagnostic: {
          kind: step.kind === "vitest" ? "assertion" : "compiler",
          id: step.id,
        },
      };
    }
    return final
      ? { ok: true as const, ...final }
      : {
          ok: false as const,
          kind: "paused" as const,
          code: "verification-contract-unsupported",
        };
  } finally {
    if (runners.cleanupRoot) {
      rmSync(runners.cleanupRoot, { recursive: true, force: true });
    }
  }
}

function affectedVerification(
  task: Parameters<
    Parameters<typeof openDurableWorkflowEngine>[0]["proposeCandidate"]
  >[0]["task"],
): StructuredVerificationContract {
  if (task.affectedVerification) {
    return structuredClone(task.affectedVerification);
  }
  const finalPhase = task.phases.refactor ?? task.phases.green;
  const verification = structuredClone(finalPhase.verification);
  const affected = [...new Set(task.impactClosure.affectedSuite)].sort();
  if (affected.length === 0) return verification;
  if (verification.kind === "vitest") {
    return { ...verification, testFiles: affected };
  }
  if (verification.kind === "steps") {
    return {
      ...verification,
      steps: verification.steps.map((step) =>
        step.kind === "vitest" ? { ...step, testFiles: affected } : step,
      ),
    };
  }
  return verification;
}

function childRequestId(
  operationId: string,
  taskId: string,
  phase: string,
): string {
  return `child-${sha256(`${operationId}\0${taskId}\0${phase}`).slice(0, 40)}`;
}

export function openPackageWorkflowControlEngine(
  initialContext: ExtensionContext,
  parentPayloadBridge: ParentPayloadBridge,
): WorkflowControlEngine {
  const consumerRoot = path.resolve(initialContext.cwd);
  const routeResolution = loadRoutePolicy({
    cwd: consumerRoot,
    home: homedir(),
    ...(initialContext.model ? { parentModel: initialContext.model } : {}),
  });
  const stateRoot = resolveStateRoot({
    consumerRoot,
    xdgStateHome: process.env.XDG_STATE_HOME,
  });
  const contexts = new AsyncLocalStorage<ExtensionContext>();
  const design = DesignController.open({
    consumerRoot,
    stateRoot,
    inspectOpenSpec: inspectOpenSpecDelivery,
  });
  const implementationAgent = loadAgentDefinitions().find(
    (agent) => agent.role === "implementation-worker",
  );
  if (!implementationAgent) {
    throw new Error("implementation-worker-agent-unavailable");
  }
  const engine = openDurableWorkflowEngine({
    consumerRoot,
    stateRoot,
    deliverySource: packageDeliverySource(consumerRoot, {
      verifyGateProof: (input) => design.verifyGateProof(input),
      verifyFinalizedDelivery: (input) => design.verifyFinalizedDelivery(input),
    }),
    routePolicy: routeResolution.ok
      ? routeResolution.policy
      : unavailableRoutePolicy(),
    proposeCandidate: async (input) => {
      const context = contexts.getStore();
      if (!context) {
        return { kind: "paused", code: "parent-context-unavailable" };
      }
      const phaseRuntime = await runtimeForWorkerRoute(
        input.route as WorkerRoutePolicy,
        context,
        parentPayloadBridge,
        input.signal,
        process.env,
        { onResponse: input.onHeaders },
      );
      if (!phaseRuntime.ok) {
        if (phaseRuntime.failure.kind === "cancelled") {
          return { kind: "operation-cancelled", code: "cancelled" };
        }
        throw new Error(phaseRuntime.failure.code);
      }
      const phase = input.task.phases[input.phase];
      if (!phase) {
        return { kind: "paused", code: "task-phase-unavailable" };
      }
      const taskPhases = Object.values(input.task.phases);
      const executionBoundary = input.artifactCorrection
        ? {
            read: [
              ...new Set(
                taskPhases.flatMap((boundary) => [
                  ...boundary.read,
                  ...boundary.write,
                  ...boundary.delete,
                ]),
              ),
            ].sort(),
            write: [
              ...new Set(taskPhases.flatMap((boundary) => boundary.write)),
            ].sort(),
            delete: [
              ...new Set(taskPhases.flatMap((boundary) => boundary.delete)),
            ].sort(),
          }
        : {
            read: [...phase.read],
            write: [...phase.write],
            delete: [...phase.delete],
          };
      const phaseContract = {
        candidateId: input.candidateArtifact.identity.candidateId,
        taskId: input.taskId,
        phase: input.phase,
        readSet: executionBoundary.read,
        writeSet: executionBoundary.write,
        deleteSet: executionBoundary.delete,
        verification: structuredClone(phase.verification),
        agentsImpact: input.task.agents.impact,
        agentsTarget: input.task.agents.target ?? null,
        agentsManagedOnly: true,
        agentsWriteAllowed: false,
        impactClosure: structuredClone(input.task.impactClosure),
        ...(input.artifactCorrection
          ? { artifactCorrection: structuredClone(input.artifactCorrection) }
          : {}),
        ...(input.contextRequest
          ? { requestedContext: structuredClone(input.contextRequest) }
          : {}),
        ...(input.repair
          ? {
              repair: {
                attempt: input.repair.attempt,
                attribution: input.repair.attribution,
                failureIdentities: [...input.repair.failureIdentities],
                verification: structuredClone(input.task.repairVerification),
                inBoundaryOnly: true,
              },
            }
          : {}),
      };
      const child = await runChildSession({
        cwd: input.workspaceRoot,
        modelRuntime: phaseRuntime.modelRuntime,
        model: phaseRuntime.model,
        systemPrompt: [
          implementationAgent.content,
          input.task.objective,
          input.task.context.agents,
          input.task.context.contract,
          `<phase-contract>${JSON.stringify(phaseContract)}</phase-contract>`,
        ].join("\n\n"),
        requestId: childRequestId(input.operationId, input.taskId, input.phase),
        taskId: input.taskId,
        role: "implementation-worker",
        phase: input.phase,
        output: "diff",
        roots: input.task.roots.map((root) =>
          path.resolve(input.workspaceRoot, root),
        ),
        allowedPaths: [
          ...new Set([
            ...executionBoundary.read,
            ...executionBoundary.write,
            ...executionBoundary.delete,
          ]),
        ],
        timeoutMs: LIMITS.phaseTimeoutMs,
        signal: input.signal,
        failureOverride: phaseRuntime.failureOverride,
        ledgerProjection: input.ledgerProjection,
        candidateArtifact: input.candidateArtifact,
        onStreamProgress: input.onProgress,
      });
      if (!child.ok) {
        if (child.failure.kind === "transport") {
          throw new Error(child.failure.code);
        }
        if (child.failure.kind === "cancelled") {
          return { kind: "operation-cancelled", code: "cancelled" };
        }
        if (child.failure.kind === "approval-boundary") {
          return { kind: "approval-needed", code: child.failure.code };
        }
        if (child.failure.kind === "result-limit") {
          return { kind: "paused", code: "needs-task-split" };
        }
        const attemptDiagnostic = {
          finalCategory: child.classification.finalCategory,
          submitAttempts: child.classification.attempts,
          schema: child.classification.schema,
          identityMismatch: Object.entries(child.classification.identity)
            .filter(([, matches]) => !matches)
            .map(([dimension]) => dimension),
        };
        return child.failure.kind === "environment" ||
          child.failure.kind === "verification-adapter"
          ? { kind: "paused", code: child.failure.code, attemptDiagnostic }
          : { kind: "retryable", code: child.failure.code, attemptDiagnostic };
      }
      const result = child.result;
      if (result.kind === "context-request") {
        return classifyCandidateContextRequest(result, {
          phase: input.phase,
          readPaths: phase.read,
          writePaths: phase.write,
          deletePaths: phase.delete,
          taskPaths: [
            ...new Set(
              Object.values(input.task.phases).flatMap((boundary) => [
                ...boundary.read,
                ...boundary.write,
                ...boundary.delete,
              ]),
            ),
          ],
          redWritePaths: input.task.phases.red.write,
          agents: {
            impact: input.task.agents.impact,
            ...(input.task.agents.target
              ? { target: input.task.agents.target }
              : {}),
          },
        });
      }
      if (result.kind !== "sealed-candidate") {
        return { kind: "retryable", code: "candidate-diff-invalid" };
      }
      return {
        kind: "sealed-candidate",
        candidateId: result.candidateId,
        artifactHash: result.artifactHash,
        bytes: result.bytes,
        paths: [...result.paths],
      };
    },
    verifyPhase: (input) =>
      executePackageVerification({
        root: input.root,
        dependencyOwner: consumerRoot,
        verification: input.verification,
        signal: input.signal,
      }),
    verifyChange: async (input) => {
      const verifications = input.verification
        ? [input.verification]
        : input.plan.tasks.map((task) => affectedVerification(task));
      for (const verification of verifications) {
        const result = await executePackageVerification({
          root: input.root,
          dependencyOwner: consumerRoot,
          verification,
          signal: input.signal,
        });
        if (!result.ok) {
          const adapter = new Set([
            "runner-missing",
            "script-missing",
            "script-command-mismatch",
            "local-executable-missing",
          ]).has(result.code);
          return {
            ok: false,
            kind: adapter
              ? ("verification-adapter" as const)
              : result.kind === "paused"
                ? ("environment" as const)
                : ("verification" as const),
            code: result.code,
            ...(result.failureIdentities
              ? { failureIdentities: result.failureIdentities }
              : {}),
          };
        }
      }
      return {
        ok: true,
        exitCode: 0,
        classification: "expected-green",
      };
    },
  });
  return {
    async execute(
      command: unknown,
      context = initialContext,
      signal,
      onActivity,
    ) {
      const operationRouteResolution = loadRoutePolicy({
        cwd: consumerRoot,
        home: homedir(),
        ...(context.model ? { parentModel: context.model } : {}),
      });
      engine.updateRoutePolicy(
        operationRouteResolution.ok
          ? operationRouteResolution.policy
          : unavailableRoutePolicy(),
      );
      const validation = validateControlCommand(command);
      if (!validation.ok) {
        const error = new Error(validation.code);
        error.name = "ControlCommandError";
        throw error;
      }
      return contexts.run(context, async () => {
        const outcome = await engine.execute(
          validation.value,
          signal,
          onActivity,
        );
        const routePolicy = visibleRoutePolicyStatus(
          operationRouteResolution,
          engine.routePolicyStatus(),
        );
        return { ...outcome, routePolicy };
      });
    },
    executeDesign(request: unknown) {
      return design.execute(request);
    },
    assertDesignRun(runId: string) {
      design.assertDesignRun(runId);
    },
    recordDesignEvidence(input) {
      return design.recordEvidence(input);
    },
    async close() {
      contexts.disable();
      await engine.close();
      design.close();
    },
  };
}

function runStoreUnavailableStatus(
  error: RunStoreFormatError,
  command: {
    stage: "abel-implement";
    change: string;
  },
): Record<string, unknown> {
  return {
    stage: command.stage,
    change: command.change,
    state: "paused",
    durable: false,
    completed: false,
    pause: { code: error.code },
    legalCommands: ["status", "start"],
    tasks: [],
    queue: [],
    controlStore: {
      code: error.code,
      databasePath: error.databasePath,
      recovery: structuredClone(error.recovery),
    },
  };
}

function runStoreResetError(error: RunStoreFormatError): Error {
  const reset = new Error(
    `${error.code}: back up and remove the private run store at ${error.databasePath}, then retry the operation`,
  );
  reset.name = "RunStoreResetError";
  return reset;
}

function visibleRoutePolicyStatus(
  resolution: RoutePolicyResolution,
  brokerStatus: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!resolution.ok) return inspectRoutePolicy(resolution);
  const inspected = brokerStatus ?? inspectRoutePolicy(resolution);
  return {
    ...inspected,
    source: { kind: resolution.source.kind },
  };
}

export function registerWorkflowControl(
  pi: ExtensionAPI,
  engineFactory: WorkflowControlEngineFactory = openPackageWorkflowControlEngine,
): void {
  const parentPayloadBridge = new ParentPayloadBridge();
  const activity = new ActivityController();
  const engines = new Map<string, Promise<WorkflowControlEngine>>();
  const designFailures = new Map<string, SafeDesignFailure>();
  let pendingPrompt: EligiblePrompt | undefined;
  let activePrompt: EligiblePrompt | undefined;
  let designToolSnapshot: string[] | undefined;
  const activation = new (class implements Activation {
    state: Activation["state"] = "inactive";

    isActive(): boolean {
      return this.state === "active";
    }

    request(): boolean {
      if (this.state !== "inactive") return false;
      this.state = "pending";
      return true;
    }

    activate(): boolean {
      if (this.state !== "pending") return false;
      this.state = "active";
      return true;
    }

    drain(): boolean {
      if (this.state === "inactive" || this.state === "pending") return false;
      this.state = "inactive";
      return true;
    }
  })();
  const packetRuntime = new PacketRuntime({ activation, parentPayloadBridge });

  const engineFor = (ctx: ExtensionContext) => {
    const key = ctx.cwd;
    const existing = engines.get(key);
    if (existing) return existing;
    const opened = Promise.resolve(engineFactory(ctx, parentPayloadBridge));
    engines.set(key, opened);
    void opened.catch(() => {
      if (engines.get(key) === opened) engines.delete(key);
    });
    return opened;
  };
  const closeEngines = async () => {
    const current = [...engines.values()];
    engines.clear();
    const opened = await Promise.allSettled(current);
    await Promise.allSettled(
      opened.flatMap((result) =>
        result.status === "fulfilled"
          ? [Promise.resolve(result.value.close())]
          : [],
      ),
    );
  };
  const restoreDesignTools = () => {
    if (!designToolSnapshot) return;
    const snapshot = designToolSnapshot;
    designToolSnapshot = undefined;
    pi.setActiveTools([...snapshot]);
  };
  const enforceDesignTools = () => {
    if (!designToolSnapshot) {
      designToolSnapshot = pi
        .getActiveTools()
        .filter((name) => name !== DISPATCH_TOOL);
    }
    pi.setActiveTools(
      activateTool(
        designToolSnapshot.filter((name) => DESIGN_PARENT_READ_TOOLS.has(name)),
        DISPATCH_TOOL,
      ),
    );
  };
  const deactivate = () => {
    activation.drain();
    if (designToolSnapshot) {
      restoreDesignTools();
      return;
    }
    const active = pi.getActiveTools();
    if (active.includes(DISPATCH_TOOL)) {
      pi.setActiveTools(deactivateTool(active, DISPATCH_TOOL));
    }
  };
  const deactivateStage = async () => {
    activePrompt = undefined;
    await packetRuntime.drain();
    deactivate();
    parentPayloadBridge.clear();
  };

  // Pi validates tool arguments before execute(), so expose only the schema
  // legal for the active stage instead of one ambiguous command/packet union.
  const PACKET_PARAMETERS = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...PACKET_ACTIONS, "design"],
        description:
          "Top-level dispatch action. design and run require request; finish is explicit stage exit and MUST omit request.",
      },
      request: {
        anyOf: [
          DESIGN_REQUEST_SCHEMA,
          DESIGN_CONTROL_REQUEST_SCHEMA,
          GENERIC_REQUEST_SCHEMA,
        ],
      },
    },
    required: ["action"],
    additionalProperties: false,
  } as const;
  let registeredParameterKind: "command" | "packet" | undefined;

  const registerDispatchTool = (kind: "command" | "packet") => {
    if (registeredParameterKind === kind) return;
    registeredParameterKind = kind;
    pi.registerTool({
      name: DISPATCH_TOOL,
      label: "Abel Control",
      description:
        kind === "command"
          ? "Private stage-bound Abel workflow control. Accepts durable Implement change commands."
          : "Private stage-bound Abel packet control. Accepts bounded Design and Diagnose packet operations.",
      executionMode: "parallel",
      ...(kind === "command"
        ? {
            prepareArguments: (args: unknown) =>
              canonicalizeControlCommandToolInput(args) as never,
          }
        : {}),
      parameters:
        kind === "command" ? CONTROL_COMMAND_PARAMETERS : PACKET_PARAMETERS,
      async execute(
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<unknown> | undefined,
        ctx: ExtensionContext,
      ) {
        const record =
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : undefined;
        if (record && typeof record.action === "string") {
          if (
            Object.keys(record).some(
              (key) => key !== "action" && key !== "request",
            )
          ) {
            throw new Error("control-envelope-ambiguous");
          }
          if (record.action === "finish" && Object.hasOwn(record, "request")) {
            throw new Error("control-envelope-ambiguous");
          }
          if (
            activePrompt !== "abel-design" &&
            activePrompt !== "abel-diagnose"
          ) {
            throw new Error("stage-control-mismatch");
          }
          if (record.action === "design") {
            if (activePrompt !== "abel-design") {
              throw new Error("stage-control-mismatch");
            }
            const designRequest = validateDesignControlRequest(record.request);
            if (!designRequest.ok) throw new Error(designRequest.code);
            let engine: WorkflowControlEngine;
            try {
              engine = await engineFor(ctx);
            } catch (error) {
              if (error instanceof RunStoreFormatError)
                throw runStoreResetError(error);
              throw error;
            }
            if (!engine.executeDesign)
              throw new Error("design-control-unavailable");
            try {
              const payload = await engine.executeDesign(designRequest.value);
              if (
                designRequest.value.operation === "finalize-delivery" &&
                payload.state === "completed"
              ) {
                await deactivateStage();
              }
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify(payload) },
                ],
                details: payload,
              };
            } catch (error) {
              const failure = safeDesignFailure(
                error,
                designRequest.value.operation,
              );
              designFailures.set(toolCallId, failure);
              const sanitized = new Error(failure.code);
              sanitized.name = "DesignControlError";
              throw sanitized;
            }
          }
          let designEngine: WorkflowControlEngine | undefined;
          if (record.action === "run") {
            const packet = packetRuntime.validateRequest(record.request);
            if (!packet.ok || packet.value.stage !== activePrompt) {
              throw new Error(
                packet.ok ? "stage-control-mismatch" : packet.reason,
              );
            }
            if (packet.value.stage === "abel-design") {
              try {
                designEngine = await engineFor(ctx);
              } catch (error) {
                if (error instanceof RunStoreFormatError)
                  throw runStoreResetError(error);
                throw error;
              }
              if (!designEngine.assertDesignRun || !packet.value.runId) {
                throw new Error("design-control-unavailable");
              }
              designEngine.assertDesignRun(packet.value.runId);
            }
          }
          const operation = {
            request: record.request,
          };
          const tuiRun = ctx.mode === "tui" && record.action === "run";
          const packetPayload = tuiRun
            ? await packetRuntime.execute(
                record.action,
                operation,
                ctx,
                signal,
                activity.observe(
                  toolCallId,
                  onUpdate as ((result: unknown) => void) | undefined,
                ),
              )
            : await packetRuntime.execute(
                record.action,
                operation,
                ctx,
                signal,
              );
          let payload:
            | typeof packetPayload
            | (typeof packetPayload & {
                recordedEvidence: unknown;
              }) = packetPayload;
          if (
            packetPayload.ok &&
            record.action === "run" &&
            activePrompt === "abel-design"
          ) {
            const packet = packetRuntime.validateRequest(record.request);
            if (
              !packet.ok ||
              !packet.value.runId ||
              !designEngine?.recordDesignEvidence
            ) {
              throw new Error("design-control-unavailable");
            }
            const recordedEvidence = designEngine.recordDesignEvidence({
              runId: packet.value.runId,
              evidence: packetPayload.result as DesignEvidenceResult,
            });
            payload = { ...packetPayload, recordedEvidence };
          }
          if (record.action === "finish" && packetPayload.ok) {
            await deactivateStage();
          }
          const display = tuiRun
            ? activity.finalize(toolCallId, payload)
            : undefined;
          const { payload: publicPayload, usage } = splitUsage(payload);
          const details = display
            ? {
                ...(publicPayload as Record<string, unknown>),
                [ACTIVITY_DETAILS_KEY]: display,
              }
            : publicPayload;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(publicPayload) },
            ],
            details,
            ...(usage === undefined ? {} : { usage }),
          };
        }
        const validation = validateControlCommand(
          canonicalizeControlCommandToolInput(params),
        );
        if (!validation.ok) {
          const error = new Error(validation.code);
          error.name = "ControlCommandError";
          throw error;
        }
        if (
          activePrompt !== undefined &&
          (activePrompt === "abel-diagnose" ||
            validation.value.stage !== activePrompt)
        ) {
          throw new Error("stage-control-mismatch");
        }
        let engine: WorkflowControlEngine;
        try {
          engine = await engineFor(ctx);
        } catch (error) {
          if (!(error instanceof RunStoreFormatError)) throw error;
          const payload = runStoreUnavailableStatus(error, validation.value);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
            details: payload,
          };
        }
        const tuiControl = ctx.mode === "tui";
        if (tuiControl) {
          try {
            activity.beginWorkflow(
              toolCallId,
              validation.value,
              onUpdate as ((result: unknown) => void) | undefined,
            );
          } catch {
            // Presentation state must never alter workflow execution.
          }
        }
        let payload: Record<string, unknown>;
        try {
          payload = await engine.execute(
            validation.value,
            ctx,
            signal,
            tuiControl
              ? (event) => {
                  try {
                    activity.updateWorkflow(
                      toolCallId,
                      validation.value,
                      event,
                    );
                  } catch {
                    // Presentation state must never alter workflow execution.
                  }
                }
              : undefined,
          );
        } catch (error) {
          if (tuiControl) activity.failWorkflow(toolCallId);
          throw error;
        }
        if (
          ["completed", "discarded", "rejected"].includes(String(payload.state))
        ) {
          await deactivateStage();
        }
        let display: ReturnType<typeof activity.finalizeWorkflow>;
        if (tuiControl) {
          try {
            display = activity.finalizeWorkflow(
              toolCallId,
              validation.value,
              payload,
            );
          } catch {
            activity.failWorkflow(toolCallId);
          }
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          details: display
            ? { ...payload, [ACTIVITY_DETAILS_KEY]: display }
            : payload,
        };
      },
      renderCall(args: unknown, theme: Theme, context: unknown) {
        return renderActivityCall(
          args,
          theme,
          context as Parameters<typeof renderActivityCall>[2],
        );
      },
      renderResult(
        result: AgentToolResult<unknown>,
        options: ToolRenderResultOptions,
        theme: Theme,
        context: unknown,
      ) {
        return renderActivityResult(
          result,
          options,
          theme,
          context as Parameters<typeof renderActivityResult>[3],
        );
      },
    } as never);
  };
  registerDispatchTool("packet");

  pi.on("tool_result", (event) => {
    if (
      event.toolName !== DISPATCH_TOOL ||
      !event.isError ||
      event.input.action !== "design"
    ) {
      return;
    }
    const errorText = event.content
      .flatMap((item) =>
        item.type === "text" && typeof item.text === "string"
          ? [item.text]
          : [],
      )
      .join("\n");
    const failure = safeDesignFailure(
      new Error(errorText.trim()),
      typeof (event.input.request as Record<string, unknown> | undefined)
        ?.operation === "string"
        ? String((event.input.request as Record<string, unknown>).operation)
        : "unknown",
    );
    const details =
      event.details && typeof event.details === "object"
        ? (event.details as Record<string, unknown>)
        : {};
    const visible = designFailures.get(event.toolCallId) ?? failure;
    designFailures.delete(event.toolCallId);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(visible) }],
      details: { ...details, designFailure: visible },
    };
  });
  pi.on("input", (event) => {
    pendingPrompt = invokedPrompt(event.text);
    return { action: "continue" };
  });
  pi.on("before_agent_start", (event, ctx) => {
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    const verified =
      prompt && isVerifiedStageInvocation(pi, activation, prompt, event.prompt);
    if (verified) {
      if (activePrompt === "abel-design" && prompt !== "abel-design") {
        restoreDesignTools();
      }
      registerDispatchTool(prompt === "abel-implement" ? "command" : "packet");
      activePrompt = prompt;
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (typeof sessionId === "string") {
        parentPayloadBridge.beginSession(sessionId);
      } else {
        parentPayloadBridge.clear();
      }
    }
    if (ctx.model) {
      parentPayloadBridge.install(ctx.model, ctx.modelRegistry);
    }
    if (prompt) activateDispatcher(pi, activation, prompt, event.prompt);
    if (verified && prompt === "abel-design") enforceDesignTools();
  });
  pi.on("model_select", (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (typeof sessionId !== "string") {
      parentPayloadBridge.clear();
      return;
    }
    parentPayloadBridge.beginSession(sessionId);
    const model = event.model ?? ctx.model;
    if (model) parentPayloadBridge.install(model, ctx.modelRegistry);
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (
      activePrompt !== "abel-design" ||
      ctx.model?.api !== "openai-responses" ||
      event.payload === null ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      return;
    }
    return { ...event.payload, parallel_tool_calls: true };
  });
  pi.on("session_start", async (_event, ctx) => {
    pendingPrompt = undefined;
    activePrompt = undefined;
    designFailures.clear();
    activity.detach();
    await packetRuntime.drain();
    await closeEngines();
    deactivate();
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (typeof sessionId === "string") {
      parentPayloadBridge.beginSession(sessionId);
      if (ctx.model) parentPayloadBridge.install(ctx.model, ctx.modelRegistry);
    } else {
      parentPayloadBridge.clear();
    }
    if (ctx.mode === "tui") activity.attach(ctx.ui);
  });
  pi.on("session_shutdown", async () => {
    activePrompt = undefined;
    designFailures.clear();
    activity.detach();
    await packetRuntime.drain();
    await closeEngines();
    activity.clear();
    deactivate();
    parentPayloadBridge.clear();
  });
}

export default function register(pi: ExtensionAPI): void {
  registerWorkflowControl(pi);
}
