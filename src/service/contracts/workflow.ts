/** Conversation workflow DTOs. Plans are data; only fresh user confirmation admits execution. */
import {
  bool,
  ContractError,
  canonicalJson,
  closed,
  decodeHash,
  decodeId,
  integer,
  list,
  nullable,
  oneOf,
  text,
  utf8Bytes,
} from "./core.ts";
import {
  type ChoiceVersion,
  decodeChoiceVersion,
  decodeExecutionContext,
  type ExecutionContext,
} from "./models.ts";

export const WORKFLOW_LIMITS = {
  tasks: 16,
  /** Assignments one run may list in all, counting those its revisions added
   * and those they superseded. */
  route: 48,
  /** Questions one research run may carry. How many run at once is the
   * owner's execution limit (`parallelLimit`), not a property of the plan;
   * the tool schema states no count, so only this bound refuses one. */
  questions: 32,
  checks: 16,
  bytes: 256 * 1024,
  /** Goal, route, decisions, assumptions and acceptance together: every
   * worker of the delivery is given them, inside its 32KiB context. */
  context: 32768,
  /** Why a worker should read something first. */
  reason: 1024,
  // Read budgets, never a lifetime cap on retained runs.
  historyScanEntries: 200,
  historyPage: 20,
  historyScans: 16,
  historyIdleMs: 120000,
} as const;
export interface WorkflowCheck {
  name: string;
  command: string;
  timeoutMs?: number;
}
/** Something a worker should read before it starts: a project document (and
 * optionally one section of it) or a recorded investigation, with the reason. */
export type WorkflowReading =
  | { path: string; section?: string; reason: string }
  | { research: string; reason: string };
export interface WorkflowTask {
  id: string;
  title: string;
  instructions: string;
  writes: string[];
  after: string[];
  /** Version 3: what this assignment reads first. */
  reads?: WorkflowReading[];
}
/** Version 3: what the owner may do on its own after approval, beyond revising
 * the route, the assignments and their write scope. */
export interface WorkflowPolicy {
  /** Whether a revision may add dependency-installation setup commands. */
  installs: boolean;
}
export interface WorkflowPlan {
  /** Version 3 admits self-revising delivery. Version 2 (adaptive delivery in a
   * fixed write scope) and unversioned plans are retained and readonly. */
  version?: 2 | 3;
  /** Version 2 only: approved documentation write paths. */
  knowledge?: string[];
  /** Version 3: what the coordinator decided on the user's behalf; approval
   * confirms these with the goal, decisions and acceptance. */
  assumptions?: string;
  /** Version 3: existing project documents this delivery may update. */
  documents?: string[];
  /** Version 3: what the independent review reads first. */
  reviewReads?: WorkflowReading[];
  policy?: WorkflowPolicy;
  goal: string;
  design: string;
  decisions: string;
  acceptance: string;
  /** Retained v1 data only, never used to synthesize new project knowledge. */
  projectContext?: string;
  tasks: WorkflowTask[];
  checks: WorkflowCheck[];
  setup: WorkflowCheck[];
  baselineChecks: WorkflowCheck[];
  /** Retained v1 evidence only. New plans have no repair quota. */
  repairAttempts?: number;
  delivery: "local-merge" | "working-copy";
}
/** Owner-selected Git placement, not a model's permission to pick refs. */
export interface DeliveryTarget {
  checkoutRoot: string;
  repository: string;
  repositoryIdentity: string;
  branch: string;
  head: string;
}
export interface DeliveryBinding {
  policy: "task-branch-v1";
  target: DeliveryTarget;
}
export interface AcceptanceRecord {
  candidate: string;
  tree: string;
  planDigest: string;
  contextDigest: string;
  checks: string[];
  review: string;
  /** Among `checks`, those a recorded deviation set aside; they failed. */
  waived?: string[];
}
/** The worktree of one assignment that ran beside others: created from the
 * candidate's commit, committed by the owner and picked onto the candidate. */
export interface DeliveryArtifact {
  /** The assignment it belongs to. */
  id: string;
  path: string;
  /** The candidate commit it was created from. */
  base: string;
  /** Its last commit recorded by the owner. */
  head: string;
  /** The candidate commit its work became, once integrated. */
  applied: string | null;
  state: "preparing" | "ready" | "removed" | "retained";
}
export interface DeliveryObservation {
  binding: DeliveryBinding;
  taskBranch: string;
  worktreeRoot: string;
  /** Child worktrees of assignments that ran side by side, in creation order. */
  artifacts?: DeliveryArtifact[];
  preparation: "pending" | "ready" | "unknown";
  workspace: {
    head: string;
    state: "preparing" | "ready" | "removed" | "retained";
  } | null;
  candidate: string | null;
  acceptance: AcceptanceRecord | null;
  integration: {
    status: "pending" | "blocked" | "applying" | "applied" | "unknown";
    before: string;
    after: string | null;
    reason: string;
  };
  postChecks: "not-run" | "passed" | "failed" | "unknown";
  cleanup: { status: "pending" | "removed" | "retained"; reason: string };
}
export interface WorkflowProposal {
  delivery?: DeliveryBinding;
  id: string;
  epoch: string;
  digest: string;
  observation: string;
  model: ChoiceVersion;
  plan: WorkflowPlan;
  cwd: string;
  checkoutRoot?: string;
  display?: {
    model: string;
    branch: string;
    baseCommit: string;
    runtime?: string;
  };
}
export interface WorkflowTiming {
  createdAt: number;
  preparedAt: number | null;
  startedAt: number | null;
  stopRequestedAt: number | null;
  closedAt: number | null;
  settledAt: number | null;
  timeoutMs?: number;
  stopReason: string | null;
}
export interface WorkflowDiagnostics {
  acceptedAt: number;
  acquiredAt: number | null;
  settledAt: number | null;
  owner: {
    version: string;
    build: string;
    entry: string;
    pid: number;
    node: string;
    platform: string;
    startedAt: number;
  };
}
export interface WorkflowStep {
  timing?: WorkflowTiming;
  runtime?: { sdkVersion: string; workerHash: string };
  id: string;
  childRunId?: string;
  kind:
    | "research"
    | "implementation"
    | "diagnosis"
    | "knowledge"
    | "review"
    | "check"
    | "git";
  status:
    | "running"
    | "completed"
    | "rejected"
    | "failed"
    | "canceled"
    | "timeout"
    | "unknown";
  text: string;
  exitCode: number | null;
  truncated: boolean;
}
/** An acceptance item or decision the delivery could not meet as written, and
 * what it delivered instead. The independent review confirms each one. */
export interface WorkflowDeviation {
  revision: number;
  item: string;
  reason: string;
  delivered: string;
  /** Declared acceptance checks set aside because of it. */
  waives: string[];
}
/** Deviations one run may record. */
export const WORKFLOW_DEVIATIONS = 16;
export const WORKFLOW_TASK_STATES = [
  "queued",
  "running",
  "completed",
  "failed",
  "superseded",
] as const;
/** Where one assignment of the current route stands. `completed` means its
 * work is in the candidate; `superseded` means a plan revision dropped it
 * before it started. */
export interface WorkflowTaskState {
  id: string;
  title: string;
  after: string[];
  state: (typeof WORKFLOW_TASK_STATES)[number];
  /** The plan revision that last changed this assignment (added, rewrote or
   * superseded it); absent for one that stands as the agreement wrote it. */
  revision?: number;
}
export interface WorkflowRun {
  /** New runs retain older step pages separately; this is a view offset, not eviction. */
  stepsBefore?: number;
  revision?: number;
  /** Repository paths that revisions brought into the write scope after approval. */
  scope?: string[];
  /** Where this delivery departs from the agreement, in recorded order. */
  deviations?: WorkflowDeviation[];
  /** The current route: the agreement's assignments as revisions left them,
   * and where each stands. */
  tasks?: WorkflowTaskState[];
  verification?: { id: string; source: string; steps: string[] };
  delivery?: DeliveryObservation;
  execution?: ExecutionContext;
  diagnostics?: WorkflowDiagnostics;
  id: string;
  epoch: string;
  goal: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "timeout"
    | "unknown";
  phase:
    | "research"
    | "implementing"
    | "verifying"
    | "reviewing"
    | "recovering"
    | "learning"
    | "integrating"
    | "finished";
  steps: WorkflowStep[];
  notice: string;
  mergedCommit: string | null;
  humanReviewed: false;
}
export type WorkflowRequest =
  | {
      action: "research";
      goal: string;
      questions: string[];
      roots?: string[];
      model: ChoiceVersion;
    }
  | { action: "propose"; plan: WorkflowPlan; model: ChoiceVersion }
  | { action: "prepare"; proposalId: string; digest: string }
  | { action: "execute"; proposalId: string; digest: string; grant: string }
  | { action: "cancel"; runId: string };
export type WorkflowResponse =
  | { type: "proposal"; proposal: WorkflowProposal }
  | {
      type: "grant";
      proposal: WorkflowProposal;
      grant: string;
      expiresAt: number;
    }
  | { type: "run"; run: WorkflowRun };

/** A plan or an investigation request that its author can correct: the message
 * names the field, what it holds and what is accepted there. */
export class WorkflowInputError extends Error {}
function issue(path: string, problem: string): never {
  throw new WorkflowInputError(`${path}: ${problem}`);
}
const quoted = (value: string) => JSON.stringify(clipUnits(value, 80));
/** Reads one field; whatever refuses it is reported under the field's name. */
function at<T>(path: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof WorkflowInputError) throw error;
    return issue(
      path,
      error instanceof ContractError
        ? error.code === "oversize"
          ? "is too long"
          : "is not valid"
        : error instanceof Error
          ? error.message
          : "is not valid",
    );
  }
}
function words(
  path: string,
  v: unknown,
  maximum: number,
  nonempty = false,
): string {
  if (v === undefined) return issue(path, "is missing");
  if (typeof v !== "string") return issue(path, "must be text");
  if (nonempty && !v.trim()) return issue(path, "must not be empty");
  const bytes = utf8Bytes(v);
  if (bytes > maximum)
    return issue(path, `is ${bytes} bytes; at most ${maximum}`);
  return at(path, () => text(v, maximum, nonempty));
}
function entries<T>(
  path: string,
  v: unknown,
  maximum: number,
  read: (entry: unknown, path: string) => T,
): T[] {
  if (v === undefined) return issue(path, "is missing");
  if (!Array.isArray(v)) return issue(path, "must be a list");
  if (v.length > maximum)
    return issue(path, `has ${v.length} entries; at most ${maximum}`);
  return at(path, () => list(v, maximum, (entry) => entry)).map((entry, i) =>
    read(entry, `${path}[${i}]`),
  );
}
/** A closed object: every required field present, nothing unknown. */
function fields(
  path: string,
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (v === undefined) return issue(path, "is missing");
  if (v === null || typeof v !== "object" || Array.isArray(v))
    return issue(path, "must be an object");
  const names = Object.keys(v);
  const known = [...required, ...optional];
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length)
    return issue(
      path,
      `has no field ${unknown.map(quoted).join(", ")}; its fields are ${known.join(", ")}`,
    );
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) return issue(path, `is missing ${missing.join(", ")}`);
  return at(path, () =>
    closed(
      v,
      known.filter((name) => names.includes(name)),
    ),
  );
}
const INVESTIGATION =
  /^(?:research-[0-9]{1,4}-)?([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
/** The record a reading names: a research step's `investigation` value, or the
 * step's own id (`research-<n>-<uuid>`), under whose uuid the same record is
 * kept. Null when the text is neither. */
export function investigationId(reference: string): string | null {
  return INVESTIGATION.exec(reference)?.[1] ?? null;
}
/** Clip by UTF-16 units without leaving a lone surrogate (unencodable on the wire). */
export function clipUnits(value: string, units: number): string {
  if (value.length <= units) return value;
  const last = value.charCodeAt(units - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? units - 1 : units);
}
/** A declared write path owns itself and, as a directory, everything below it. */
export function workflowCovers(
  scope: readonly string[],
  name: string,
): boolean {
  return scope.some((p) => name === p || name.startsWith(`${p}/`));
}
/** Read decoding accepts every path 2.0.21 accepted; `strict` (new plans only)
 * additionally refuses invisible format characters. */
export function workflowPath(v: unknown, strict = false): string {
  const p = text(v, 1024, true);
  if (
    p.startsWith("/") ||
    p.includes("\\") ||
    [...p].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === ":",
    ) ||
    // Bidi overrides/isolates/marks, zero-width and other format characters
    // make a displayed scope differ from the enforced one.
    (strict && /[\p{Cf}\p{Zl}\p{Zp}]/u.test(p)) ||
    p
      .split("/")
      .some(
        (s) => !s || s === "." || s === ".." || s.toLowerCase() === ".git",
      ) ||
    /(^|\/)\.env(?:\.|$)/iu.test(p)
  )
    throw new Error(
      "is not a plain path inside the repository (relative, forward slashes, no . or .. segment, no colon, not .git or .env)",
    );
  return p;
}
// Task IDs are worker assignment IDs and worktree names. New plans use the
// assignmentId bound (48); reads still accept retained 2.0.21 IDs (64).
const taskId = (v: unknown, strict = false) => {
  const s = text(v, 64, true);
  if (!/^[a-z][a-z0-9-]*$/u.test(s) || (strict && s.length > 48))
    throw new Error(
      "is not an assignment id (lowercase letters, digits and hyphens, starting with a letter, at most 48 characters)",
    );
  return s;
};
/** The identity a new assignment may take. */
export const workflowTaskId = (v: unknown) => taskId(v, true);
export function decodeWorkflowCheck(v: unknown, path = "check"): WorkflowCheck {
  const o = fields(path, v, ["name", "command"], ["timeoutMs"]);
  return {
    name: words(`${path}.name`, o.name, 128, true),
    command: words(`${path}.command`, o.command, 4096, true),
    ...(o.timeoutMs === undefined
      ? {}
      : {
          timeoutMs: at(`${path}.timeoutMs`, () => {
            try {
              return integer(o.timeoutMs, 100, 2_147_483_647);
            } catch {
              throw new Error(
                "is a whole number of milliseconds from 100 to 2147483647, or left out for no timeout",
              );
            }
          }),
        }),
  };
}
export function workflowOrder(tasks: WorkflowTask[]): WorkflowTask[] {
  const done = new Set<string>(),
    ordered: WorkflowTask[] = [];
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
    throw new Error("an assignment id is used twice");
  while (ordered.length < tasks.length) {
    const next = tasks.find(
      (t) => !done.has(t.id) && t.after.every((id) => done.has(id)),
    );
    if (!next)
      throw new Error(
        "the after lists name a missing assignment or form a cycle",
      );
    ordered.push(next);
    done.add(next.id);
  }
  return ordered;
}
export function workflowAncestors(
  tasks: WorkflowTask[],
  id: string,
): WorkflowTask[] {
  const needed = new Set<string>();
  const visit = (key: string) => {
    for (const dep of tasks.find((t) => t.id === key)?.after ?? []) {
      if (!needed.has(dep)) {
        needed.add(dep);
        visit(dep);
      }
    }
  };
  workflowOrder(tasks);
  visit(id);
  return workflowOrder(tasks).filter((t) => needed.has(t.id));
}
/** Retained plans decode with the rules they were accepted under; `strict` is
 * for validating a new plan before publication or execution. Every refusal
 * names the field (`WorkflowInputError`), so its author can correct that field
 * and publish the same plan again. */
export function decodeWorkflowPlan(
  v: unknown,
  options: { strict?: boolean } = {},
): WorkflowPlan {
  const strict = options.strict === true;
  const modern = Object.hasOwn(v ?? {}, "version");
  if (strict && !modern)
    throw new Error(
      "Publish a new delivery agreement; retained fixed-pipeline plans are readonly",
    );
  try {
    canonicalJson(v, WORKFLOW_LIMITS.bytes);
  } catch (error) {
    issue(
      "plan",
      error instanceof ContractError && error.code === "oversize"
        ? `is larger than ${WORKFLOW_LIMITS.bytes} bytes as a whole`
        : "is not plain JSON data",
    );
  }
  const version = modern ? (v as { version?: unknown }).version : undefined;
  if (modern && version !== 2 && version !== 3)
    throw new Error("Unsupported delivery agreement version");
  const current = version === 3;
  if (strict && !current)
    throw new Error(
      "Publish a new delivery agreement; earlier agreements are readonly",
    );
  const o = fields("plan", v, [
    "goal",
    "design",
    "decisions",
    "acceptance",
    ...(current
      ? ["version", "assumptions", "documents", "reviewReads", "policy"]
      : modern
        ? ["version", "knowledge"]
        : ["projectContext", "repairAttempts"]),
    "tasks",
    "checks",
    "setup",
    "baselineChecks",
    "delivery",
  ]);
  const documentation = (value: unknown, name: string) =>
    entries(name, value, 16, (entry, path) =>
      at(path, () => {
        const document = workflowPath(entry, strict);
        if (!document.endsWith(".md"))
          throw new Error("must be a Markdown file (.md)");
        return document;
      }),
    );
  const tasks = entries(
    "tasks",
    o.tasks,
    WORKFLOW_LIMITS.tasks,
    (value, path) => {
      const t = fields(path, value, [
        "id",
        "title",
        "instructions",
        "writes",
        "after",
        ...(current ? ["reads"] : []),
      ]);
      return {
        id: at(`${path}.id`, () => taskId(t.id, strict)),
        title: words(`${path}.title`, t.title, 256, true),
        instructions: words(`${path}.instructions`, t.instructions, 8192, true),
        writes: entries(`${path}.writes`, t.writes, 128, (p, entry) =>
          at(entry, () => workflowPath(p, strict)),
        ),
        after: entries(
          `${path}.after`,
          t.after,
          WORKFLOW_LIMITS.tasks,
          (id, entry) => at(entry, () => taskId(id, strict)),
        ),
        ...(current
          ? { reads: decodeWorkflowReadings(t.reads, strict, `${path}.reads`) }
          : {}),
      };
    },
  );
  if (!tasks.length) issue("tasks", "needs at least one assignment");
  const ids = tasks.map((t) => t.id);
  for (const [i, t] of tasks.entries()) {
    const path = `tasks[${i}]`;
    if (ids.indexOf(t.id) !== i)
      issue(
        `${path}.id`,
        `${quoted(t.id)} is already the id of tasks[${ids.indexOf(t.id)}]`,
      );
    if (!t.writes.length)
      issue(`${path}.writes`, "needs at least one path this assignment writes");
    if (new Set(t.writes).size !== t.writes.length)
      issue(`${path}.writes`, "lists a path twice");
    if (new Set(t.after).size !== t.after.length)
      issue(`${path}.after`, "lists an assignment twice");
    const unknown = t.after.find((id) => !ids.includes(id));
    if (unknown !== undefined)
      issue(
        `${path}.after`,
        `names ${quoted(unknown)}, which is not the id of an assignment in tasks`,
      );
  }
  at("tasks", () => workflowOrder(tasks));
  // Retained parallel plans keep their original validation. New delivery uses
  // a stable sequential candidate, so adjacent assignments may share files.
  for (const a of modern ? [] : tasks)
    for (const b of tasks) {
      if (
        a.id >= b.id ||
        workflowAncestors(tasks, a.id).some((t) => t.id === b.id) ||
        workflowAncestors(tasks, b.id).some((t) => t.id === a.id)
      )
        continue;
      if (
        a.writes.some((p) => workflowCovers(b.writes, p)) ||
        b.writes.some((q) => workflowCovers(a.writes, q))
      )
        throw new Error(
          "Independent tasks share write paths; assign an owner and dependency",
        );
    }
  const commands = (value: unknown, name: string, maximum: number) =>
    entries(name, value, maximum, decodeWorkflowCheck);
  const checks = commands(o.checks, "checks", WORKFLOW_LIMITS.checks);
  if (!checks.length)
    issue("checks", "needs at least one real verification command");
  const result: WorkflowPlan = {
    goal: words("goal", o.goal, 8192, true),
    design: words("design", o.design, 32768, true),
    decisions: words("decisions", o.decisions, 16384),
    acceptance: words("acceptance", o.acceptance, 16384, true),
    ...(current
      ? {
          version: 3 as const,
          assumptions: words("assumptions", o.assumptions, 16384),
          documents: documentation(o.documents, "documents"),
          reviewReads: decodeWorkflowReadings(
            o.reviewReads,
            strict,
            "reviewReads",
          ),
          policy: {
            installs: at("policy.installs", () => {
              try {
                return bool(fields("policy", o.policy, ["installs"]).installs);
              } catch (error) {
                if (error instanceof WorkflowInputError) throw error;
                throw new Error("must be true or false");
              }
            }),
          },
        }
      : modern
        ? {
            version: 2 as const,
            knowledge: documentation(o.knowledge, "knowledge"),
          }
        : {
            projectContext: words("projectContext", o.projectContext, 16384),
            repairAttempts: at("repairAttempts", () =>
              integer(o.repairAttempts, 0, 2),
            ),
          }),
    tasks,
    checks,
    setup: commands(o.setup, "setup", 4),
    baselineChecks: commands(
      o.baselineChecks,
      "baselineChecks",
      WORKFLOW_LIMITS.checks,
    ),
    delivery: at("delivery", () => {
      try {
        return oneOf(o.delivery, ["local-merge", "working-copy"]);
      } catch {
        throw new Error("is local-merge or working-copy");
      }
    }),
  };
  // Every worker of the delivery is given these five together.
  const agreement = utf8Bytes(agreementText(result));
  if (agreement > WORKFLOW_LIMITS.context)
    issue(
      "plan",
      `goal, design, decisions, assumptions and acceptance are ${agreement} bytes together (${(
        ["goal", "design", "decisions", "assumptions", "acceptance"] as const
      )
        .map((name) => `${name} ${utf8Bytes(result[name] ?? "")}`)
        .join(", ")}); together at most ${WORKFLOW_LIMITS.context}`,
    );
  const scope = utf8Bytes(workflowWrites(result).join(", "));
  if (scope > 16384)
    issue(
      "tasks",
      `the write paths of all assignments and documents are ${scope} bytes together; at most 16384`,
    );
  const readings = (list: WorkflowReading[] | undefined, name: string) =>
    (list ?? []).flatMap((r, i): [string, string][] => [
      [`${name}[${i}].reason`, r.reason],
      [`${name}[${i}].section`, "section" in r ? (r.section ?? "") : ""],
    ]);
  for (const [path, value] of [
    ["goal", result.goal],
    ["design", result.design],
    ["decisions", result.decisions],
    ["acceptance", result.acceptance],
    ["assumptions", result.assumptions ?? ""],
    ["projectContext", result.projectContext ?? ""],
    ...readings(result.reviewReads, "reviewReads"),
    ...result.tasks.flatMap((t, i): [string, string][] => [
      [`tasks[${i}].title`, t.title],
      [`tasks[${i}].instructions`, t.instructions],
      ...readings(t.reads, `tasks[${i}].reads`),
    ]),
    ...(["checks", "setup", "baselineChecks"] as const).flatMap((name) =>
      result[name].flatMap((c, i): [string, string][] => [
        [`${name}[${i}].name`, c.name],
        [`${name}[${i}].command`, c.command],
      ]),
    ),
  ] as [string, string][])
    if (
      [...value].some(
        (c) =>
          (c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t") ||
          c.charCodeAt(0) === 127 ||
          /[‪-‮⁦-⁩]/u.test(c),
      )
    )
      issue(
        path,
        "contains an invisible control character (only newline and tab are accepted)",
      );
  return result;
}
/** A plan as the coordinator gave it, made complete: a field that may be empty
 * takes its empty value when left out, and the agreement is the current
 * version. The result is decoded as a new agreement, so everything that cannot
 * be accepted, an unknown field included, is refused by name. */
export function workflowPlanInput(v: unknown): WorkflowPlan {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    return issue("plan", "must be an object");
  const completed = (
    source: object,
    defaults: Record<string, unknown>,
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...defaults };
    // A model sends null for a field it means to leave out.
    for (const [key, value] of Object.entries(source))
      if (value !== null && value !== undefined) result[key] = value;
    return result;
  };
  const plan = completed(v, {
    version: 3,
    decisions: "",
    assumptions: "",
    documents: [],
    reviewReads: [],
    policy: {},
    setup: [],
    baselineChecks: [],
  });
  if (plan.policy && typeof plan.policy === "object")
    plan.policy = completed(plan.policy, { installs: false });
  if (Array.isArray(plan.tasks))
    plan.tasks = plan.tasks.map((task: unknown) =>
      task && typeof task === "object" && !Array.isArray(task)
        ? completed(task, { after: [], reads: [] })
        : task,
    );
  return decodeWorkflowPlan(plan, { strict: true });
}
/** An investigation request as the coordinator gave it: questions trimmed,
 * empty and repeated ones dropped, fields this contract does not know ignored.
 * What is left is refused by name when it cannot be asked. */
export function researchInput(v: unknown): {
  goal: string;
  questions: string[];
  roots?: string[];
} {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    return issue("request", "must be an object with a goal and questions");
  const given = (key: string): unknown =>
    Object.getOwnPropertyDescriptor(v, key)?.value ?? undefined;
  const distinct = (name: string, value: unknown, maximum: number) => [
    ...new Set(
      entries(
        name,
        typeof value === "string" ? [value] : value,
        Number.MAX_SAFE_INTEGER,
        (entry, path) => words(path, entry, maximum).trim(),
      ).filter(Boolean),
    ),
  ];
  const questions = distinct("questions", given("questions"), 8192);
  if (!questions.length)
    issue("questions", "needs at least one question that is not empty");
  if (questions.length > WORKFLOW_LIMITS.questions)
    issue(
      "questions",
      `has ${questions.length} questions; one investigation takes at most ${WORKFLOW_LIMITS.questions}, so ask the others in a further call`,
    );
  const roots =
    given("roots") === undefined ? [] : distinct("roots", given("roots"), 4096);
  if (roots.length > 8)
    issue("roots", `has ${roots.length} directories; at most 8`);
  return {
    goal: words("goal", given("goal"), 8192, true),
    questions,
    ...(roots.length ? { roots } : {}),
  };
}
/** Existing project documents the agreement allows this delivery to update. */
export function workflowDocuments(p: WorkflowPlan): string[] {
  return p.documents ?? p.knowledge ?? [];
}
/** The write scope the agreement starts from. A version-3 run may extend it
 * inside the repository boundary (`workflowBoundary`); earlier versions never. */
export function workflowWrites(p: WorkflowPlan): string[] {
  return [
    ...new Set([...p.tasks.flatMap((t) => t.writes), ...workflowDocuments(p)]),
  ];
}
/** Whether a revision may bring this path into a run's write scope: a plain
 * repository path that names no credential, key or private-state file. */
export function workflowBoundary(path: string): boolean {
  try {
    if (workflowPath(path, true) !== path) return false;
  } catch {
    return false;
  }
  return !path
    .split("/")
    .some(
      (name) =>
        /^\.(?:ssh|aws|azure|gnupg|kube|npmrc|pypirc|netrc|pi)$/iu.test(name) ||
        /^(?:auth|models|credentials|service-account)\.json$/iu.test(name) ||
        /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/iu.test(name) ||
        /\.(?:pem|key|p12|pfx)$/iu.test(name),
    );
}
function decodeWorkflowReadings(
  value: unknown,
  strict: boolean,
  name: string,
): WorkflowReading[] {
  return entries(name, value, 16, (entry, path): WorkflowReading => {
    if (Object.hasOwn((entry ?? {}) as object, "research")) {
      const r = fields(path, entry, ["research", "reason"]);
      // Either spelling of the record; the plan keeps its uuid.
      const id =
        typeof r.research === "string" ? investigationId(r.research) : null;
      if (id === null)
        issue(
          `${path}.research`,
          `${typeof r.research === "string" ? `${quoted(r.research)} ` : ""}is not an investigation; give the "investigation" value of a completed research step`,
        );
      return {
        research: id as string,
        reason: words(`${path}.reason`, r.reason, WORKFLOW_LIMITS.reason, true),
      };
    }
    const r = fields(path, entry, ["path", "reason"], ["section"]);
    return {
      path: at(`${path}.path`, () => workflowPath(r.path, strict)),
      ...(r.section === undefined
        ? {}
        : { section: words(`${path}.section`, r.section, 256, true) }),
      reason: words(`${path}.reason`, r.reason, WORKFLOW_LIMITS.reason, true),
    };
  });
}
const agreementText = (p: WorkflowPlan) =>
  `# ${p.goal}\n\nInitial route (${p.version === 3 ? "the owner may revise it" : "adapt within the approved boundary"}): ${p.design}\n\nExplicit decisions and non-goals: ${p.decisions}${p.assumptions ? `\n\nAssumptions confirmed with the agreement: ${p.assumptions}` : ""}\n\nAcceptance: ${p.acceptance}`;
export function workflowContext(p: WorkflowPlan): string {
  return text(agreementText(p), WORKFLOW_LIMITS.context, true);
}
export function gitOid(value: unknown): string {
  const oid = text(value, 64, true);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(oid))
    throw new Error("Invalid Git object");
  return oid;
}
function localRef(value: unknown): string {
  const ref = text(value, 1024, true);
  if (
    !ref.startsWith("refs/heads/") ||
    /[\s~^:?*[\\]/u.test(ref) ||
    [...ref].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref
      .split("/")
      .some(
        (p) =>
          !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock"),
      )
  )
    throw new Error("Invalid local ref");
  return ref;
}
function deliveryPath(value: unknown): string {
  const path = text(value, 4096, true);
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(path) || path.includes("\0"))
    throw new Error("Invalid delivery path");
  return path;
}
export function decodeDeliveryBinding(value: unknown): DeliveryBinding {
  const b = closed(value, ["policy", "target"]);
  const t = closed(b.target, [
    "checkoutRoot",
    "repository",
    "repositoryIdentity",
    "branch",
    "head",
  ]);
  return {
    policy: oneOf(b.policy, ["task-branch-v1"]),
    target: {
      checkoutRoot: deliveryPath(t.checkoutRoot),
      repository: deliveryPath(t.repository),
      repositoryIdentity: decodeHash(t.repositoryIdentity),
      branch: localRef(t.branch),
      head: gitOid(t.head),
    },
  };
}
export function decodeDeliveryObservation(value: unknown): DeliveryObservation {
  const d = closed(value, [
    "binding",
    "taskBranch",
    "worktreeRoot",
    ...(Object.hasOwn((value ?? {}) as object, "artifacts")
      ? ["artifacts"]
      : []),
    "preparation",
    "workspace",
    "candidate",
    "acceptance",
    "integration",
    "postChecks",
    "cleanup",
  ]);
  const i = closed(d.integration, ["status", "before", "after", "reason"]);
  const c = closed(d.cleanup, ["status", "reason"]);
  const step = (x: unknown) => text(x, 160, true);
  const acceptance = nullable(d.acceptance, (v) => {
    const a = closed(v, [
      "candidate",
      "tree",
      "planDigest",
      "contextDigest",
      "checks",
      "review",
      ...(Object.hasOwn((v ?? {}) as object, "waived") ? ["waived"] : []),
    ]);
    const checks = list(a.checks, WORKFLOW_LIMITS.checks, step);
    if (!checks.length || new Set(checks).size !== checks.length)
      throw new Error("Invalid acceptance checks");
    return {
      candidate: gitOid(a.candidate),
      tree: gitOid(a.tree),
      planDigest: decodeHash(a.planDigest),
      contextDigest: decodeHash(a.contextDigest),
      checks,
      review: step(a.review),
      ...(a.waived === undefined
        ? {}
        : {
            waived: list(a.waived, WORKFLOW_LIMITS.checks, step).filter((id) =>
              checks.includes(id),
            ),
          }),
    };
  });
  const candidate = nullable(d.candidate, gitOid);
  if (acceptance && acceptance.candidate !== candidate)
    throw new Error("Stale candidate acceptance");
  const workspace = nullable(d.workspace, (v) => {
    const w = closed(v, ["head", "state"]);
    return {
      head: gitOid(w.head),
      state: oneOf(w.state, [
        "preparing",
        "ready",
        "removed",
        "retained",
      ] as const),
    };
  });
  const binding = decodeDeliveryBinding(d.binding),
    taskBranch = localRef(d.taskBranch);
  if (
    !taskBranch.startsWith("refs/heads/cadence/") ||
    (i.status === "applied" && i.after === null)
  )
    throw new Error("Inconsistent delivery evidence");
  return {
    binding,
    taskBranch,
    worktreeRoot: deliveryPath(d.worktreeRoot),
    ...(d.artifacts === undefined
      ? {}
      : {
          artifacts: list(d.artifacts, 256, (entry) => {
            const a = closed(entry, [
              "id",
              "path",
              "base",
              "head",
              "applied",
              "state",
            ]);
            return {
              id: taskId(a.id),
              path: deliveryPath(a.path),
              base: gitOid(a.base),
              head: gitOid(a.head),
              applied: nullable(a.applied, gitOid),
              state: oneOf(a.state, [
                "preparing",
                "ready",
                "removed",
                "retained",
              ] as const),
            };
          }),
        }),
    preparation: oneOf(d.preparation, ["pending", "ready", "unknown"]),
    workspace,
    candidate,
    acceptance,
    integration: {
      status: oneOf(i.status, [
        "pending",
        "blocked",
        "applying",
        "applied",
        "unknown",
      ]),
      before: gitOid(i.before),
      after: nullable(i.after, gitOid),
      reason: text(i.reason, 2048),
    },
    postChecks: oneOf(d.postChecks, ["not-run", "passed", "failed", "unknown"]),
    cleanup: {
      status: oneOf(c.status, ["pending", "removed", "retained"]),
      reason: text(c.reason, 2048),
    },
  };
}
/** Shared native/browser copy: placement is part of the visible approval. */
export function readableDelivery(binding?: DeliveryBinding): string {
  if (!binding) return "";
  const t = binding.target;
  return `Target: ${t.branch} @ ${t.head}\nTarget checkout: ${t.checkoutRoot}\nExecution: new cadence/<goal>-<run-id> branch and one stable isolated worktree after approval. Assignments that can run side by side each work in a temporary worktree of their own beside it; the service commits that work and picks it onto the candidate.\nAcceptance: checks and automatic Agent review of the exact candidate.\nDelivery: fast-forward only into the bound target, unchanged since approval or this run's last confirmed merge. Keep the task branch; remove only owned worktrees without any residue, including ignored files. No source/profile/dependency copying, push or deployment.`;
}
export function readableDeliveryRun(d?: DeliveryObservation): string {
  if (!d) return "";
  return `Task branch: ${d.taskBranch}\nWorktree: ${d.worktreeRoot}\nTarget: ${d.binding.target.branch} @ ${d.binding.target.head}\nPreparation: ${d.preparation}\nCandidate: ${d.candidate ?? "not recorded"}\nAcceptance: ${d.acceptance ? `checks + automatic Agent review of ${d.acceptance.candidate}` : "not recorded"}\nIntegration: ${d.integration.status}${d.integration.after ? ` @ ${d.integration.after}` : ""}${d.integration.reason ? ` — ${d.integration.reason}` : ""}\nPost-merge checks: ${d.postChecks}\nWorktree cleanup: ${d.cleanup.status}${d.cleanup.reason ? ` — ${d.cleanup.reason}` : ""}\nPolicy: keep the task branch; no push or deployment.`;
}
export function decodeWorkflowProposal(v: unknown): WorkflowProposal {
  const modern =
    v !== null && typeof v === "object" && Object.hasOwn(v, "display");
  const o = closed(v, [
    "id",
    "epoch",
    "digest",
    "observation",
    "model",
    "plan",
    "cwd",
    ...(Object.hasOwn(v ?? {}, "checkoutRoot") ? ["checkoutRoot"] : []),
    ...(Object.hasOwn(v ?? {}, "delivery") ? ["delivery"] : []),
    ...(modern ? ["display"] : []),
  ]);
  return {
    ...(o.delivery === undefined
      ? {}
      : { delivery: decodeDeliveryBinding(o.delivery) }),
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    digest: decodeHash(o.digest),
    observation: decodeHash(o.observation),
    model: decodeChoiceVersion(o.model),
    plan: decodeWorkflowPlan(o.plan),
    cwd: text(o.cwd, 4096, true),
    ...(o.checkoutRoot === undefined
      ? {}
      : { checkoutRoot: text(o.checkoutRoot, 4096, true) }),
    ...(modern
      ? {
          display: (() => {
            const d = closed(o.display, [
              "model",
              "branch",
              "baseCommit",
              ...(Object.hasOwn(o.display ?? {}, "runtime") ? ["runtime"] : []),
            ]);
            return {
              ...(d.runtime === undefined
                ? {}
                : { runtime: text(d.runtime, 4096, true) }),
              model: text(d.model, 1024, true),
              branch: text(d.branch, 1024),
              baseCommit: text(d.baseCommit, 64),
            };
          })(),
        }
      : {}),
  };
}
export function decodeWorkflowRequest(v: unknown): WorkflowRequest {
  const action = Object.getOwnPropertyDescriptor(v ?? {}, "action")?.value;
  if (action === "research") {
    const o = closed(v, [
      "action",
      "goal",
      "questions",
      "model",
      ...(Object.hasOwn(v ?? {}, "roots") ? ["roots"] : []),
    ]);
    const questions = list(o.questions, WORKFLOW_LIMITS.questions, (q) =>
      text(q, 8192, true),
    );
    if (!questions.length) throw new Error("Research needs a question");
    const roots =
      o.roots === undefined
        ? undefined
        : list(o.roots, 8, (p) => text(p, 4096, true));
    if (roots && !roots.length)
      throw new Error("Research needs a specific root");
    return {
      action,
      goal: text(o.goal, 8192, true),
      questions,
      ...(roots ? { roots } : {}),
      model: decodeChoiceVersion(o.model),
    };
  }
  if (action === "propose") {
    const o = closed(v, ["action", "plan", "model"]);
    return {
      action,
      plan: decodeWorkflowPlan(o.plan),
      model: decodeChoiceVersion(o.model),
    };
  }
  if (action === "prepare" || action === "execute") {
    const o = closed(
      v,
      action === "execute"
        ? ["action", "proposalId", "digest", "grant"]
        : ["action", "proposalId", "digest"],
    );
    const base = {
      proposalId: decodeId(o.proposalId),
      digest: decodeHash(o.digest),
    };
    return action === "prepare"
      ? { action, ...base }
      : { action, ...base, grant: decodeId(o.grant) };
  }
  const o = closed(v, ["action", "runId"]);
  return { action: oneOf(o.action, ["cancel"]), runId: decodeId(o.runId) };
}
export function decodeWorkflowRun(v: unknown): WorkflowRun {
  const o = closed(v, [
    "id",
    "epoch",
    "goal",
    "status",
    "phase",
    "steps",
    "notice",
    "mergedCommit",
    "humanReviewed",
    ...(Object.hasOwn(v ?? {}, "stepsBefore") ? ["stepsBefore"] : []),
    ...(Object.hasOwn(v ?? {}, "revision") ? ["revision"] : []),
    ...(Object.hasOwn(v ?? {}, "scope") ? ["scope"] : []),
    ...(Object.hasOwn(v ?? {}, "deviations") ? ["deviations"] : []),
    ...(Object.hasOwn(v ?? {}, "tasks") ? ["tasks"] : []),
    ...(Object.hasOwn(v ?? {}, "verification") ? ["verification"] : []),
    ...(Object.hasOwn(v ?? {}, "diagnostics") ? ["diagnostics"] : []),
    ...(Object.hasOwn(v ?? {}, "execution") ? ["execution"] : []),
    ...(Object.hasOwn(v ?? {}, "delivery") ? ["delivery"] : []),
  ]);
  const status = (x: unknown) =>
    oneOf(x, [
      "running",
      "completed",
      "failed",
      "canceled",
      "timeout",
      "unknown",
    ] as const);
  if (o.humanReviewed !== false)
    throw new Error("Automatic execution is not human review");
  return {
    ...(o.verification === undefined
      ? {}
      : {
          verification: (() => {
            const evidence = closed(o.verification, ["id", "source", "steps"]);
            return {
              id: decodeId(evidence.id),
              source: decodeHash(evidence.source),
              steps: list(evidence.steps, 32, (v) => text(v, 160, true)),
            };
          })(),
        }),
    ...(o.stepsBefore === undefined
      ? {}
      : { stepsBefore: integer(o.stepsBefore, 0) }),
    ...(o.revision === undefined ? {} : { revision: integer(o.revision, 0) }),
    ...(o.scope === undefined
      ? {}
      : { scope: list(o.scope, 1024, (path) => workflowPath(path)) }),
    ...(o.deviations === undefined
      ? {}
      : {
          deviations: list(o.deviations, WORKFLOW_DEVIATIONS, (value) => {
            const d = closed(value, [
              "revision",
              "item",
              "reason",
              "delivered",
              "waives",
            ]);
            return {
              revision: integer(d.revision, 0),
              item: text(d.item, 2048, true),
              reason: text(d.reason, 4096, true),
              delivered: text(d.delivered, 4096, true),
              waives: list(d.waives, 16, (name) => text(name, 128, true)),
            };
          }),
        }),
    ...(o.tasks === undefined
      ? {}
      : {
          tasks: list(o.tasks, WORKFLOW_LIMITS.route, (value) => {
            const t = closed(value, [
              "id",
              "title",
              "after",
              "state",
              ...(Object.hasOwn((value ?? {}) as object, "revision")
                ? ["revision"]
                : []),
            ]);
            return {
              id: taskId(t.id),
              title: text(t.title, 256, true),
              after: list(t.after, WORKFLOW_LIMITS.tasks, (id) => taskId(id)),
              state: oneOf(t.state, WORKFLOW_TASK_STATES),
              ...(t.revision === undefined
                ? {}
                : { revision: integer(t.revision, 1, 1_000_000) }),
            };
          }),
        }),
    ...(o.delivery === undefined
      ? {}
      : { delivery: decodeDeliveryObservation(o.delivery) }),
    ...(o.execution === undefined
      ? {}
      : { execution: decodeExecutionContext(o.execution) }),
    ...(o.diagnostics === undefined
      ? {}
      : { diagnostics: decodeWorkflowDiagnostics(o.diagnostics) }),
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    goal: text(o.goal, 8192),
    status: o.status === "queued" ? "queued" : status(o.status),
    phase: oneOf(o.phase, [
      "research",
      "implementing",
      "verifying",
      "reviewing",
      "recovering",
      "learning",
      "integrating",
      "finished",
    ]),
    notice: text(o.notice, 2048),
    mergedCommit: nullable(o.mergedCommit, (s) => text(s, 64, true)),
    humanReviewed: false,
    steps: list(o.steps, 256, (v) => {
      const linked =
        v !== null && typeof v === "object" && Object.hasOwn(v, "childRunId");
      const s = closed(v, [
        "id",
        "kind",
        "status",
        "text",
        "exitCode",
        "truncated",
        ...(Object.hasOwn(v ?? {}, "timing") ? ["timing"] : []),
        ...(Object.hasOwn(v ?? {}, "runtime") ? ["runtime"] : []),
        ...(linked ? ["childRunId"] : []),
      ]);
      return {
        ...(s.timing === undefined
          ? {}
          : { timing: decodeWorkflowTiming(s.timing) }),
        ...(s.runtime === undefined
          ? {}
          : {
              runtime: (() => {
                const r = closed(s.runtime, ["sdkVersion", "workerHash"]);
                return {
                  sdkVersion: text(r.sdkVersion, 128, true),
                  workerHash: decodeHash(r.workerHash),
                };
              })(),
            }),
        id: text(s.id, 160, true),
        ...(linked ? { childRunId: decodeId(s.childRunId) } : {}),
        kind: oneOf(s.kind, [
          "research",
          "implementation",
          "diagnosis",
          "knowledge",
          "review",
          "check",
          "git",
        ]),
        status:
          s.kind === "review" && s.status === "rejected"
            ? "rejected"
            : status(s.status),
        text: text(s.text, 65536),
        exitCode: nullable(s.exitCode, (n) =>
          integer(n, -2147483648, 2147483647),
        ),
        truncated: bool(s.truncated),
      };
    }),
  };
}
export function decodeWorkflowResponse(v: unknown): WorkflowResponse {
  const type = Object.getOwnPropertyDescriptor(v ?? {}, "type")?.value;
  if (type === "run") {
    const o = closed(v, ["type", "run"]);
    return { type, run: decodeWorkflowRun(o.run) };
  }
  if (type === "proposal") {
    const o = closed(v, ["type", "proposal"]);
    return { type, proposal: decodeWorkflowProposal(o.proposal) };
  }
  const o = closed(v, ["type", "proposal", "grant", "expiresAt"]);
  return {
    type: oneOf(o.type, ["grant"]),
    proposal: decodeWorkflowProposal(o.proposal),
    grant: decodeId(o.grant),
    expiresAt: integer(o.expiresAt, 0),
  };
}
const readableCheck = (c: WorkflowCheck) =>
  `${c.name}: ${c.command} (${c.timeoutMs === undefined ? "no timeout" : `${c.timeoutMs}ms`})`;
const readableReading = (r: WorkflowReading) =>
  "research" in r
    ? `investigation ${r.research} — ${r.reason}`
    : `${r.path}${r.section ? ` § ${r.section}` : ""} — ${r.reason}`;
/** What approval of each agreement version lets the owner do on its own. */
function readableAutomation(p: WorkflowPlan): string {
  if (p.version === 3)
    return `After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. ${p.policy?.installs ? "Revisions may add dependency-installation commands with the project's own package manager." : "No dependency installation beyond the setup commands listed here."}`;
  if (p.version === 2)
    return "Retained agreement (readonly): diagnosis, partial-work continuation, task splitting and alternative implementations within these goals, decisions, write paths and exact setup/check commands.";
  return `Historical fixed pipeline: at most ${p.repairAttempts} repair rounds.`;
}
export function readableWorkflowPlan(p: WorkflowPlan): string {
  const documents = workflowDocuments(p);
  return `# ${p.goal}\n\n## Initial route (the service may revise it)\n${p.design}\n\n## Decisions\n${p.decisions}\n\n## Acceptance\n${p.acceptance}${
    p.version === 3
      ? `\n\n## Assumptions (confirmed by approval)\n${p.assumptions || "None beyond the decisions above."}`
      : ""
  }\n\n## Tasks\n${workflowOrder(p.tasks)
    .map(
      (t) =>
        `### ${t.id}: ${t.title}\nDepends on: ${t.after.join(", ") || "none"}\nWrites: ${t.writes.join(", ")}${t.reads?.length ? `\nReads first: ${t.reads.map(readableReading).join("; ")}` : ""}\n${t.instructions}`,
    )
    .join(
      "\n\n",
    )}\n\n## Setup (explicitly authorized commands)\n${p.setup.map(readableCheck).join("\n") || "None; no dependency installation or copying."}\n\n## Baseline verification\n${p.baselineChecks.map(readableCheck).join("\n") || "No separate baseline checks declared."}\n\n## Verification\n${p.checks.map(readableCheck).join("\n")}${
    p.reviewReads?.length
      ? `\n\n## Review reads first\n${p.reviewReads.map(readableReading).join("\n")}`
      : ""
  }\n\n## Automation boundary\n${readableAutomation(p)} Only actual verification and independent Agent review permit delivery. ${p.delivery === "local-merge" ? "Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue." : "Direct working-copy edits; failures leave actual edits for inspection. No Git commit or merge."} No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.\n\n## Project documents\n${
    p.version === undefined
      ? p.projectContext
      : documents.join("\n") ||
        "No existing document is named for update; project knowledge is still read."
  }\n`;
}

const timestamp = (v: unknown) => integer(v, 0, 8640000000000000);
function decodeWorkflowTiming(v: unknown): WorkflowTiming {
  const o = closed(v, [
    "createdAt",
    "preparedAt",
    "startedAt",
    "stopRequestedAt",
    "closedAt",
    "settledAt",
    ...(Object.hasOwn(v ?? {}, "timeoutMs") ? ["timeoutMs"] : []),
    "stopReason",
  ]);
  return {
    createdAt: timestamp(o.createdAt),
    preparedAt: nullable(o.preparedAt, timestamp),
    startedAt: nullable(o.startedAt, timestamp),
    stopRequestedAt: nullable(o.stopRequestedAt, timestamp),
    closedAt: nullable(o.closedAt, timestamp),
    settledAt: nullable(o.settledAt, timestamp),
    ...(o.timeoutMs === undefined
      ? {}
      : { timeoutMs: integer(o.timeoutMs, 100, 2_147_483_647) }),
    // Current summaries include source and target; old short outcome labels
    // remain readable without inventing provenance for them.
    stopReason: nullable(o.stopReason, (v) => text(v, 320, true)),
  };
}
function decodeWorkflowDiagnostics(v: unknown): WorkflowDiagnostics {
  const o = closed(v, ["acceptedAt", "acquiredAt", "settledAt", "owner"]);
  const r = closed(o.owner, [
    "version",
    "build",
    "entry",
    "pid",
    "node",
    "platform",
    "startedAt",
  ]);
  return {
    acceptedAt: timestamp(o.acceptedAt),
    acquiredAt: nullable(o.acquiredAt, timestamp),
    settledAt: nullable(o.settledAt, timestamp),
    owner: {
      version: text(r.version, 128, true),
      build: text(r.build, 64, true),
      entry: text(r.entry, 4096, true),
      pid: integer(r.pid, 1),
      node: text(r.node, 128, true),
      platform: text(r.platform, 32, true),
      startedAt: timestamp(r.startedAt),
    },
  };
}
/** Owner observations, never inferred from a parent's batched tool-result timestamp. */
export function workflowDiagnostics(run: WorkflowRun): string {
  const d = run.diagnostics;
  if (!d) return "Owner timing/runtime observations not recorded.";
  const at = (v: number | null) =>
    v === null ? "not observed" : new Date(v).toISOString();
  return [
    `Owner: Cadence ${d.owner.version} · ${d.owner.platform} · Node ${d.owner.node} · PID ${d.owner.pid} · epoch ${run.epoch}`,
    `Build: ${d.owner.build} · entry: ${d.owner.entry} · owner started: ${at(d.owner.startedAt)}`,
    `Accepted: ${at(d.acceptedAt)} · checkout acquired: ${at(d.acquiredAt)} · settled: ${at(d.settledAt)}`,
    `Checkout wait: ${d.acquiredAt === null ? "still waiting or not acquired" : `${Math.max(0, d.acquiredAt - d.acceptedAt)}ms`}. Runs share an exclusive checkout; questions within one research run may overlap.`,
    ...run.steps.flatMap((s) =>
      s.timing
        ? [
            `${s.id}: preparing ${at(s.timing.createdAt)} · prepared ${at(s.timing.preparedAt)} · spawned ${at(s.timing.startedAt)} · stop ${at(s.timing.stopRequestedAt)} (${s.timing.stopReason ?? "none"}) · direct child closed ${at(s.timing.closedAt)} · settled ${at(s.timing.settledAt)} · ${s.timing.timeoutMs === undefined ? "no total runtime deadline" : `historical process budget ${s.timing.timeoutMs}ms`}${s.runtime ? ` · worker SDK ${s.runtime.sdkVersion} · worker hash ${s.runtime.workerHash}` : ""}`,
          ]
        : [],
    ),
  ].join("\n");
}
