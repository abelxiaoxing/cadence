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
import { type ChoiceVersion, decodeChoiceVersion } from "./models.ts";

export const WORKFLOW_LIMITS = {
  tasks: 16,
  parallel: 2,
  checks: 16,
  repairs: 2,
  bytes: 256 * 1024,
  runs: 200,
  durationMs: 90 * 60 * 1000,
} as const;
export interface WorkflowCheck {
  name: string;
  command: string;
  timeoutMs: number;
}
export interface WorkflowTask {
  id: string;
  title: string;
  instructions: string;
  writes: string[];
  after: string[];
}
export interface WorkflowPlan {
  goal: string;
  design: string;
  decisions: string;
  acceptance: string;
  projectContext: string;
  tasks: WorkflowTask[];
  checks: WorkflowCheck[];
  setup: WorkflowCheck[];
  baselineChecks: WorkflowCheck[];
  repairAttempts: number;
  delivery: "local-merge" | "working-copy";
}
export interface WorkflowProposal {
  id: string;
  epoch: string;
  digest: string;
  observation: string;
  model: ChoiceVersion;
  plan: WorkflowPlan;
  cwd: string;
  display?: { model: string; branch: string; baseCommit: string };
}
export interface WorkflowStep {
  id: string;
  childRunId?: string;
  kind: "research" | "implementation" | "review" | "check" | "git";
  status:
    | "running"
    | "completed"
    | "failed"
    | "canceled"
    | "timeout"
    | "unknown";
  text: string;
  exitCode: number | null;
  truncated: boolean;
}
export interface WorkflowRun {
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
  const o = closed(v, ["name", "command", "timeoutMs"]);
  return {
    name: text(o.name, 128, true),
    command: text(o.command, 4096, true),
    timeoutMs: integer(o.timeoutMs, 100, 1_200_000),
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
  canonicalJson(v, WORKFLOW_LIMITS.bytes);
  const o = closed(v, [
    "goal",
    "design",
    "decisions",
    "acceptance",
    "projectContext",
    "tasks",
    "checks",
    "setup",
    "baselineChecks",
    "repairAttempts",
    "delivery",
  ]);
  const tasks = list(o.tasks, WORKFLOW_LIMITS.tasks, (value) => {
    const t = closed(value, ["id", "title", "instructions", "writes", "after"]);
    return {
      id: taskId(t.id, strict),
      title: text(t.title, 256, true),
      instructions: text(t.instructions, 8192, true),
      writes: list(t.writes, 128, (p: unknown) => workflowPath(p, strict)),
      after: list(t.after, WORKFLOW_LIMITS.tasks, (id: unknown) =>
        taskId(id, strict),
      ),
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
  for (const a of tasks)
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
    projectContext: text(o.projectContext, 16384),
    tasks,
    checks,
    setup: list(o.setup, 4, decodeWorkflowCheck),
    baselineChecks: list(
      o.baselineChecks,
      WORKFLOW_LIMITS.checks,
      decodeWorkflowCheck,
    ),
    repairAttempts: integer(o.repairAttempts, 0, WORKFLOW_LIMITS.repairs),
    delivery: oneOf(o.delivery, ["local-merge", "working-copy"]),
  };
  workflowContext(result);
  text(result.tasks.flatMap((t) => t.writes).join(", "), 16384);
  for (const value of [
    result.goal,
    result.design,
    result.decisions,
    result.acceptance,
    result.projectContext,
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
export function workflowContext(p: WorkflowPlan): string {
  return text(
    `# ${p.goal}\n\n${p.design}\n\nDecisions: ${p.decisions}\n\nAcceptance: ${p.acceptance}`,
    32768,
    true,
  );
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
    ...(modern ? ["display"] : []),
  ]);
  return {
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    digest: decodeHash(o.digest),
    observation: decodeHash(o.observation),
    model: decodeChoiceVersion(o.model),
    plan: decodeWorkflowPlan(o.plan),
    cwd: text(o.cwd, 4096, true),
    ...(modern
      ? {
          display: (() => {
            const d = closed(o.display, ["model", "branch", "baseCommit"]);
            return {
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
    const o = closed(v, ["action", "goal", "questions", "model"]);
    const questions = list(o.questions, WORKFLOW_LIMITS.parallel, (q) =>
      text(q, 8192, true),
    );
    if (!questions.length) throw new Error("Research needs a question");
    return {
      action,
      goal: text(o.goal, 8192, true),
      questions,
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
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    goal: text(o.goal, 8192),
    status: o.status === "queued" ? "queued" : status(o.status),
    phase: oneOf(o.phase, [
      "research",
      "implementing",
      "verifying",
      "reviewing",
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
        ...(linked ? ["childRunId"] : []),
      ]);
      return {
        id: text(s.id, 160, true),
        ...(linked ? { childRunId: decodeId(s.childRunId) } : {}),
        kind: oneOf(s.kind, [
          "research",
          "implementation",
          "review",
          "check",
          "git",
        ]),
        status: status(s.status),
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
export function readableWorkflowPlan(p: WorkflowPlan): string {
  return `# ${p.goal}\n\n## Design\n${p.design}\n\n## Decisions\n${p.decisions}\n\n## Acceptance\n${p.acceptance}\n\n## Tasks\n${workflowOrder(
    p.tasks,
  )
    .map(
      (t) =>
        `### ${t.id}: ${t.title}\nDepends on: ${t.after.join(", ") || "none"}\nWrites: ${t.writes.join(", ")}\n${t.instructions}`,
    )
    .join(
      "\n\n",
    )}\n\n## Setup (explicitly authorized commands)\n${p.setup.map((c) => `${c.name}: ${c.command} (${c.timeoutMs}ms)`).join("\n") || "None; no dependency installation or copying."}\n\n## Baseline verification\n${p.baselineChecks.map((c) => `${c.name}: ${c.command} (${c.timeoutMs}ms)`).join("\n") || "No separate baseline checks declared."}\n\n## Verification\n${p.checks.map((c) => `${c.name}: ${c.command} (${c.timeoutMs}ms)`).join("\n")}\n\n## Automation boundary\nAt most ${p.repairAttempts} repair rounds. ${p.delivery === "local-merge" ? "Authorize isolated task worktrees, local task commits and fast-forward integration into the current branch." : "Direct working-copy edits; failures leave actual edits for inspection. No Git commit or merge."} No push, publication, deployment, unplanned installation or recursive delegation. Generated project context and workflow Markdown are included. Worktrees/tools are not a sandbox.\n\n## Project context\n${p.projectContext}\n`;
}
