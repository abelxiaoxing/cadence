import type { ChangeContract } from "./change-contract.ts";
import type {
  AgentsImpact,
  ImplementGraphOutput,
  ImplementTaskBoundary,
  PhaseBoundary,
  StructuredVerificationContract,
} from "./contracts.ts";

/** Complete execution contracts. No authoring references or defaults cross this boundary. */
export interface PlanTaskDraft extends Omit<ImplementTaskBoundary, "phases"> {
  phases: {
    red: PhaseBoundary;
    green: PhaseBoundary;
    refactor?: PhaseBoundary;
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

export interface ImplementPlan {
  changeContract?: ChangeContract;
  changeId: string;
  tasks: PlanTaskDraft[];
  outputs: ImplementGraphOutput[];
  verification: PlanVerification;
  tracking: PlanTracking;
}
