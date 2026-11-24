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

export const CURRENT_WORKFLOW_PLAN_VERSION = 5 as const;
export const WORKFLOW_LIMITS = {
  tasks: 16,
  /** Assignments one run may list in all, counting those its revisions added
   * and those they superseded. */
  route: 48,
  /** Questions one research run may carry; all of them are asked at once.
   * The tool schema states no count, so only this bound refuses one. */
  questions: 32,
  checks: 16,
  builds: 8,
  links: 8,
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
  /** Live runs one roster reply lists. A wire bound on that one reply, never
   * a limit on how many runs are admitted. */
  roster: 4096,
} as const;
export type WorkflowCheckTier = "fast" | "heavy";
export type WorkflowCheckTarget = "run" | "skip";
export interface WorkflowCheck {
  name: string;
  command: string;
  timeoutMs?: number;
  /** V4: execution cost tier (`fast` default): order, and how much of the
   * host a run of it is assumed to need. */
  tier?: WorkflowCheckTier;
  /** Retained data only: once chose whether a check reran in the target
   * checkout after the merge. Acceptance is decided on the exact candidate, so
   * it has no effect; saved agreements that carry it still decode. */
  target?: WorkflowCheckTarget;
}
/** An owner-run build step. It may change only what it declares: `outputs`
 * are derived as a whole and rebuilt from the sources, so a merge never
 * reconciles their bytes; `refreshes` are files whose entries are source and
 * whose values the command recomputes in place (a table of content hashes),
 * so a merge reconciles the entries and the command supplies the values. */
export interface WorkflowBuild {
  name: string;
  command: string;
  outputs: string[];
  refreshes?: string[];
  timeoutMs?: number;
}
/** Every path the builds write: wholly derived outputs and refreshed files. */
export function workflowBuildPaths(builds: readonly WorkflowBuild[]): string[] {
  return [
    ...new Set(builds.flatMap((b) => [...b.outputs, ...(b.refreshes ?? [])])),
  ];
}
/** V4: narrow owner-managed dependency symlink provisioned from the original checkout. */
export interface WorkflowSetupLink {
  path: string;
  source?: string;
  placement?: "candidate" | "worktree";
}
/** Setup placement is part of approval. Missing only in retained agreements,
 * where the original meaning (every worktree) is preserved. */
export interface WorkflowSetup {
  name: string;
  command: string;
  timeoutMs?: number;
  placement?: "target" | "candidate" | "worktree";
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
  /** Version 3+: what this assignment reads first. */
  reads?: WorkflowReading[];
}
/** Version 3+: what the owner may do on its own after approval, beyond revising
 * the route, the assignments and their write scope. */
export interface WorkflowPolicy {
  /** Whether a revision may add dependency-installation setup commands. */
  installs: boolean;
}
export interface WorkflowPlan {
  /** Version 5 separates the human-approved Stage 1 delivery agreement from the
   * service-owned Stage 2 route planning (`route-planner` in the isolated worktree)
   * and owner proposal-time discovery of managed `node_modules` links. Versions 4,
   * 3, 2 and unversioned plans remain readable and readonly. */
  version?: 2 | 3 | 4 | 5;
  /** Version 2 only: approved documentation write paths. */
  knowledge?: string[];
  /** Version 3+: what the coordinator decided on the user's behalf; approval
   * confirms these with the goal, decisions and acceptance. */
  assumptions?: string;
  /** Version 5: recorded `cadence_research` investigation UUIDs to pass directly
   * to Stage 2 route planning. */
  investigations?: string[];
  /** Version 5: advisory repository areas/modules for Stage 2 route planning
   * (never a dirty-file fence at proposal time). */
  areas?: string[];
  /** Version 3+: existing project documents this delivery may update. */
  documents?: string[];
  /** Version 3-4: what the independent review reads first (planned in Stage 2 for V5). */
  reviewReads?: WorkflowReading[];
  policy?: WorkflowPolicy;
  /** Version 4+: deterministic owner-synced build commands with declared
   * paths. In V5 input, omitted (`undefined`) lets the owner bind the
   * repository's own declaration (`.cadence/derived.json`) at proposal time;
   * explicit `[]` declares none. */
  build?: WorkflowBuild[];
  /** Version 4+: owner-managed dependency symlinks from the original checkout.
   * In V5 input, omitted (`undefined`) enables owner proposal-time discovery of
   * ignored `node_modules` links; explicit `[]` disables automatic links. */
  links?: WorkflowSetupLink[];
  goal: string;
  design: string;
  decisions: string;
  acceptance: string;
  /** Retained v1 data only, never used to synthesize new project knowledge. */
  projectContext?: string;
  /** Empty in V5 Stage 1 agreements (populated in Stage 2 route planning). */
  tasks: WorkflowTask[];
  checks: WorkflowCheck[];
  setup: WorkflowSetup[];
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
  /** `task-branch-v3` is the only policy that executes; the earlier two name
   * how retained runs were delivered. */
  policy: "task-branch-v1" | "task-branch-v2" | "task-branch-v3";
  target: DeliveryTarget;
}
/** What an agreement binds before a run exists: where it will land, not the
 * commit it starts from. A run takes the branch's head when it is admitted.
 * Retained proposals also carry the head they were shown at. */
export interface DeliveryPlacement {
  policy: DeliveryBinding["policy"];
  target: Omit<DeliveryTarget, "head"> & { head?: string };
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
    /** V4 (`task-branch-v2`) uses detached development checkpoints until final sign-off. */
    mode?: "branch" | "detached";
  } | null;
  /** V4: latest confirmed private checkpoint OID pinned under refs/cadence/runs/<id>/checkpoints/*. */
  lastCheckpoint?: string | null;
  /** V4: count of confirmed private development/delivery checkpoints. */
  checkpointCount?: number;
  candidate: string | null;
  acceptance: AcceptanceRecord | null;
  integration: {
    /** `branch`: the verified commit is on the task branch only; the target
     * branch was not moved, and `reason` says why. */
    status:
      | "pending"
      | "blocked"
      | "applying"
      | "applied"
      | "branch"
      | "unknown";
    before: string;
    after: string | null;
    reason: string;
    /** How the target branch was moved, once it was: by reference alone when
     * no worktree had it checked out, otherwise by fast-forward there. */
    sync?: { mode: "ref" | "fast-forward"; worktree: string | null };
  };
  /** Retained runs only: checks once rerun in the target checkout. */
  postChecks?: "not-run" | "passed" | "failed" | "unknown";
  cleanup: { status: "pending" | "removed" | "retained"; reason: string };
}
export interface WorkflowProposal {
  /** Immutable prior binding of the same plan; never inherited execution consent. */
  revalidatedFrom?: string;
  delivery?: DeliveryPlacement;
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
    /** The commit a retained proposal was bound to; empty in current ones,
     * which bind the branch and take its head when the run is admitted. */
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
    | "planning"
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
    | "partial"
    | "blocked"
    | "not-run"
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
    | "planning"
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
export function issue(path: string, problem: string): never {
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
export function words(
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
export function entries<T>(
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
export function fields(
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
export function decodeWorkflowCheck(
  v: unknown,
  path = "check",
  options: { v4Check?: boolean } = {},
): WorkflowCheck {
  const o = fields(
    path,
    v,
    ["name", "command"],
    ["timeoutMs", ...(options.v4Check ? ["tier", "target"] : [])],
  );
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
    ...(o.tier === undefined
      ? {}
      : {
          tier: at(`${path}.tier`, () => {
            try {
              return oneOf(o.tier, ["fast", "heavy"] as const);
            } catch {
              throw new Error("is fast or heavy");
            }
          }),
        }),
    ...(o.target === undefined
      ? {}
      : {
          target: at(`${path}.target`, () => {
            try {
              return oneOf(o.target, ["run", "skip"] as const);
            } catch {
              throw new Error("is run or skip");
            }
          }),
        }),
  };
}
function decodeWorkflowBuild(
  v: unknown,
  path: string,
  strict: boolean,
): WorkflowBuild {
  const o = fields(
    path,
    v,
    ["name", "command"],
    ["outputs", "refreshes", "timeoutMs"],
  );
  const { outputs: rawOutputs, refreshes: rawRefreshes, ...command } = o;
  const paths = (name: "outputs" | "refreshes", raw: unknown) => {
    if (raw === undefined) return [];
    const declared = entries(`${path}.${name}`, raw, 64, (entry, item) =>
      at(item, () => {
        const p = workflowPath(entry, strict);
        if (!workflowBoundary(p))
          throw new Error(
            "cannot target credentials, keys, .env, .git or paths outside the repository",
          );
        return p;
      }),
    );
    if (new Set(declared).size !== declared.length)
      issue(`${path}.${name}`, "lists a path twice");
    return declared;
  };
  const outputs = paths("outputs", rawOutputs),
    refreshes = paths("refreshes", rawRefreshes);
  if (!outputs.length && !refreshes.length)
    issue(
      `${path}.outputs`,
      "needs at least one declared repository-relative path here or in refreshes",
    );
  const both = refreshes.find(
    (r) =>
      workflowCovers(outputs, r) || outputs.some((o) => o.startsWith(`${r}/`)),
  );
  if (both)
    issue(
      `${path}.refreshes`,
      `${quoted(both)} is also under outputs; a path is derived as a whole or refreshed in place, not both`,
    );
  const base = decodeWorkflowCheck(command, path);
  return { ...base, outputs, ...(refreshes.length ? { refreshes } : {}) };
}
/** A repository's own build declaration, held to the rules of an agreement's. */
export function decodeWorkflowBuilds(
  v: unknown,
  path: string,
): WorkflowBuild[] {
  return entries(path, v, WORKFLOW_LIMITS.builds, (entry, item) =>
    decodeWorkflowBuild(entry, item, true),
  );
}
function decodeWorkflowSetupLink(
  v: unknown,
  path: string,
  strict: boolean,
): WorkflowSetupLink {
  const o = fields(path, v, ["path"], ["source", "placement"]);
  const linkPath = (raw: unknown, fieldPath: string) =>
    at(fieldPath, () => {
      const p = workflowPath(raw, strict);
      if (
        !workflowBoundary(p) ||
        p.split("/").some((segment) => segment.startsWith("."))
      )
        throw new Error(
          "must be a plain checkout-relative dependency path without dot-prefixed segments",
        );
      return p;
    });
  return {
    path: linkPath(o.path, `${path}.path`),
    ...(o.source === undefined
      ? {}
      : { source: linkPath(o.source, `${path}.source`) }),
    ...(o.placement === undefined
      ? {}
      : {
          placement: at(`${path}.placement`, () => {
            try {
              return oneOf(o.placement, ["candidate", "worktree"] as const);
            } catch {
              throw new Error("is candidate or worktree");
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
  if (
    modern &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5
  )
    throw new Error("Unsupported delivery agreement version");
  const v3OrNewer = version === 3 || version === 4 || version === 5;
  const v4OrNewer = version === 4 || version === 5;
  const v5 = version === 5;
  if (strict && !v5)
    throw new Error(
      "Publish a new delivery agreement; earlier agreements are readonly",
    );
  const o = fields(
    "plan",
    v,
    [
      "goal",
      "design",
      "decisions",
      "acceptance",
      ...(v5
        ? [
            "version",
            "assumptions",
            "investigations",
            "areas",
            "documents",
            "policy",
          ]
        : v3OrNewer
          ? [
              "version",
              "assumptions",
              "documents",
              "reviewReads",
              "policy",
              ...(v4OrNewer ? ["build", "links"] : []),
              "tasks",
            ]
          : modern
            ? ["version", "knowledge", "tasks"]
            : ["projectContext", "repairAttempts", "tasks"]),
      "checks",
      "setup",
      "baselineChecks",
      "delivery",
    ],
    v5 ? ["build", "links", "tasks"] : [],
  );
  const documentation = (value: unknown, name: string) =>
    entries(name, value, 16, (entry, path) =>
      at(path, () => {
        const document = workflowPath(entry, strict);
        if (!document.endsWith(".md"))
          throw new Error("must be a Markdown file (.md)");
        if (v5 && (document === ".cadence" || document.startsWith(".cadence/")))
          throw new Error(
            "is managed automatically under .cadence/ and must not be listed in documents",
          );
        return document;
      }),
    );
  const tasks = v5
    ? o.tasks === undefined
      ? []
      : (() => {
          const list = entries("tasks", o.tasks, 0, () => {
            throw new Error("must not be specified in v5 agreements");
          });
          return list as WorkflowTask[];
        })()
    : entries("tasks", o.tasks, WORKFLOW_LIMITS.tasks, (value, path) => {
        const t = fields(path, value, [
          "id",
          "title",
          "instructions",
          "writes",
          "after",
          ...(v3OrNewer ? ["reads"] : []),
        ]);
        return {
          id: at(`${path}.id`, () => taskId(t.id, strict)),
          title: words(`${path}.title`, t.title, 256, true),
          instructions: words(
            `${path}.instructions`,
            t.instructions,
            8192,
            true,
          ),
          writes: entries(`${path}.writes`, t.writes, 128, (p, entry) =>
            at(entry, () => workflowPath(p, strict)),
          ),
          after: entries(
            `${path}.after`,
            t.after,
            WORKFLOW_LIMITS.tasks,
            (id, entry) => at(entry, () => taskId(id, strict)),
          ),
          ...(v3OrNewer
            ? {
                reads: decodeWorkflowReadings(t.reads, strict, `${path}.reads`),
              }
            : {}),
        };
      });
  if (!v5 && !tasks.length) issue("tasks", "needs at least one assignment");
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
  if (tasks.length) at("tasks", () => workflowOrder(tasks));
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
  const commands = (
    value: unknown,
    name: string,
    maximum: number,
    v4Check = false,
  ) =>
    entries(name, value, maximum, (entry, path) =>
      decodeWorkflowCheck(entry, path, { v4Check }),
    );
  const checks = commands(
    o.checks,
    "checks",
    WORKFLOW_LIMITS.checks,
    v4OrNewer,
  );
  if (!checks.length)
    issue("checks", "needs at least one real verification command");
  // A current agreement that leaves `build` out leaves it to the repository's
  // own declaration, bound when the proposal is published.
  const build =
    v4OrNewer && (!v5 || o.build !== undefined)
      ? entries("build", o.build, WORKFLOW_LIMITS.builds, (entry, path) =>
          decodeWorkflowBuild(entry, path, strict),
        )
      : undefined;
  const links =
    v4OrNewer && o.links !== undefined
      ? entries("links", o.links, WORKFLOW_LIMITS.links, (entry, path) =>
          decodeWorkflowSetupLink(entry, path, strict),
        )
      : undefined;
  if (links) {
    const linkPaths = links.map((l) => l.path);
    for (const [i, l] of links.entries()) {
      if (linkPaths.indexOf(l.path) !== i)
        issue(
          `links[${i}].path`,
          `${quoted(l.path)} is already declared by links[${linkPaths.indexOf(l.path)}]`,
        );
    }
  }
  const investigations = v5
    ? entries(
        "investigations",
        o.investigations,
        WORKFLOW_LIMITS.questions,
        (entry, path) => {
          const id = typeof entry === "string" ? investigationId(entry) : null;
          if (id === null)
            issue(
              path,
              `${typeof entry === "string" ? `${quoted(entry)} ` : ""}is not an investigation; give the "investigation" value of a completed research step`,
            );
          return id as string;
        },
      )
    : undefined;
  if (investigations && new Set(investigations).size !== investigations.length)
    issue("investigations", "lists an investigation twice");
  const areas = v5
    ? entries("areas", o.areas, 32, (entry, path) =>
        at(path, () => {
          const p = workflowPath(entry, strict);
          if (!workflowBoundary(p))
            throw new Error(
              "cannot name credentials, keys, .env, .git or paths outside the repository",
            );
          return p;
        }),
      )
    : undefined;
  if (areas && new Set(areas).size !== areas.length)
    issue("areas", "lists an area twice");
  const result: WorkflowPlan = {
    goal: words("goal", o.goal, 8192, true),
    design: words("design", o.design, 32768, true),
    decisions: words("decisions", o.decisions, 16384),
    acceptance: words("acceptance", o.acceptance, 16384, true),
    ...(v5
      ? {
          version: 5 as const,
          assumptions: words("assumptions", o.assumptions, 16384),
          investigations: investigations ?? [],
          areas: areas ?? [],
          documents: documentation(o.documents, "documents"),
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
          ...(build !== undefined ? { build } : {}),
          ...(links !== undefined ? { links } : {}),
        }
      : v3OrNewer
        ? {
            version: (version === 4 ? 4 : 3) as 3 | 4,
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
                  return bool(
                    fields("policy", o.policy, ["installs"]).installs,
                  );
                } catch (error) {
                  if (error instanceof WorkflowInputError) throw error;
                  throw new Error("must be true or false");
                }
              }),
            },
            ...(v4OrNewer ? { build: build ?? [], links: links ?? [] } : {}),
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
    setup: entries("setup", o.setup, 4, (value, path): WorkflowSetup => {
      const entry = fields(
        path,
        value,
        ["name", "command", ...(strict ? ["placement"] : [])],
        ["timeoutMs", ...(!strict ? ["placement"] : [])],
      );
      const { placement, ...check } = entry;
      return {
        ...decodeWorkflowCheck(check, path),
        ...(placement === undefined
          ? {}
          : {
              placement: at(`${path}.placement`, () =>
                oneOf(placement, ["target", "candidate", "worktree"]),
              ),
            }),
      };
    }),
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
      `the write paths of all assignments, build outputs and documents are ${scope} bytes together; at most 16384`,
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
    ...(result.build ?? []).flatMap((b, i): [string, string][] => [
      [`build[${i}].name`, b.name],
      [`build[${i}].command`, b.command],
    ]),
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
    version: CURRENT_WORKFLOW_PLAN_VERSION,
    decisions: "",
    assumptions: "",
    investigations: [],
    areas: [],
    documents: [],
    policy: {},
    setup: [],
    baselineChecks: [],
  });
  // Omitted `links` and `build` stay undefined so publishProposal can bind
  // what the repository itself declares; an explicit `[]` declares none.
  if (Object.hasOwn(v, "tasks")) {
    const rawTasks = (v as { tasks?: unknown }).tasks;
    if (
      rawTasks !== undefined &&
      rawTasks !== null &&
      !(Array.isArray(rawTasks) && rawTasks.length === 0)
    )
      issue(
        "tasks",
        "v5 delivery agreements do not declare tasks; the service plans the execution route automatically after approval",
      );
    delete plan.tasks;
  }
  if (plan.policy && typeof plan.policy === "object")
    plan.policy = completed(plan.policy, { installs: false });
  if (Array.isArray(plan.investigations)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (const entry of plan.investigations) {
      const key =
        typeof entry === "string" ? (investigationId(entry) ?? entry) : null;
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(entry);
    }
    plan.investigations = deduped;
  }
  if (Array.isArray(plan.areas)) {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (const entry of plan.areas) {
      if (typeof entry === "string") {
        if (seen.has(entry)) continue;
        seen.add(entry);
      }
      deduped.push(entry);
    }
    plan.areas = deduped;
  }
  if (Array.isArray(plan.checks))
    plan.checks = plan.checks.map((check: unknown) =>
      check && typeof check === "object" && !Array.isArray(check)
        ? completed(check, {})
        : check,
    );
  if (Array.isArray(plan.build))
    plan.build = plan.build.map((b: unknown) =>
      b && typeof b === "object" && !Array.isArray(b) ? completed(b, {}) : b,
    );
  if (Array.isArray(plan.links))
    plan.links = plan.links.map((link: unknown) =>
      link && typeof link === "object" && !Array.isArray(link)
        ? completed(link, {})
        : link,
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
/** The write scope the agreement starts from. Version 3+ runs may extend it
 * inside the repository boundary (`workflowBoundary`); earlier versions never. */
export function workflowWrites(p: WorkflowPlan): string[] {
  return [
    ...new Set([
      ...p.tasks.flatMap((t) => t.writes),
      ...workflowBuildPaths(p.build ?? []),
      ...workflowDocuments(p),
    ]),
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
export function decodeWorkflowReadings(
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
  `# ${p.goal}\n\nInitial route (${p.version === 3 || p.version === 4 || p.version === 5 ? "the owner may revise it" : "adapt within the approved boundary"}): ${p.design}\n\nExplicit decisions and non-goals: ${p.decisions}${p.assumptions ? `\n\nAssumptions confirmed with the agreement: ${p.assumptions}` : ""}\n\nAcceptance: ${p.acceptance}`;
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
const DELIVERY_POLICIES = [
  "task-branch-v1",
  "task-branch-v2",
  "task-branch-v3",
] as const;
export function decodeDeliveryPlacement(value: unknown): DeliveryPlacement {
  const b = closed(value, ["policy", "target"]);
  const headed = Object.hasOwn((b.target ?? {}) as object, "head");
  const t = closed(b.target, [
    "checkoutRoot",
    "repository",
    "repositoryIdentity",
    "branch",
    ...(headed ? ["head"] : []),
  ]);
  return {
    policy: oneOf(b.policy, DELIVERY_POLICIES),
    target: {
      checkoutRoot: deliveryPath(t.checkoutRoot),
      repository: deliveryPath(t.repository),
      repositoryIdentity: decodeHash(t.repositoryIdentity),
      branch: localRef(t.branch),
      ...(headed ? { head: gitOid(t.head) } : {}),
    },
  };
}
export function decodeDeliveryBinding(value: unknown): DeliveryBinding {
  const { policy, target } = decodeDeliveryPlacement(value);
  if (target.head === undefined) throw new Error("Unbound delivery target");
  return { policy, target: { ...target, head: target.head } };
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
    ...(Object.hasOwn((value ?? {}) as object, "lastCheckpoint")
      ? ["lastCheckpoint"]
      : []),
    ...(Object.hasOwn((value ?? {}) as object, "checkpointCount")
      ? ["checkpointCount"]
      : []),
    "candidate",
    "acceptance",
    "integration",
    ...(Object.hasOwn((value ?? {}) as object, "postChecks")
      ? ["postChecks"]
      : []),
    "cleanup",
  ]);
  const synced = Object.hasOwn((d.integration ?? {}) as object, "sync");
  const i = closed(d.integration, [
    "status",
    "before",
    "after",
    "reason",
    ...(synced ? ["sync"] : []),
  ]);
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
    const w = closed(v, [
      "head",
      "state",
      ...(Object.hasOwn((v ?? {}) as object, "mode") ? ["mode"] : []),
    ]);
    return {
      head: gitOid(w.head),
      state: oneOf(w.state, [
        "preparing",
        "ready",
        "removed",
        "retained",
      ] as const),
      ...(w.mode === undefined
        ? {}
        : { mode: oneOf(w.mode, ["branch", "detached"] as const) }),
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
    ...(d.lastCheckpoint === undefined
      ? {}
      : { lastCheckpoint: nullable(d.lastCheckpoint, gitOid) }),
    ...(d.checkpointCount === undefined
      ? {}
      : { checkpointCount: integer(d.checkpointCount, 0, 1_000_000) }),
    candidate,
    acceptance,
    integration: {
      status: oneOf(i.status, [
        "pending",
        "blocked",
        "applying",
        "applied",
        "branch",
        "unknown",
      ]),
      before: gitOid(i.before),
      after: nullable(i.after, gitOid),
      reason: text(i.reason, 2048),
      ...(synced
        ? {
            sync: (() => {
              const s = closed(i.sync, ["mode", "worktree"]);
              return {
                mode: oneOf(s.mode, ["ref", "fast-forward"] as const),
                worktree: nullable(s.worktree, deliveryPath),
              };
            })(),
          }
        : {}),
    },
    ...(d.postChecks === undefined
      ? {}
      : {
          postChecks: oneOf(d.postChecks, [
            "not-run",
            "passed",
            "failed",
            "unknown",
          ] as const),
        }),
    cleanup: {
      status: oneOf(c.status, ["pending", "removed", "retained"]),
      reason: text(c.reason, 2048),
    },
  };
}
/** Shared native/browser copy: placement is part of the visible approval. */
export function readableDelivery(
  binding?: DeliveryPlacement | DeliveryBinding,
): string {
  if (!binding) return "";
  const t = binding.target;
  if (binding.policy === "task-branch-v3")
    return `Target: ${t.branch}${t.head ? ` @ ${t.head}` : " (its head when the run is admitted is the baseline)"}\nTarget checkout: ${t.checkoutRoot}\nExecution: reserve cadence/<goal>-<run-id> and create one stable detached worktree after approval, pinning intermediate development checkpoints under private run refs. Assignments that can run side by side each work in a temporary worktree of their own beside it; the service commits that work and picks it onto the candidate. Any number of conversations may deliver at once, each in its own candidate; nothing they do waits on your checkout.\nAcceptance: seal a single-parent delivery commit, run declared checks and independent Agent review on that exact OID, in the worktree only. When the target branch has moved, through another delivery or your own commits, the sealed commit is replayed onto its current head: declared build outputs are rebuilt, never merged; lines Git cannot merge are resolved by a worker that has to keep what both sides do; and the result is checked and reviewed again, together with the checks of deliveries that changed the same files in the meantime. That review also covers changed AGENTS.md rules and whether the branch's own changes to those files survive.\nDelivery: deliveries to one branch land one at a time in the order they became ready. The branch is moved to the exact verified OID: by reference alone when no worktree has it checked out, otherwise by fast-forward in that worktree, which keeps your uncommitted changes to other files; uncommitted changes to the same files retain the candidate. A branch that is being rebased is waited for. When no verified commit can be put on the branch (it was deleted, or nothing that merges with what it gained passes verification), the last verified commit is delivered on the task branch instead and the result says first that it was not merged. Keep the task branch; unlink only owner-created managed dependency links after identity verification, remove owned worktrees only when completely free of any remaining residue (including ignored files), then remove private checkpoint refs. No source/profile/dependency copying, push or deployment.`;
  if (binding.policy === "task-branch-v2")
    return `Target: ${t.branch} @ ${t.head}\nTarget checkout: ${t.checkoutRoot}\nExecution: reserve cadence/<goal>-<run-id> and create one stable detached worktree after approval, pinning intermediate development checkpoints under private run refs. Assignments that can run side by side each work in a temporary worktree of their own beside it; the service commits that work and picks it onto the candidate. Independent conversations may use separate candidates concurrently.\nAcceptance: seal a single-parent delivery commit on top of the verified target frontier, run declared checks and independent Agent review on that exact OID. A verified, non-overlapping sibling delivery may be incorporated before sealing, followed by fresh checks and review.\nDelivery: advance the task branch and fast-forward only into the bound target with that exact signed-off OID. Keep the task branch; unlink only owner-created managed dependency links after identity verification, remove owned worktrees only when completely free of any remaining residue (including ignored files), then remove private checkpoint refs. No source/profile/dependency copying, push or deployment.`;
  return `Target: ${t.branch} @ ${t.head}\nTarget checkout: ${t.checkoutRoot}\nExecution: new cadence/<goal>-<run-id> branch and one stable isolated worktree after approval. Assignments that can run side by side each work in a temporary worktree of their own beside it; the service commits that work and picks it onto the candidate. Independent conversations may use separate candidates concurrently.\nAcceptance: checks and automatic Agent review of the exact candidate. A verified, non-overlapping sibling delivery may be merged into the isolated candidate, followed by fresh checks and review.\nDelivery: serialized fast-forward only into the bound target at its approved, verified-sibling or own last confirmed baseline. Keep the task branch; remove only owned worktrees without any residue, including ignored files. No source/profile/dependency copying, push or deployment.`;
}
/** Display projection only. A missing seal is not proof of missing edits.
 * In an interrupted run pending facts may simply not have been recorded. */
export function deliveryLabels(
  d: DeliveryObservation,
  status: WorkflowRun["status"],
) {
  const finished = status !== "running" && status !== "queued";
  const settled = finished && status !== "unknown";
  const beforeWorkspace =
    settled && d.workspace === null && d.preparation === "pending";
  const pending = (value: string) =>
    value !== "pending" || !finished
      ? value
      : settled
        ? "Not executed"
        : "Not recorded";
  return {
    preparation:
      d.preparation === "pending" && finished && !beforeWorkspace
        ? "Not recorded"
        : pending(d.preparation),
    missingCandidate: beforeWorkspace ? "Not executed" : "Not recorded",
    integration:
      d.integration.status === "branch"
        ? "Not merged; delivered on the task branch"
        : pending(d.integration.status),
    cleanup: pending(d.cleanup.status),
  } as const;
}
export function readableDeliveryRun(run: WorkflowRun): string {
  const d = run.delivery;
  if (!d) return "";
  const labels = deliveryLabels(d, run.status);
  const checkpointLine =
    d.binding.policy !== "task-branch-v1" ||
    d.lastCheckpoint !== undefined ||
    d.checkpointCount !== undefined
      ? `\nLast confirmed checkpoint: ${d.lastCheckpoint ?? labels.missingCandidate}${d.checkpointCount ? ` (${d.checkpointCount} total)` : ""}`
      : "";
  return `Task branch: ${d.taskBranch}\nWorktree: ${d.worktreeRoot}\nTarget: ${d.binding.target.branch} @ ${d.binding.target.head}\nPreparation: ${labels.preparation}${checkpointLine}\nCandidate: ${d.candidate ?? labels.missingCandidate}\nAcceptance: ${d.acceptance ? `checks + automatic Agent review of ${d.acceptance.candidate}` : labels.missingCandidate}\nIntegration: ${labels.integration}${d.integration.after ? ` @ ${d.integration.after}` : ""}${d.integration.sync ? ` (${d.integration.sync.worktree ? `fast-forward in ${d.integration.sync.worktree}` : "branch reference only; no worktree had it checked out"})` : ""}${d.integration.reason ? ` — ${d.integration.reason}` : ""}${d.postChecks === undefined ? "" : `\nPost-merge checks: ${d.postChecks}`}\nWorktree cleanup: ${labels.cleanup}${d.cleanup.reason ? ` — ${d.cleanup.reason}` : ""}\nPolicy: keep the task branch; no push or deployment.`;
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
    ...(Object.hasOwn(v ?? {}, "revalidatedFrom") ? ["revalidatedFrom"] : []),
    ...(modern ? ["display"] : []),
  ]);
  return {
    ...(o.revalidatedFrom === undefined
      ? {}
      : { revalidatedFrom: decodeId(o.revalidatedFrom) }),
    ...(o.delivery === undefined
      ? {}
      : { delivery: decodeDeliveryPlacement(o.delivery) }),
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
      "planning",
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
          "planning",
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
            : s.kind === "check" && s.status === "not-run"
              ? "not-run"
              : s.kind === "planning" && s.status === "blocked"
                ? "blocked"
                : ["implementation", "knowledge"].includes(s.kind as string) &&
                    ["partial", "blocked"].includes(s.status as string)
                  ? oneOf(s.status, ["partial", "blocked"])
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
/** Version 4 agreements are shown as they were approved, target choice included. */
const readableCheck = (c: WorkflowCheck, version?: 4 | 5) =>
  `${c.name}${version === 4 ? ` [${c.tier ?? "fast"}, target:${c.target ?? "run"}]` : version === 5 ? ` [${c.tier ?? "fast"}]` : ""}: ${c.command} (${c.timeoutMs === undefined ? "no timeout" : `${c.timeoutMs}ms`})`;
const readableBuild = (b: WorkflowBuild) =>
  `${b.name}: ${b.command} (${b.timeoutMs === undefined ? "no timeout" : `${b.timeoutMs}ms`})${b.outputs.length ? ` -> outputs: ${b.outputs.join(", ")}` : ""}${b.refreshes?.length ? ` -> refreshes: ${b.refreshes.join(", ")}` : ""}`;
const readableLink = (l: WorkflowSetupLink) =>
  `[${l.placement ?? "worktree"}] ${l.path} -> ${l.source ?? l.path}`;
const readableReading = (r: WorkflowReading) =>
  "research" in r
    ? `investigation ${r.research} — ${r.reason}`
    : `${r.path}${r.section ? ` § ${r.section}` : ""} — ${r.reason}`;
/** What approval of each agreement version lets the owner do on its own. */
function readableAutomation(p: WorkflowPlan): string {
  if (p.version === 5)
    return `After approval the service works to completion without further confirmation. First, a readonly route planner inspects the isolated candidate and splits this agreement into parallelizable assignments, write scopes and review reads (validated against repository boundaries, Git-ignore rules and managed links before any edit). It then advances by remaining obligations, syncs declared builds after edits, runs fast checks fail-fast before heavy checks, and converges review by behavior family (escalating repeated counterexamples to architectural replan). It may on its own: continue or repair an incomplete assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report; otherwise, if no safe route succeeds, it retains the candidate unmerged. Declared checks always run on the exact final candidate; a check is set aside only through such a deviation, never silently. After behavior stabilizes it maintains the project's knowledge store under .cadence/ within its fixed budget (using no shell tools), reusing exact-OID evidence only when zero edits occur and re-verifying a new final commit when knowledge changes. Process logs, review ledgers and final workflow reports stay in private service records rather than repository commits. A target branch that moves while it works is followed, not a reason to stop. It stops for cancellation, uncertain settlement, or a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, or a required installation this agreement does not allow. ${p.policy?.installs ? "Revisions may add dependency-installation commands with the project's own package manager." : "No dependency installation beyond the setup commands listed here."}`;
  if (p.version === 4)
    return `After approval the service works to completion without further confirmation. It advances by remaining obligations, syncs declared builds after edits, runs fast checks fail-fast before heavy checks, and converges review by behavior family (escalating repeated counterexamples to architectural replan). It may on its own: continue or repair an incomplete assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report; otherwise, if no safe route succeeds, it retains the candidate unmerged. Declared checks always run on the exact final candidate; a check is set aside only through such a deviation, never silently. After behavior stabilizes it maintains the project's knowledge store under .cadence/ within its fixed budget (using no shell tools), reusing exact-OID evidence only when zero edits occur and re-verifying a new final commit when knowledge changes. Process logs, review ledgers and final workflow reports stay in private service records rather than repository commits. It stops for cancellation, uncertain settlement, external target drift, or a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, or a required installation this agreement does not allow. ${p.policy?.installs ? "Revisions may add dependency-installation commands with the project's own package manager." : "No dependency installation beyond the setup commands listed here."}`;
  if (p.version === 3)
    return `After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. ${p.policy?.installs ? "Revisions may add dependency-installation commands with the project's own package manager." : "No dependency installation beyond the setup commands listed here."}`;
  if (p.version === 2)
    return "Retained agreement (readonly): diagnosis, partial-work continuation, task splitting and alternative implementations within these goals, decisions, write paths and exact setup/check commands.";
  return `Historical fixed pipeline: at most ${p.repairAttempts} repair rounds.`;
}
export function readableWorkflowPlan(p: WorkflowPlan): string {
  const documents = workflowDocuments(p);
  const v5 = p.version === 5;
  const v4OrNewer = p.version === 4 || v5;
  const routeSection =
    v5 && !p.tasks.length
      ? `${p.areas?.length ? `\n\n## Focus areas (advisory for route planning)\n${p.areas.join("\n")}` : ""}${p.investigations?.length ? `\n\n## Investigations passed to route planning\n${p.investigations.join("\n")}` : ""}\n\n## Execution route\nPlanned automatically inside the isolated candidate after approval (readonly route-planner), validated against write boundaries, Git-ignore rules and managed links before editing.`
      : `\n\n## Tasks\n${workflowOrder(p.tasks)
          .map(
            (t) =>
              `### ${t.id}: ${t.title}\nDepends on: ${t.after.join(", ") || "none"}\nWrites: ${t.writes.join(", ")}${t.reads?.length ? `\nReads first: ${t.reads.map(readableReading).join("; ")}` : ""}\n${t.instructions}`,
          )
          .join("\n\n")}`;
  return `# ${p.goal}\n\n## Initial route (the service may revise it)\n${p.design}\n\n## Decisions\n${p.decisions}\n\n## Acceptance\n${p.acceptance}${
    p.version === 3 || v4OrNewer
      ? `\n\n## Assumptions (confirmed by approval)\n${p.assumptions || "None beyond the decisions above."}`
      : ""
  }${routeSection}\n\n## Setup (explicitly authorized commands)\nExecution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.\n${p.setup.map((c) => `[${c.placement ?? "worktree"}] ${readableCheck(c)}`).join("\n") || "None; no dependency installation or copying."}${
    v4OrNewer && p.links?.length
      ? `\n\n## Managed dependency links (owner-created, identity-verified unlink on cleanup)\n${p.links.map(readableLink).join("\n")}`
      : ""
  }${
    v4OrNewer && p.build?.length
      ? `\n\n## Build (owner-synced derived outputs)\n${p.build.map(readableBuild).join("\n")}`
      : ""
  }\n\n## Baseline verification\n${p.baselineChecks.map((c) => readableCheck(c)).join("\n") || "No separate baseline checks declared."}\n\n## Verification\n${p.checks.map((c) => readableCheck(c, v5 ? 5 : p.version === 4 ? 4 : undefined)).join("\n")}${
    p.reviewReads?.length
      ? `\n\n## Review reads first\n${p.reviewReads.map(readableReading).join("\n")}`
      : ""
  }\n\n## Automation boundary\n${readableAutomation(p)} Only actual verification and independent Agent review permit delivery. ${p.delivery === "local-merge" ? (v5 ? "Authorize one named task branch and detached development checkpoints in a stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, a single clean final delivery commit, and moving the displayed target branch to that exact checked and Agent-reviewed OID as the delivery placement describes. Keep the task branch; unlink only owner-created managed dependency links after identity verification, then remove owned worktrees only when completely free of any remaining residue, including ignored files." : v4OrNewer ? "Authorize one named task branch and detached development checkpoints in a stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, a single clean final delivery commit sealed onto the verified target frontier, and serialized fast-forward delivery of that exact checked and Agent-reviewed OID into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be incorporated before sealing the final candidate. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; unlink only owner-created managed dependency links after identity verification, then remove owned worktrees only when completely free of any remaining residue, including ignored files." : "Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and serialized fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be merged into this candidate and checked/reviewed again. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue.") : "Direct working-copy edits; failures leave actual edits for inspection. No Git commit or merge."} No push, publication, deployment or recursive delegation. ${v4OrNewer ? "Related project knowledge is included; workflow process reports stay in private service records." : "Related project knowledge and workflow Markdown are included."} Worktrees/tools are not a sandbox.\n\n## Project documents\n${
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
    `Checkout wait: ${d.acquiredAt === null ? "still waiting or not acquired" : `${Math.max(0, d.acquiredAt - d.acceptedAt)}ms`}. Readonly research shares access; isolated implementation holds no target checkout permit. Direct edits and final delivery are exclusive.`,
    ...run.steps.flatMap((s) =>
      s.timing
        ? [
            `${s.id}: preparing ${at(s.timing.createdAt)} · prepared ${at(s.timing.preparedAt)} · spawned ${at(s.timing.startedAt)} · stop ${at(s.timing.stopRequestedAt)} (${s.timing.stopReason ?? "none"}) · direct child closed ${at(s.timing.closedAt)} · settled ${at(s.timing.settledAt)} · ${s.timing.timeoutMs === undefined ? "no total runtime deadline" : `historical process budget ${s.timing.timeoutMs}ms`}${s.runtime ? ` · worker SDK ${s.runtime.sdkVersion} · worker hash ${s.runtime.workerHash}` : ""}`,
          ]
        : [],
    ),
  ].join("\n");
}
