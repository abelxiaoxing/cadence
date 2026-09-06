import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isValidRelativePath } from "./contracts.ts";
import {
  assessDeliveryTraceability,
  compileImplementPlan,
  DeliveryValidationError,
  type GateApprovalProof,
  parseGateAReceipt,
  parseImplementPlan,
  parseReadyReceipt,
} from "./delivery-compiler.ts";
import { canonicalJson, hashCanonicalValue } from "./implement-graph.ts";
import {
  inspectOpenSpecDelivery,
  type OpenSpecCliOptions,
  type OpenSpecDeliveryInspection,
} from "./openspec-cli.ts";
import { observeSafePath } from "./safe-path.ts";
import type {
  WorkflowAvailableDelivery,
  WorkflowDeliverySource,
} from "./workflow-engine.ts";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface PackageDeliverySourceOptions {
  inspectOpenSpec?: (
    consumerRoot: string,
    change: string,
    options?: OpenSpecCliOptions,
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
        const receipt = parseReadyReceipt(receiptBytes, {
          allowLegacyOrder: true,
        });
        if (receipt.change !== input.change) return undefined;
        const gateABytes = readPackageDeliveryFile(
          consumerRoot,
          `${changeRoot}/${receipt.approvals.gateA.path}`,
          4 * 1024 * 1024,
        );
        if (sha256(gateABytes) !== receipt.approvals.gateA.rawSha256) {
          return undefined;
        }
        const gateA = parseGateAReceipt(gateABytes, { allowLegacyOrder: true });
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
        receipt = parseReadyReceipt(receiptBytes, { allowLegacyOrder: true });
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
        inspection = await inspect(consumerRoot, input.change, {
          signal: input.signal,
        });
      } catch {
        diagnostics.add("delivery-openspec-unavailable");
      }
      input.signal?.throwIfAborted();
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
        gateA = parseGateAReceipt(gateABytes, { allowLegacyOrder: true });
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
        plan = parseImplementPlan(planBytes, { allowLegacyOrder: true });
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

const PACKAGE_DELIVERY_MAX_BYTES = 16 * 1024 * 1024;
