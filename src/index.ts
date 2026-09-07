import { compareCanonicalStrings } from "./canonical.ts";
import { CHANGE_CONTRACT_SCHEMA } from "./change-contract-schema.ts";
import {
  projectDesignDiagnostic,
  type SafeDesignDiagnostic,
} from "./design-diagnostics.ts";
import { openPackageWorkflowService } from "./package-workflow.ts";
import { packageContext } from "./pi-adapter.ts";

export {
  type PackageDeliverySourceOptions,
  type PackageWorkflowDeliverySource,
  packageDeliverySource,
} from "./package-delivery.ts";
export { executePackageVerification } from "./package-verification.ts";

// Private workflow orchestration extension. Registers the abel_dispatch tool
// on load, then keeps it inactive by default by removing only that name from
// the active set at session start. Eligible-stage activation is wired by the
// workflow routing (abel-design/implement/diagnose provenance) in the prompts
// integration; abel-init and ordinary prompts never activate dispatch.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { type Activation, activateTool, deactivateTool } from "./activation.ts";

import type { DesignEvidenceResult } from "./contracts.ts";
import {
  CONTROL_COMMAND_PARAMETERS,
  canonicalizeControlCommandToolInput,
  validateControlCommand,
} from "./control-contracts.ts";
import {
  DeliveryValidationError,
  DesignPlanValidationError,
} from "./delivery-compiler.ts";
import {
  DesignControlValidationError,
  DesignFinalizationError,
  validateDesignControlRequest,
} from "./design-control.ts";
import { canonicalJson } from "./implement-graph.ts";
import { PACKET_ACTIONS, PacketRuntime } from "./packet-runtime.ts";

import { RunStoreFormatError, RunStoreMigrationError } from "./run-store.ts";

import { StateRootError } from "./state-root.ts";
import {
  ACTIVITY_DETAILS_KEY,
  ActivityController,
  renderActivityCall,
  renderActivityResult,
  type WorkflowActivityUpdate,
} from "./subagent-activity.ts";

export {
  inspectOpenSpecDelivery,
  type OpenSpecDeliveryInspection,
} from "./openspec-cli.ts";

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
          anyOf: [{ type: "string" }, CHANGE_CONTRACT_SCHEMA],
          description:
            "ChangeContract: {goal, acceptance:[{id,statement,verification}], constraints:[{id,statement}], policy:{writeRoots,dependencies,verificationModes}}. Pass the example's changeContract object, not its whole plan. Legacy prose remains readable; code hashes authority.",
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
          description: `Exact bounded UTF-8 artifact content. For plan-draft.json, omit tracking, phase verificationInputs and relatedTests disposition to derive them. Read the complete example at ${join(PACKAGE_ROOT, "config/plan-draft.example.json")}.`,
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

type WorkflowPrompt = EligiblePrompt | "abel-init";

function promptMarker(name: WorkflowPrompt): string {
  return `<!-- ABEL:PROMPT:${name} -->`;
}

function hasPackageProvenance(pi: ExtensionAPI, name: WorkflowPrompt): boolean {
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
  name: WorkflowPrompt,
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
  diagnostics: readonly SafeDesignDiagnostic[];
};

type DesignFailureBoundary =
  | "dispatch"
  | "initialization"
  | "execution"
  | "serialization";

function sqliteLocked(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    ((error as { errcode?: unknown }).errcode === 5 ||
      (error as { errcode?: unknown }).errcode === 6)
  );
}

function sqliteUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const errcode = Number((error as { errcode?: unknown }).errcode);
  const code = (error as { code?: unknown }).code;
  return (
    [8, 10, 13, 14, 23, 24].includes(errcode) ||
    (typeof code === "string" &&
      [
        "EACCES",
        "EBUSY",
        "EMFILE",
        "ENFILE",
        "ENOSPC",
        "EPERM",
        "EROFS",
      ].includes(code))
  );
}

function classifyDesignFailure(
  error: unknown,
  operation: string,
  boundary: DesignFailureBoundary,
): {
  code: string;
  category: string;
  retryable: boolean;
  field?: string;
} {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof DesignControlValidationError) {
    return {
      code: "invalid-design-control-request",
      category: "validation",
      retryable: false,
    };
  }
  if (error instanceof DesignPlanValidationError) {
    return {
      code: "design-plan-validation-invalid",
      category: "validation",
      retryable: false,
    };
  }
  if (
    error instanceof RunStoreMigrationError ||
    error instanceof RunStoreFormatError
  ) {
    return {
      code: "design-store-migration-failed",
      category: "storage",
      retryable: false,
      field: "schemaVersion",
    };
  }
  if (sqliteLocked(error)) {
    return {
      code: "design-store-locked",
      category: "storage",
      retryable: true,
    };
  }
  if (sqliteUnavailable(error)) {
    return {
      code: "design-store-unavailable",
      category: "storage",
      retryable: false,
    };
  }
  if (error instanceof StateRootError) {
    return {
      code: "design-store-unavailable",
      category: "storage",
      retryable: false,
    };
  }
  if (
    message === "design-operation-conflict" ||
    message === "operation-id-conflict"
  ) {
    return {
      code: "design-operation-conflict",
      category: "control",
      retryable: false,
      field: "operationId",
    };
  }
  if (message === "stage-control-mismatch") {
    return {
      code: "design-stage-inactive",
      category: "stage",
      retryable: false,
    };
  }
  if (message === "invalid-design-control-request") {
    return {
      code: "invalid-design-control-request",
      category: "validation",
      retryable: false,
    };
  }
  if (boundary === "serialization") {
    return {
      code: "design-receipt-serialization-failed",
      category: "control",
      retryable: false,
    };
  }
  if (boundary === "initialization") {
    return {
      code: "design-store-unavailable",
      category: "storage",
      retryable: false,
    };
  }
  if (
    error instanceof DesignFinalizationError ||
    error instanceof DeliveryValidationError ||
    (message.startsWith("design-") && SAFE_DESIGN_ERROR_CODE.test(message))
  ) {
    return { code: message, category: "control", retryable: false };
  }
  if (operation === "start") {
    return {
      code: "design-run-create-failed",
      category: "storage",
      retryable: false,
    };
  }
  return {
    code: "design-control-internal",
    category: "control",
    retryable: false,
  };
}

function safeDesignFailure(
  error: unknown,
  operation: string,
  boundary: DesignFailureBoundary = "dispatch",
): SafeDesignFailure {
  const classified = classifyDesignFailure(error, operation, boundary);
  const rawDiagnostics: readonly unknown[] =
    error instanceof DesignFinalizationError ||
    error instanceof DesignPlanValidationError ||
    error instanceof DeliveryValidationError
      ? error instanceof DesignFinalizationError
        ? [
            ...error.diagnostics.filter(
              (code) =>
                !error.openSpecDiagnostic ||
                code !== "design-openspec-unavailable",
            ),
            ...(error.openSpecDiagnostic ? [error.openSpecDiagnostic] : []),
          ]
        : error.diagnostics
      : [];
  const diagnostics = rawDiagnostics
    .flatMap((candidate) => {
      const diagnostic = projectDesignDiagnostic(candidate);
      return diagnostic ? [diagnostic] : [];
    })
    .sort((left, right) =>
      compareCanonicalStrings(canonicalJson(left), canonicalJson(right)),
    )
    .filter(
      (candidate, index, values) =>
        index === 0 ||
        canonicalJson(candidate) !== canonicalJson(values[index - 1]),
    )
    .slice(0, MAX_DESIGN_ERROR_DIAGNOSTICS);
  if (diagnostics.length === 0) {
    diagnostics.push({
      code: classified.code,
      category: classified.category,
      retryable: classified.retryable,
      ...(classified.field ? { field: classified.field } : {}),
    });
  }
  return {
    kind: "design-control-failure",
    operation: SAFE_DESIGN_ERROR_CODE.test(operation) ? operation : "unknown",
    code: classified.code,
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
  executeAmendment?(
    change: string,
    batchId: string,
    request: unknown,
  ): Promise<Record<string, unknown>>;
  assertDesignRun?(runId: string): void;
  recordDesignEvidence?(input: {
    runId: string;
    evidence: DesignEvidenceResult;
  }): unknown;
  close(): void | Promise<void>;
}

export type WorkflowControlEngineFactory = (
  ctx: ExtensionContext,
) => WorkflowControlEngine | Promise<WorkflowControlEngine>;

/** Pi adapter: project host capabilities before entering the package services. */
export function openPackageWorkflowControlEngine(
  initialContext: ExtensionContext,
): WorkflowControlEngine {
  const service = openPackageWorkflowService(packageContext(initialContext));
  return {
    ...service,
    execute(command, context = initialContext, signal, onActivity) {
      return service.execute(
        command,
        packageContext(context),
        signal,
        onActivity,
      );
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

export function registerWorkflowControl(
  pi: ExtensionAPI,
  engineFactory: WorkflowControlEngineFactory = openPackageWorkflowControlEngine,
): void {
  const activity = new ActivityController();
  const engines = new Map<string, Promise<WorkflowControlEngine>>();
  const designOperations = new Set<Promise<void>>();
  const designFailures = new Map<string, SafeDesignFailure>();
  let pendingPrompt: EligiblePrompt | undefined;
  let pendingInit = false;
  let exitingStage = false;
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
  const packetRuntime = new PacketRuntime({ activation });

  const engineFor = (ctx: ExtensionContext) => {
    const key = ctx.cwd;
    const existing = engines.get(key);
    if (existing) return existing;
    const opened = Promise.resolve(engineFactory(ctx));
    engines.set(key, opened);
    void opened.catch(() => {
      if (engines.get(key) === opened) engines.delete(key);
    });
    return opened;
  };
  const closeEngines = async () => {
    // Design close() is synchronous and does not own an operation queue.
    // Keep its journal open through finalization's commit/lease-cleanup path
    // and the dispatch result handling before closing any engine storage.
    await Promise.all([...designOperations]);
    const closed = await Promise.allSettled(
      [...engines].map(async ([key, opened]) => {
        const engine = await opened;
        await engine.close();
        if (engines.get(key) === opened) engines.delete(key);
      }),
    );
    const failed = closed.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
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
  };
  const exitStage = async () => {
    if (exitingStage) throw new Error("stage-control-mismatch");
    exitingStage = true;
    try {
      await closeEngines();
      await deactivateStage();
    } finally {
      exitingStage = false;
    }
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

  // Stage exit is session control, not a durable Implement command. Keep the
  // six engine commands unchanged and admit only this exact extra envelope.
  const FINISH_PARAMETERS = {
    type: "object",
    properties: { action: { type: "string", enum: ["finish"] } },
    required: ["action"],
    additionalProperties: false,
  } as const;
  const AMEND_PARAMETERS = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["amend"] },
      change: { type: "string" },
      batchId: { type: "string" },
      request: DESIGN_CONTROL_REQUEST_SCHEMA,
    },
    required: ["action", "change", "batchId", "request"],
    additionalProperties: false,
  } as const;
  const IMPLEMENT_PARAMETERS = {
    ...CONTROL_COMMAND_PARAMETERS,
    properties: {
      ...CONTROL_COMMAND_PARAMETERS.properties,
      ...AMEND_PARAMETERS.properties,
      action: { type: "string", enum: ["finish", "amend"] },
    },
    required: [],
    anyOf: [
      ...CONTROL_COMMAND_PARAMETERS.anyOf,
      FINISH_PARAMETERS,
      AMEND_PARAMETERS,
    ],
  } as const;
  const prepareImplementArguments = (args: unknown): unknown => {
    if (!args || typeof args !== "object" || Array.isArray(args)) return args;
    const record = { ...(args as Record<string, unknown>) };
    // Strict providers can pad fields belonging to the other union branch.
    if (record.action !== "amend") {
      for (const key of ["batchId", "request"]) {
        if (record[key] === null || record[key] === undefined)
          delete record[key];
      }
    }
    if (record.action === "finish" || record.action === "amend") {
      for (const key of Object.keys(CONTROL_COMMAND_PARAMETERS.properties)) {
        if (record[key] === null || record[key] === undefined)
          delete record[key];
      }
      return record;
    }
    if (record.action === null || record.action === undefined)
      delete record.action;
    return canonicalizeControlCommandToolInput(record);
  };

  const registerDispatchTool = (kind: "command" | "packet") => {
    if (registeredParameterKind === kind) return;
    registeredParameterKind = kind;
    pi.registerTool({
      name: DISPATCH_TOOL,
      label: "Abel Control",
      description:
        kind === "command"
          ? 'Private stage-bound Abel workflow control. Accepts durable Implement commands, batch-bound {"action":"amend"} artifact revisions, or {"action":"finish"} to leave and preserve resumable work.'
          : "Private stage-bound Abel packet control. Accepts bounded Design and Diagnose packet operations.",
      executionMode: "parallel",
      ...(kind === "command"
        ? {
            prepareArguments: (args: unknown) =>
              prepareImplementArguments(args) as never,
          }
        : {}),
      parameters: kind === "command" ? IMPLEMENT_PARAMETERS : PACKET_PARAMETERS,
      async execute(
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: AgentToolUpdateCallback<unknown> | undefined,
        ctx: ExtensionContext,
      ) {
        if (
          exitingStage ||
          !activation.isActive() ||
          activePrompt === undefined
        ) {
          throw new Error("stage-control-mismatch");
        }
        if (kind === "command") params = prepareImplementArguments(params);
        const record =
          params && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : undefined;
        if (record?.action === "amend") {
          if (
            activePrompt !== "abel-implement" ||
            Object.keys(record).some(
              (key) =>
                !["action", "change", "batchId", "request"].includes(key),
            ) ||
            typeof record.change !== "string" ||
            typeof record.batchId !== "string"
          ) {
            throw new Error("stage-control-mismatch");
          }
          const parsed = validateDesignControlRequest(record.request);
          if (!parsed.ok) {
            const error = new DesignControlValidationError(parsed.diagnostics);
            designFailures.set(
              toolCallId,
              safeDesignFailure(error, "validation"),
            );
            throw error;
          }
          const request = parsed.value;
          if (
            request.operation === "bind-change" ||
            (request.operation === "start" &&
              (!("change" in request) || request.change !== record.change))
          ) {
            throw new Error("amendment-change-mismatch");
          }
          let settle!: () => void;
          const pending = new Promise<void>((resolve) => {
            settle = resolve;
          });
          designOperations.add(pending);
          try {
            const engine = await engineFor(ctx);
            if (exitingStage || !activation.isActive() || !engine.executeDesign)
              throw new Error("stage-control-mismatch");
            const status = await engine.execute(
              {
                command: "status",
                stage: "abel-implement",
                change: record.change,
              },
              ctx,
              signal,
            );
            const batch = status.decisionBatch as { id?: string } | undefined;
            if (
              !["approval-needed", "paused"].includes(String(status.state)) ||
              batch?.id !== record.batchId
            )
              throw new Error("amendment-batch-stale");
            if (request.operation !== "start") {
              const designStatus = await engine.executeDesign({
                operation: "status",
                runId: request.runId,
              });
              if (designStatus.change !== record.change)
                throw new Error("amendment-change-mismatch");
            }
            if (!engine.executeAmendment)
              throw new Error("amendment-control-unavailable");
            const revision = await engine.executeAmendment(
              record.change,
              record.batchId,
              request,
            );
            const payload =
              request.operation === "finalize-delivery" &&
              revision.state === "completed"
                ? {
                    ...revision,
                    scope: "amendment",
                    state: "ready",
                    completed: false,
                    runId: status.runId,
                    amendmentRunId: revision.runId,
                    stage: "abel-implement",
                  }
                : { ...revision, scope: "amendment" };
            // A compiled amendment stays in Implement; its private Design
            // records do not activate the Design stage or broaden parent tools.
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(payload) },
              ],
              details: payload,
            };
          } catch (error) {
            if (
              error instanceof DesignPlanValidationError ||
              error instanceof DesignFinalizationError ||
              error instanceof DeliveryValidationError
            ) {
              const failure = safeDesignFailure(
                error,
                request.operation,
                "execution",
              );
              designFailures.set(toolCallId, failure);
              throw new Error(failure.code);
            }
            throw error;
          } finally {
            settle();
            designOperations.delete(pending);
          }
        }
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
          if (record.action === "finish") {
            // close() aborts and settles active operations before ordinary tools
            // return; durable work is retained, never discarded or completed.
            await exitStage();
            const payload = { ok: true, state: "inactive" };
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(payload) },
              ],
              details: payload,
            };
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
            if (!designRequest.ok) {
              const error = new DesignControlValidationError(
                designRequest.diagnostics,
              );
              designFailures.set(
                toolCallId,
                safeDesignFailure(error, "validation"),
              );
              throw error;
            }
            let settleDesign!: () => void;
            const settled = new Promise<void>((resolve) => {
              settleDesign = resolve;
            });
            // Register before the first await, including asynchronous engine
            // opening. Teardown blocks admission before taking its snapshot.
            designOperations.add(settled);
            let boundary: DesignFailureBoundary = "initialization";
            try {
              const engine = await engineFor(ctx);
              if (exitingStage || !activation.isActive())
                throw new Error("stage-control-mismatch");
              if (!engine.executeDesign)
                throw new Error("design-control-unavailable");
              boundary = "execution";
              const payload = await engine.executeDesign(designRequest.value);
              boundary = "serialization";
              const serialized = JSON.stringify(payload);
              if (serialized === undefined) {
                throw new Error("design-receipt-serialization-failed");
              }
              boundary = "execution";
              if (
                designRequest.value.operation === "finalize-delivery" &&
                payload.state === "completed" &&
                !exitingStage &&
                activePrompt === "abel-design"
              ) {
                await deactivateStage();
              }
              return {
                content: [{ type: "text" as const, text: serialized }],
                details: payload,
              };
            } catch (error) {
              const failure = safeDesignFailure(
                error,
                designRequest.value.operation,
                boundary,
              );
              designFailures.set(toolCallId, failure);
              const sanitized = new Error(failure.code);
              sanitized.name = "DesignControlError";
              throw sanitized;
            } finally {
              designOperations.delete(settled);
              settleDesign();
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
                if (exitingStage || !activation.isActive())
                  throw new Error("stage-control-mismatch");
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
                packageContext(ctx),
                signal,
                activity.observe(
                  toolCallId,
                  onUpdate as ((result: unknown) => void) | undefined,
                ),
              )
            : await packetRuntime.execute(
                record.action,
                operation,
                packageContext(ctx),
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
          activePrompt !== "abel-implement" ||
          validation.value.stage !== activePrompt
        ) {
          throw new Error("stage-control-mismatch");
        }
        let engine: WorkflowControlEngine;
        try {
          engine = await engineFor(ctx);
          if (exitingStage || !activation.isActive())
            throw new Error("stage-control-mismatch");
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
      (event.input.action !== "design" &&
        !(
          event.input.action === "amend" && designFailures.has(event.toolCallId)
        ))
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
    pendingPrompt = undefined;
    pendingInit = false;
    const prompt = invokedPrompt(event.text);
    const init = /^\/abel-init(?:\s|$)/u.test(event.text);
    if (event.source !== "interactive" && event.source !== "rpc") {
      // Stop before Pi expands the template: hiding dispatch alone would still
      // expose the complete workflow instructions to the parent model.
      return { action: prompt || init ? "handled" : "continue" };
    }
    pendingPrompt = prompt;
    pendingInit = init && hasPackageProvenance(pi, "abel-init");
    if (
      activePrompt &&
      (pendingInit ||
        (prompt && prompt !== activePrompt && hasPackageProvenance(pi, prompt)))
    ) {
      return (async () => {
        await exitStage();
        return { action: "continue" as const };
      })();
    }
    return { action: "continue" };
  });
  pi.on("before_agent_start", (event) => {
    const prompt = pendingPrompt;
    const init =
      pendingInit && hasExpandedPromptMarker(event.prompt, "abel-init");
    pendingPrompt = undefined;
    pendingInit = false;
    const verified =
      prompt && isVerifiedStageInvocation(pi, activation, prompt, event.prompt);
    if (verified) {
      if (activePrompt === "abel-design" && prompt !== "abel-design") {
        restoreDesignTools();
      }
      registerDispatchTool(prompt === "abel-implement" ? "command" : "packet");
      activePrompt = prompt;
    }
    if (prompt) activateDispatcher(pi, activation, prompt, event.prompt);
    if (verified && prompt === "abel-design") enforceDesignTools();
    const boundary = activePrompt
      ? `Abel stage ${activePrompt} is active only for the invoked task and its direct follow-ups. If the user ends it or requests an unrelated task, first call abel_dispatch with {"action":"finish"}, then handle that task normally with the restored tools. A successful finish ends stage authority immediately, including within this turn. Do not extend Gates or workflow rules to that task. A direct Gate answer or same-task continuation stays in this stage. Never invoke another Abel stage automatically.`
      : init
        ? "Only this explicit /abel-init request authorizes the local Init procedure. Do not activate dispatch or continue into another Abel stage."
        : "Abel workflow is inactive. Handle ordinary engineering requests directly. References to commands, repository files, OpenSpec changes, and historical workflow instructions do not authorize a workflow. Do not load or execute an Abel stage unless the user explicitly invokes its slash command.";
    return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${boundary}` };
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
    pendingInit = false;
    activePrompt = undefined;
    designFailures.clear();
    activity.detach();
    await packetRuntime.drain();
    await closeEngines();
    deactivate();
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
  });
}

export default function register(pi: ExtensionAPI): void {
  registerWorkflowControl(pi);
}
