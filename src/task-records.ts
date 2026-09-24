/** Portable context only. No approval, session locator, or execution capability. */
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "./canonical.ts";

export const TASK_LIMITS = Object.freeze({
  recordBytes: 64 * 1024,
  artifactBytes: 16 * 1024 * 1024,
  artifacts: 64,
  discovery: 256,
  narrativeBytes: 4096,
});
export const TASK_FAILURE_CODES = [
  "task-record-invalid",
  "task-path-unsafe",
  "task-storage-invalid",
  "task-ownership-unresolved",
  "task-conflict",
  "task-not-found",
  "task-review-stale",
  "task-io-failed",
] as const;
export class TaskFoundationError extends Error {
  readonly code: (typeof TASK_FAILURE_CODES)[number];
  constructor(code: (typeof TASK_FAILURE_CODES)[number]) {
    super(code);
    this.code = code;
  }
}
export function taskFail(code: (typeof TASK_FAILURE_CODES)[number]): never {
  throw new TaskFoundationError(code);
}
/** Preserve bounded domain diagnostics; never expose a filesystem/SQLite parser message. */
export function taskError(
  error: unknown,
  fallback: (typeof TASK_FAILURE_CODES)[number],
): never {
  if (error instanceof TaskFoundationError) throw error;
  return taskFail(fallback);
}
export function taskHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function taskId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      value,
    )
  )
    taskFail("task-record-invalid");
  return value;
}
export function taskDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    taskFail("task-record-invalid");
  return value;
}
export function closedTaskObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    taskFail("task-record-invalid");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    taskFail("task-record-invalid");
  return record;
}
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > maximum ||
    /[\p{Cc}\p{Cf}]/u.test(value) ||
    value.trim().length === 0
  )
    taskFail("task-record-invalid");
  return value;
}
function choice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value))
    taskFail("task-record-invalid");
  return value;
}
export function taskInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  )
    taskFail("task-record-invalid");
  return value;
}
export const TASK_ROLES = [
  "brief",
  "requirements",
  "design",
  "plan",
  "decisions",
  "research",
  "result",
] as const;
export type TaskArtifact = {
  path: string;
  role: (typeof TASK_ROLES)[number];
  sha256: string;
  bytes: number;
};
export type TaskNarrative = {
  statement: string;
  source: {
    kind: "user-summary" | "model-summary" | "evidence-summary";
    reference: string;
  };
};
export type PortableTask = {
  formatVersion: 1;
  id: string;
  title: string;
  kind: "code" | "research" | "diagnosis";
  depth: "compact" | "expanded";
  lifecycle:
    | "planning"
    | "review-ready"
    | "approved"
    | "active"
    | "paused"
    | "blocked"
    | "completion-pending"
    | "archived";
  revision: number;
  artifacts: TaskArtifact[];
  latestSummary: TaskNarrative[];
};
function portableMarkdownName(name: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]{0,79}\.md$/u.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\.md$/u.test(name)
  );
}
export function taskArtifactPath(value: unknown): string {
  const p = text(value, 256);
  if (
    !/^(?:brief|prd|design|implement|decisions|result)\.md$/u.test(p) &&
    !(p.startsWith("research/") && portableMarkdownName(p.slice(9)))
  )
    taskFail("task-path-unsafe");
  return p;
}
export function decodeTaskArtifact(value: unknown): TaskArtifact {
  const r = closedTaskObject(value, ["path", "role", "sha256", "bytes"]);
  const p = taskArtifactPath(r.path);
  const role = choice(r.role, TASK_ROLES);
  const roles: Record<string, string> = {
    "brief.md": "brief",
    "prd.md": "requirements",
    "design.md": "design",
    "implement.md": "plan",
    "decisions.md": "decisions",
    "result.md": "result",
  };
  if ((roles[p] ?? "research") !== role) taskFail("task-record-invalid");
  if (r.bytes !== 0) taskInteger(r.bytes, TASK_LIMITS.artifactBytes);
  return {
    path: p,
    role,
    sha256: taskDigest(r.sha256),
    bytes: Number(r.bytes),
  };
}
export function decodePortableTask(value: unknown): PortableTask {
  const r = closedTaskObject(value, [
    "formatVersion",
    "id",
    "title",
    "kind",
    "depth",
    "lifecycle",
    "revision",
    "artifacts",
    "latestSummary",
  ]);
  if (
    r.formatVersion !== 1 ||
    !Array.isArray(r.artifacts) ||
    r.artifacts.length > TASK_LIMITS.artifacts ||
    !Array.isArray(r.latestSummary) ||
    r.latestSummary.length > 16
  )
    taskFail("task-record-invalid");
  const artifacts = r.artifacts.map(decodeTaskArtifact);
  if (new Set(artifacts.map((a) => a.path)).size !== artifacts.length)
    taskFail("task-record-invalid");
  const latestSummary = r.latestSummary.map((value) => {
    const n = closedTaskObject(value, ["statement", "source"]);
    const s = closedTaskObject(n.source, ["kind", "reference"]);
    const reference = text(s.reference, 128);
    // Portable source IDs, not URLs, machine paths, or session locators.
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(reference))
      taskFail("task-record-invalid");
    return {
      statement: text(n.statement, TASK_LIMITS.narrativeBytes),
      source: {
        kind: choice(s.kind, [
          "user-summary",
          "model-summary",
          "evidence-summary",
        ] as const),
        reference,
      },
    };
  });
  const task: PortableTask = {
    formatVersion: 1,
    id: taskId(r.id),
    title: text(r.title, 256),
    kind: choice(r.kind, ["code", "research", "diagnosis"] as const),
    depth: choice(r.depth, ["compact", "expanded"] as const),
    lifecycle: choice(r.lifecycle, [
      "planning",
      "review-ready",
      "approved",
      "active",
      "paused",
      "blocked",
      "completion-pending",
      "archived",
    ] as const),
    revision: taskInteger(r.revision),
    artifacts,
    latestSummary,
  };
  if (Buffer.byteLength(canonicalJson(task)) > TASK_LIMITS.recordBytes)
    taskFail("task-record-invalid");
  return task;
}
export function parsePortableTask(bytes: Uint8Array): PortableTask {
  if (bytes.byteLength > TASK_LIMITS.recordBytes)
    taskFail("task-record-invalid");
  try {
    return decodePortableTask(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return taskFail("task-record-invalid");
  }
}
export function newPortableTask(
  title: string,
  kind: PortableTask["kind"],
  depth: PortableTask["depth"],
): PortableTask {
  return decodePortableTask({
    formatVersion: 1,
    id: randomUUID(),
    title,
    kind,
    depth,
    lifecycle: "planning",
    revision: 1,
    artifacts: [],
    latestSummary: [],
  });
}
export function taskPublicationPath(id: string, value: unknown): string {
  taskId(id);
  if (typeof value !== "string") taskFail("task-path-unsafe");
  const prefix = `.cadence/tasks/${id}/`;
  if (value === `${prefix}task.json`) return value;
  if (value.startsWith(prefix)) {
    taskArtifactPath(value.slice(prefix.length));
    return value;
  }
  if (
    value.startsWith(".cadence/knowledge/") &&
    portableMarkdownName(value.slice(".cadence/knowledge/".length))
  )
    return value;
  return taskFail("task-path-unsafe");
}
