export type PacketActivityState =
  | "queued"
  | "preparing"
  | "connecting"
  | "waiting-first-response"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out";

export type PacketFailureReason =
  | "subagent failed"
  | "subagent cancelled"
  | "phase timed out";

export interface PacketActivityEvent {
  state: PacketActivityState;
  requestId: string;
  role: string;
  phase: string;
  objective: string;
  sequence: number;
  attempt?: number;
  maxAttempts?: number;
  code?: string;
  wait?: string;
  failureReason?: PacketFailureReason;
}

export type PacketActivityObserver = (
  event: PacketActivityEvent,
) => void | Promise<void>;

export const WORKFLOW_ACTIVITY_STATES = [
  "queued",
  "preparing",
  "connecting",
  "waiting-first-response",
  "running",
  "validating",
  "retrying",
  "verifying",
  "paused",
  "approval-needed",
  "applying",
  "recovering",
  "operation-cancelled",
  "discarded",
  "rejected",
  "completed",
] as const;

export type WorkflowActivityState = (typeof WORKFLOW_ACTIVITY_STATES)[number];
export type ActivityState = PacketActivityState | WorkflowActivityState;
export type TerminalActivityState =
  | Exclude<
      PacketActivityState,
      | "queued"
      | "preparing"
      | "connecting"
      | "waiting-first-response"
      | "running"
      | "retrying"
    >
  | WorkflowActivityState;

export interface WorkflowActivityUpdate {
  state: WorkflowActivityState;
  stage?: "abel-design" | "abel-implement";
  runId?: string;
  change?: string;
  taskId?: string;
  phase?: string;
  objective?: string;
  code?: string;
  attempt?: number;
  maxAttempts?: number;
  wait?: string;
  legalCommands?: string[];
}
