/** Conversation workflow DTOs. Plans are data; only fresh user confirmation admits execution. */
import {
  bool,
  canonicalJson,
  closed,
  decodeHash,
  decodeId,
  integer,
  list,
  nullable,
  oneOf,
  text,
} from "./core.ts";
import {
  type ChoiceVersion,
  decodeChoiceVersion,
  decodeExecutionContext,
  type ExecutionContext,
} from "./models.ts";

export const WORKFLOW_LIMITS = {
  tasks: 16,
  /** Questions one research run may carry. How many run at once is the
   * owner's execution limit (`parallelLimit`), not a property of the plan. */
  questions: 8,
  checks: 16,
  bytes: 256 * 1024,
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
/** Where one assignment of the agreement stands. `completed` means its work is
 * in the candidate. */
export interface WorkflowTaskState {
  id: string;
  title: string;
  after: string[];
  state: "queued" | "running" | "completed" | "failed";
}
export interface WorkflowRun {
  /** New runs retain older step pages separately; this is a view offset, not eviction. */
  stepsBefore?: number;
  revision?: number;
  /** Repository paths that revisions brought into the write scope after approval. */
  scope?: string[];
  /** Where this delivery departs from the agreement, in recorded order. */
  deviations?: WorkflowDeviation[];
  /** The agreement's assignments and where each stands. */
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
    throw new Error("Invalid workflow file path");
  return p;
}
// Task IDs are worker assignment IDs and worktree names. New plans use the
// assignmentId bound (48); reads still accept retained 2.0.21 IDs (64).
const taskId = (v: unknown, strict = false) => {
  const s = text(v, 64, true);
  if (!/^[a-z][a-z0-9-]*$/u.test(s) || (strict && s.length > 48))
    throw new Error("Invalid task id");
  return s;
};
export function decodeWorkflowCheck(v: unknown): WorkflowCheck {
  const o = closed(v, [
    "name",
    "command",
    ...(Object.hasOwn(v ?? {}, "timeoutMs") ? ["timeoutMs"] : []),
  ]);
  return {
    name: text(o.name, 128, true),
    command: text(o.command, 4096, true),
    ...(o.timeoutMs === undefined
      ? {}
      : { timeoutMs: integer(o.timeoutMs, 100, 2_147_483_647) }),
  };
}
export function workflowOrder(tasks: WorkflowTask[]): WorkflowTask[] {
  const done = new Set<string>(),
    ordered: WorkflowTask[] = [];
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
    throw new Error("Duplicate task id");
  while (ordered.length < tasks.length) {
    const next = tasks.find(
      (t) => !done.has(t.id) && t.after.every((id) => done.has(id)),
    );
    if (!next) throw new Error("Missing dependency or cyclic plan");
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
 * for validating a new plan before publication or execution. */
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
  canonicalJson(v, WORKFLOW_LIMITS.bytes);
  const version = modern ? (v as { version?: unknown }).version : undefined;
  if (modern && version !== 2 && version !== 3)
    throw new Error("Unsupported delivery agreement version");
  const current = version === 3;
  if (strict && !current)
    throw new Error(
      "Publish a new delivery agreement; earlier agreements are readonly",
    );
  const o = closed(v, [
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
  const documentation = (value: unknown) =>
    list(value, 16, (entry) => {
      const path = workflowPath(entry, strict);
      if (!path.endsWith(".md"))
        throw new Error("Documentation targets must be Markdown files");
      return path;
    });
  const tasks = list(o.tasks, WORKFLOW_LIMITS.tasks, (value) => {
    const t = closed(value, [
      "id",
      "title",
      "instructions",
      "writes",
      "after",
      ...(current ? ["reads"] : []),
    ]);
    return {
      id: taskId(t.id, strict),
      title: text(t.title, 256, true),
      instructions: text(t.instructions, 8192, true),
      writes: list(t.writes, 128, (p: unknown) => workflowPath(p, strict)),
      after: list(t.after, WORKFLOW_LIMITS.tasks, (id: unknown) =>
        taskId(id, strict),
      ),
      ...(current ? { reads: decodeWorkflowReadings(t.reads, strict) } : {}),
    };
  });
  if (
    !tasks.length ||
    tasks.some(
      (t) =>
        !t.writes.length ||
        new Set(t.writes).size !== t.writes.length ||
        new Set(t.after).size !== t.after.length,
    )
  )
    throw new Error("Empty or duplicate task scope");
  workflowOrder(tasks);
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
  const checks = list(o.checks, WORKFLOW_LIMITS.checks, decodeWorkflowCheck);
  if (!checks.length)
    throw new Error("At least one real verification command is required");
  const result: WorkflowPlan = {
    goal: text(o.goal, 8192, true),
    design: text(o.design, 32768, true),
    decisions: text(o.decisions, 16384),
    acceptance: text(o.acceptance, 16384, true),
    ...(current
      ? {
          version: 3 as const,
          assumptions: text(o.assumptions, 16384),
          documents: documentation(o.documents),
          reviewReads: decodeWorkflowReadings(o.reviewReads, strict),
          policy: {
            installs: bool(closed(o.policy, ["installs"]).installs),
          },
        }
      : modern
        ? { version: 2 as const, knowledge: documentation(o.knowledge) }
        : {
            projectContext: text(o.projectContext, 16384),
            repairAttempts: integer(o.repairAttempts, 0, 2),
          }),
    tasks,
    checks,
    setup: list(o.setup, 4, decodeWorkflowCheck),
    baselineChecks: list(
      o.baselineChecks,
      WORKFLOW_LIMITS.checks,
      decodeWorkflowCheck,
    ),
    delivery: oneOf(o.delivery, ["local-merge", "working-copy"]),
  };
  workflowContext(result);
  text(workflowWrites(result).join(", "), 16384);
  for (const value of [
    result.goal,
    result.design,
    result.decisions,
    result.acceptance,
    result.assumptions ?? "",
    result.projectContext ?? "",
    ...[
      ...(result.reviewReads ?? []),
      ...result.tasks.flatMap((t) => t.reads ?? []),
    ].flatMap((r) => [r.reason, "section" in r ? (r.section ?? "") : ""]),
    ...result.tasks.flatMap((t) => [t.title, t.instructions]),
    ...[...result.checks, ...result.setup, ...result.baselineChecks].flatMap(
      (c) => [c.name, c.command],
    ),
  ])
    if (
      [...value].some(
        (c) =>
          (c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t") ||
          c.charCodeAt(0) === 127 ||
          /[\u202a-\u202e\u2066-\u2069]/u.test(c),
      )
    )
      throw new Error("Plan contains invisible terminal controls");
  return result;
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
): WorkflowReading[] {
  return list(value, 16, (entry): WorkflowReading => {
    if (Object.hasOwn((entry ?? {}) as object, "research")) {
      const r = closed(entry, ["research", "reason"]);
      return {
        research: decodeId(r.research),
        reason: text(r.reason, 512, true),
      };
    }
    const r = closed(entry, [
      "path",
      ...(Object.hasOwn((entry ?? {}) as object, "section") ? ["section"] : []),
      "reason",
    ]);
    return {
      path: workflowPath(r.path, strict),
      ...(r.section === undefined
        ? {}
        : { section: text(r.section, 256, true) }),
      reason: text(r.reason, 512, true),
    };
  });
}
export function workflowContext(p: WorkflowPlan): string {
  return text(
    `# ${p.goal}\n\nInitial route (${p.version === 3 ? "the owner may revise it" : "adapt within the approved boundary"}): ${p.design}\n\nExplicit decisions and non-goals: ${p.decisions}${p.assumptions ? `\n\nAssumptions confirmed with the agreement: ${p.assumptions}` : ""}\n\nAcceptance: ${p.acceptance}`,
    32768,
    true,
  );
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
          tasks: list(o.tasks, WORKFLOW_LIMITS.tasks, (value) => {
            const t = closed(value, ["id", "title", "after", "state"]);
            return {
              id: taskId(t.id),
              title: text(t.title, 256, true),
              after: list(t.after, WORKFLOW_LIMITS.tasks, (id) => taskId(id)),
              state: oneOf(t.state, [
                "queued",
                "running",
                "completed",
                "failed",
              ] as const),
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
