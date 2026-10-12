/** Plain workflow context, not executable approvals or certified evidence. */
export const TASK_SCHEMA = "cadence-workflow-assistant/1";
export const MAX_RECORD_BYTES = 128 * 1024;
export type TaskKind = "code" | "research" | "diagnosis";
export type TaskPhase =
  | "planning"
  | "running"
  | "review"
  | "interrupted"
  | "failed"
  | "done";
export interface CheckDefinition {
  name: string;
  command: string;
  timeoutMs: number;
}
export interface CheckRecord extends CheckDefinition {
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  status: "passed" | "failed" | "canceled" | "stale";
  fingerprint: string;
  log?: string;
}
export interface TaskRecord {
  schema: typeof TASK_SCHEMA;
  id: string;
  revision: number;
  kind: TaskKind;
  goal: string;
  plan: string;
  cwd: string;
  phase: TaskPhase;
  result: string;
  baseline: string;
  checks: CheckRecord[];
  review?: {
    fingerprint: string;
    outcome: "reviewed" | "reviewed-with-issues";
  };
  activity: { at: string; text: string }[];
}
export interface ChangeView {
  fingerprint: string;
  text: string;
  complete: boolean;
  git: boolean;
}
export interface RunResult {
  outcome: "completed" | "failed" | "canceled" | "timeout" | "unknown";
  closed: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  text: string;
  output: string;
  truncated: boolean;
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function boundedString(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) <= max &&
    !value.includes("\0")
  );
}
export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}
export function decodeCheck(value: unknown): CheckDefinition {
  if (
    !object(value) ||
    !boundedString(value.name, 128) ||
    !value.name.trim() ||
    !boundedString(value.command, 4096) ||
    !value.command.trim() ||
    !Number.isInteger(value.timeoutMs) ||
    Number(value.timeoutMs) < 100 ||
    Number(value.timeoutMs) > 1_200_000
  )
    throw new Error("Invalid check definition");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject invisible terminal controls in executable confirmations
  const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
  if (
    controls.test(value.command) ||
    controls.test(value.name) ||
    /[\n\t]/u.test(value.name)
  )
    throw new Error(
      "Check commands/names must be visibly representable in the terminal",
    );
  return {
    name: value.name,
    command: value.command,
    timeoutMs: Number(value.timeoutMs),
  };
}
export function decodeTask(value: unknown): TaskRecord {
  if (
    !object(value) ||
    value.schema !== TASK_SCHEMA ||
    typeof value.id !== "string" ||
    !validId(value.id) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.kind !== "string" ||
    !["code", "research", "diagnosis"].includes(value.kind) ||
    typeof value.phase !== "string" ||
    ![
      "planning",
      "running",
      "review",
      "interrupted",
      "failed",
      "done",
    ].includes(value.phase) ||
    !boundedString(value.goal, 8192) ||
    !value.goal.trim() ||
    !boundedString(value.plan, 32768) ||
    !boundedString(value.cwd, 4096) ||
    !boundedString(value.result, 16384) ||
    !boundedString(value.baseline, 16384) ||
    !Array.isArray(value.checks) ||
    value.checks.length > 32 ||
    !Array.isArray(value.activity) ||
    value.activity.length > 64
  )
    throw new Error("Unknown or corrupt task record");
  for (const check of value.checks) {
    decodeCheck(check);
    if (
      !object(check) ||
      !boundedString(check.cwd, 4096) ||
      !(check.exitCode === null || Number.isInteger(check.exitCode)) ||
      typeof check.durationMs !== "number" ||
      !Number.isFinite(check.durationMs) ||
      check.durationMs < 0 ||
      typeof check.status !== "string" ||
      !["passed", "failed", "canceled", "stale"].includes(check.status) ||
      !boundedString(check.fingerprint, 128) ||
      (check.log !== undefined &&
        (typeof check.log !== "string" || !/^[a-f0-9-]+\.log$/.test(check.log)))
    )
      throw new Error("Corrupt check record");
  }
  for (const entry of value.activity) {
    if (
      !object(entry) ||
      !boundedString(entry.at, 64) ||
      !boundedString(entry.text, 512)
    )
      throw new Error("Corrupt activity");
  }
  if (
    value.review !== undefined &&
    (!object(value.review) ||
      !boundedString(value.review.fingerprint, 128) ||
      typeof value.review.outcome !== "string" ||
      !["reviewed", "reviewed-with-issues"].includes(value.review.outcome))
  )
    throw new Error("Corrupt review");
  const allowed = new Set([
    "schema",
    "id",
    "revision",
    "kind",
    "goal",
    "plan",
    "cwd",
    "phase",
    "result",
    "baseline",
    "checks",
    "review",
    "activity",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error("Unknown task fields");
  return structuredClone(value) as unknown as TaskRecord;
}
