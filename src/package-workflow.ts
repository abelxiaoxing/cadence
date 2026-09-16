import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import path from "node:path";
import type { WorkflowActivityUpdate } from "./activity-contracts.ts";
import { loadAgentDefinitions } from "./agent-registry.ts";
import type {
  DesignEvidenceResult,
  StructuredVerificationContract,
} from "./contracts.ts";
import { validateControlCommand } from "./control-contracts.ts";
import { DesignController } from "./design-control.ts";
import { executionProfile } from "./execution-profile.ts";
import type { PackageContext } from "./model-source.ts";
import { inspectOpenSpecDelivery } from "./openspec-cli.ts";
import { proposePackageCandidate } from "./package-candidate.ts";
import { packageDeliverySource } from "./package-delivery.ts";
import { acquirePackageState } from "./package-state.ts";
import {
  changeVerificationResult,
  executePackageVerification,
  phaseVerificationResult,
} from "./package-verification.ts";
import {
  inspectRoutePolicy,
  loadRoutePolicy,
  type RoutePolicyResolution,
  unavailableRoutePolicy,
} from "./route-policy.ts";
import { resolveStateRoot } from "./state-root.ts";
import { VerificationFeedback } from "./verification-diagnostics.ts";
import { captureVerificationEnvironmentIdentity } from "./verification-environment.ts";
import { coalesceVerificationScans } from "./verification-scan.ts";
import { openDurableWorkflowEngine } from "./workflow-engine.ts";
export interface PackageWorkflowService {
  execute(
    command: unknown,
    context?: PackageContext,
    signal?: AbortSignal,
    onActivity?: (event: WorkflowActivityUpdate) => void,
  ): Promise<Record<string, unknown>>;
  executeDesign(request: unknown): Promise<Record<string, unknown>>;
  executeAmendment(
    change: string,
    batchId: string,
    request: unknown,
  ): Promise<Record<string, unknown>>;
  assertDesignRun(runId: string): void;
  recordDesignEvidence(input: {
    runId: string;
    evidence: DesignEvidenceResult;
  }): unknown;
  close(): void | Promise<void>;
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

export function openPackageWorkflowService(
  initialContext: PackageContext,
): PackageWorkflowService {
  const state = acquirePackageState(
    resolveStateRoot({
      consumerRoot: path.resolve(initialContext.cwd),
      xdgStateHome: process.env.XDG_STATE_HOME,
    }),
  );
  try {
    const service = openPreparedPackageWorkflowService(initialContext);
    const notice = (result: Record<string, unknown>) =>
      state.notice ? { ...result, packageStateReset: state.notice } : result;
    return {
      ...service,
      async execute(...args) {
        return notice(await service.execute(...args));
      },
      async executeDesign(...args) {
        return notice(await service.executeDesign(...args));
      },
      async executeAmendment(...args) {
        return notice(await service.executeAmendment(...args));
      },
      async close() {
        // Never release ownership while an executor or storage connection may survive.
        await service.close();
        state.close();
      },
    };
  } catch (error) {
    state.close();
    throw error;
  }
}

function openPreparedPackageWorkflowService(
  initialContext: PackageContext,
): PackageWorkflowService {
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
  const contexts = new AsyncLocalStorage<PackageContext>();
  const feedback = new AsyncLocalStorage<VerificationFeedback>();
  const verify: typeof executePackageVerification = async (input) => {
    const result = await executePackageVerification(input);
    feedback.getStore()?.observe(result);
    return result;
  };
  const design = DesignController.open({
    consumerRoot,
    stateRoot,
    inspectOpenSpec: inspectOpenSpecDelivery,
  });
  try {
    const implementationAgent = loadAgentDefinitions().find(
      (agent) => agent.role === "implementation-worker",
    );
    if (!implementationAgent) {
      throw new Error("implementation-worker-agent-unavailable");
    }
    const hostLimit = (name: string, fallback: number): number => {
      const value =
        process.env[name] === undefined ? fallback : Number(process.env[name]);
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("verification-host-limit-invalid");
      return value;
    };
    const maxReportBytes = hostLimit(
      "ABEL_VERIFICATION_MAX_REPORT_BYTES",
      64 * 1024 * 1024,
    );
    const workHardLimit = hostLimit("ABEL_WORK_MAX_UNITS", 512);
    const engine = openDurableWorkflowEngine({
      workHardLimit,
      awaitPostApplySettlement: true,
      verificationPolicy: `report-file-v5:${JSON.stringify(executionProfile())}`,
      verificationEnvironment: coalesceVerificationScans(
        (plan: import("./implement-plan.ts").ImplementPlan, signal) =>
          captureVerificationEnvironmentIdentity(
            consumerRoot,
            [
              ...plan.tasks.flatMap((task) => [
                ...Object.values(task.phases).map(
                  (phase) => phase.verification,
                ),
                task.affectedVerification,
                ...(task.baselineVerification
                  ? [task.baselineVerification]
                  : []),
                task.repairVerification,
              ]),
              plan.verification.baseline.fullSuite,
              plan.verification.change.fullSuite,
              plan.verification.change.postApply,
              ...(plan.verification.agentsCheckpoint.verification
                ? [plan.verification.agentsCheckpoint.verification]
                : []),
            ],
            signal,
          ),
      ),
      consumerRoot,
      stateRoot,
      deliverySource: packageDeliverySource(consumerRoot, {
        verifyGateProof: (input) => design.verifyGateProof(input),
        verifyFinalizedDelivery: (input) =>
          design.verifyFinalizedDelivery(input),
      }),
      routePolicy: routeResolution.ok
        ? routeResolution.policy
        : unavailableRoutePolicy(),
      proposeCandidate: (input) =>
        proposePackageCandidate(
          input,
          contexts.getStore(),
          implementationAgent,
          feedback.getStore()?.current(),
        ),
      verifyPhase: async (input) =>
        phaseVerificationResult(
          await verify({
            maxReportBytes,
            executionWritePaths: input.executionWritePaths,
            root: input.root,
            dependencyOwner: consumerRoot,
            executionOwnerRoot: stateRoot.rootDir,
            verification: input.verification,
            signal: input.signal,
          }),
        ),
      verifyChange: async (input) => {
        const verifications = input.verification
          ? [input.verification]
          : input.plan.tasks.map((task) => affectedVerification(task));
        let failure: ReturnType<typeof changeVerificationResult> | undefined;
        for (const verification of verifications) {
          const result = await verify({
            maxReportBytes,
            executionWritePaths: input.plan.tasks.flatMap((task) =>
              Object.values(task.phases).flatMap((phase) => [
                ...phase.write,
                ...phase.delete,
              ]),
            ),
            root: input.root,
            dependencyOwner: consumerRoot,
            executionOwnerRoot: stateRoot.rootDir,
            verification,
            signal: input.signal,
          });
          const observed = changeVerificationResult(result);
          if (!observed.ok) {
            if (observed.kind !== "verification") return observed;
            if (failure && !failure.ok && failure.kind === "verification") {
              failure.failureIdentities = [
                ...new Set([
                  ...(failure.failureIdentities ?? []),
                  ...(observed.failureIdentities ?? []),
                ]),
              ];
              failure.attributionReliable =
                failure.attributionReliable !== false &&
                observed.attributionReliable !== false;
            } else failure = observed;
          }
        }
        if (failure) return failure;
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
        return feedback.run(new VerificationFeedback(), () =>
          contexts.run(context, async () => {
            const outcome = await engine.execute(
              validation.value,
              signal,
              onActivity,
            );
            const routePolicy = visibleRoutePolicyStatus(
              operationRouteResolution,
              engine.routePolicyStatus(),
            );
            return {
              ...outcome,
              routePolicy,
              verificationDiagnostics: feedback.getStore()?.current() ?? [],
            };
          }),
        );
      },
      executeDesign(request: unknown) {
        return design.execute(request);
      },
      executeAmendment(change: string, batchId: string, request: unknown) {
        return engine.amend(change, batchId, request, (assertAuthority) =>
          design.executeWithAuthority(request, assertAuthority),
        );
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
        feedback.disable();
        design.close();
      },
    };
  } catch (error) {
    design.close();
    throw error;
  }
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
