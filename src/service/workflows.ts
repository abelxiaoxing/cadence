/** Persistent conversation workflow coordinator. Clients never own execution. */
import { randomUUID } from "node:crypto";
import { opendirSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentDefinitions } from "../agent-registry.ts";
import { launchWorkflowWorker, runProcess } from "../subagent-process.ts";
import { captureChanges } from "../task-diff.ts";
import type { RunResult } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { describeWorkerRuntime, type WorkerRuntime } from "../worker-model.mjs";
import {
  type CheckNativeSettlement,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
} from "../worker-public.mjs";
import { sanitizeData, sanitizeText } from "../worker-redaction.mjs";
import { executionDirectory } from "../worker-workspace.mjs";
import {
  gitArguments,
  gitEnvironment,
  resolveWorkspace,
  safeDirectory,
  withinWorkspace,
} from "../workspace.ts";
import type { CheckoutGate, CheckoutPermit } from "./checkout-gate.ts";
import { managedActivity } from "./contracts/activity.ts";
import {
  ContractError,
  canonicalJson,
  closed,
  decodeId,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import type { ChoiceVersion, ExecutionContext } from "./contracts/models.ts";
import {
  type ChatTurn,
  decodeChatTurn,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import {
  clipUnits,
  decodeDeliveryObservation,
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  decodeWorkflowRequest,
  decodeWorkflowRun,
  readableWorkflowPlan,
  WORKFLOW_DEVIATIONS,
  WORKFLOW_LIMITS,
  type WorkflowCheck,
  type WorkflowPlan,
  type WorkflowProposal,
  type WorkflowRequest,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowTask,
  type WorkflowTaskState,
  workflowBoundary,
  workflowContext,
  workflowCovers,
  workflowDocuments,
  workflowOrder,
  workflowWrites,
} from "./contracts/workflow.ts";
import { ConversationContexts } from "./conversation-contexts.ts";

import type { ServiceCoordination } from "./coordination.ts";
import {
  KNOWLEDGE_SCOPE,
  KNOWLEDGE_STORE,
  lintKnowledge,
} from "./knowledge-store.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { type FileSnapshot, hash } from "./private-files.ts";
import {
  curationInstructions,
  type KnowledgeNamed,
  projectKnowledge,
} from "./project-knowledge.ts";
import { RepositoryCoordination } from "./repository-coordination.ts";
import { UnacceptedConversationCommand } from "./workbench-send-refusal.ts";
import {
  AttemptFailure,
  DeliveryController,
  decodeRecoveryDecision,
  InvalidDecision,
  modelRequestFailed,
  RECOVERY_BYTES,
  RECOVERY_INSTRUCTIONS,
  type RecoveryDecision,
  type RecoveryRoute,
  revisedRoute,
  settledWorkerCleanup,
} from "./workflow-controller.ts";
import {
  acceptanceRecord,
  deliveryObservation,
  WorkflowDelivery,
} from "./workflow-delivery.ts";
import {
  assertCandidate,
  assertCommittedScope,
  assertRepository,
  assertTarget,
  assertWorkflowCommit,
  assertWorkflowScope,
  assertWorktree,
  changedPaths,
  committedPaths,
  contentsIdentity,
  contentsIdentityAsync,
  deliveryTarget,
  documentPlacement,
  gitHead,
  gitRun,
  gitText,
  pathIdentity,
  safeWorkflowFile,
  snapshotChanges,
  sourceIdentityAsync,
  tracked,
  WorkflowRefusal,
  workflowObservation,
  workingSnapshot,
} from "./workflow-git.ts";
import { WorkflowHistoryScanner } from "./workflow-history.ts";
import {
  implementationReport,
  reviewReport,
  reviewVerdict,
  WorkflowTranscript,
} from "./workflow-report.ts";
import { workflowResult, workflowResultDetail } from "./workflow-result.ts";

declare const __CADENCE_SERVICE_VERSION__: string;
declare const __CADENCE_SERVICE_SOURCE__: string;
const OWNER_RUNTIME = Object.freeze({
  version:
    typeof __CADENCE_SERVICE_VERSION__ === "undefined"
      ? "source"
      : __CADENCE_SERVICE_VERSION__,
  build:
    typeof __CADENCE_SERVICE_SOURCE__ === "undefined"
      ? "unbundled"
      : __CADENCE_SERVICE_SOURCE__,
  entry: fileURLToPath(import.meta.url),
  pid: process.pid,
  node: process.versions.node,
  platform: process.platform,
  startedAt: Math.round(Date.now() - process.uptime() * 1000),
});
const RECORD_BYTES = 384 * 1024;
/** Leaves room for the maximum write scope in a 32 KiB review/repair prompt. */
const EVIDENCE_BYTES = 8192;
const MAX_STEPS = 256;
const STEP_UNITS = 80;
const MAX_ACTIVE = 4;
/** Workflow workers of one run that may be in flight at once. The plan decides
 * what can run side by side; this bounds how much does on this machine (model
 * throughput, provider rate limits, memory). `CADENCE_PARALLEL` sets it. */
export const PARALLEL = { default: 4, maximum: 16 } as const;
/** A whole number from 1 is used, capped at the maximum; anything else is the
 * default. A tuning value never prevents an owner from starting. */
export function parallelLimit(environment: NodeJS.ProcessEnv): number {
  const raw = environment.CADENCE_PARALLEL ?? "";
  return /^[1-9][0-9]{0,3}$/u.test(raw)
    ? Math.min(Number(raw), PARALLEL.maximum)
    : PARALLEL.default;
}
/** Runs the tasks in order, at most `limit` at a time, and reports every
 * settlement in input order. It never rejects: the caller joins all of them
 * before failing. After the first rejection no further task is started. */
export async function settleLimited<T>(
  limit: number,
  tasks: readonly (() => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0,
    failed = false;
  const lane = async () => {
    for (let index = next++; index < tasks.length; index = next++) {
      if (failed) {
        settled[index] = {
          status: "rejected",
          reason: new ContractError("stale"),
        };
        continue;
      }
      try {
        settled[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        failed = true;
        settled[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, lane),
  );
  return settled;
}
/** Private-worktree Git operations: realistic for large repositories. */
const RESTARTED =
  "Interrupted: Cadence stopped before this run finished (machine restart, crash or automatic recovery). Nothing was replayed; its worktrees and any partial edits are kept for inspection. Start it again to continue.";
const FINAL_UNAVAILABLE =
  "The final message exceeded the retained transcript bound and was not retained.";

interface Options {
  contexts?: ConversationContexts;
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  gate: CheckoutGate;
  cwd: string;
  checkEnvironment?: Readonly<NodeJS.ProcessEnv>;
  /** Workflow workers of one run in flight at once; defaults to `PARALLEL`. */
  parallel?: number;
  secrets(): readonly string[];
}
interface Live {
  runtime: WorkerRuntime;
  execution: ExecutionContext;
  run: WorkflowRun;
  abort: AbortController;
  file?: FileSnapshot;
  original: Promise<AcceptedWorkResult>;
  proposal?: WorkflowProposal;
  delivery?: WorkflowDelivery;
  /** Target observed at admission (local-merge) or declared-target identity (working copy). */
  target?: { head: string; branch: string };
  declared?: string;
  delivered: Set<string>;
  notes: string[];
  controllers?: Map<string, DeliveryController>;
  /** Tail of this run's serialized Git steps. */
  git?: Promise<void>;
  /** The current route while assignments are scheduled: the agreement's, as
   * plan revisions left them. `revise` applies a recorded revision. */
  route?: {
    tasks: WorkflowTask[];
    revise(route: RecoveryRoute, revision: number): string;
  };
  /** Write paths each running assignment owns, by its working tree. */
  owned?: Map<string, string[]>;
  /** This delivery maintains the project's knowledge store. */
  managed?: boolean;
  knowledgeDone?: boolean;
  barrier?: CheckoutPermit;
}
type Verdict = "approved" | "rejected" | "unparseable";
/** A native workflow command refused before any record or admission of its
 * identity, by a healthy owner: provably without effect. */
export class UnacceptedWorkflowCommand extends UnacceptedConversationCommand {
  constructor(
    code: ConstructorParameters<typeof ContractError>[0],
    readonly detail?: string,
  ) {
    super(code);
  }
}
class WorkflowFailure extends Error {
  constructor(
    readonly outcome: RunResult["outcome"],
    message: string,
    /** The recorded step this failure settled, when one did. */
    readonly step?: string,
  ) {
    super(message);
  }
}

/** UTF-8 byte clip that never leaves a partial code point. */
function clipBytes(value: string, maximum: number): string {
  if (Buffer.byteLength(value) <= maximum) return value;
  return Buffer.from(value)
    .subarray(0, maximum)
    .toString("utf8")
    .replace(/�+$/u, "");
}
const IMPLEMENTATION_REPORT = `After all tools, call cadence_report with status completed or blocked and a concrete summary of actual work and remaining gaps. Then give a short final answer. The report is not passing check evidence; the owner verifies and reviews independently. Never claim completion just because a tool exited zero.`;

export class Workflows {
  private readonly historyScanner: WorkflowHistoryScanner;
  private readonly root: string;
  private readonly cwd: string;
  private readonly contexts: ConversationContexts;
  private readonly worktreeRoot: string;
  private readonly active = new Map<string, Live>();
  private readonly grants = new Map<
    string,
    { commandId: string; proposalId: string; digest: string; expiresAt: number }
  >();
  constructor(private readonly o: Options) {
    this.contexts = o.contexts ?? new ConversationContexts(o);
    this.root = join(o.coordination.directory, "workflows-v1");
    this.cwd = realpathSync(o.coordination.store.root);
    // Outside the private service namespace (access material, journals): a
    // worker's relative path from its worktree cannot land on them.
    this.worktreeRoot = join(
      o.coordination.stateHome,
      "cadence-worktrees-v1",
      basename(o.coordination.store.privateRoot),
    );
    this.historyScanner = new WorkflowHistoryScanner(
      join(this.root, "runs"),
      () => {
        this.o.owner.lease.assert();
        return this.files.directory(join(this.root, "runs"));
      },
    );
    this.recover();
  }
  private get files() {
    return this.o.coordination.files;
  }
  private path(id: string, name: string) {
    return join(this.root, "runs", decodeId(id), name);
  }
  private write(
    path: string,
    value: unknown,
    expected?: FileSnapshot,
    max = RECORD_BYTES,
  ): FileSnapshot {
    this.o.owner.lease.assert();
    const body = canonicalJson(value, max);
    try {
      return expected
        ? this.files.replace(path, expected, body, max)
        : this.files.create(path, body, max);
    } catch (e) {
      this.o.owner.quarantine();
      throw e;
    }
  }
  private notice(...parts: string[]): string {
    return diagnosticText(
      parts.filter(Boolean).join("\n"),
      2048,
      this.o.secrets(),
    );
  }
  /** Interrupted runs settle as `unknown`: never a startup fence, never a replay. */
  private recover(): void {
    const runs = join(this.root, "runs");
    if (!this.files.directory(runs)) return;
    const ids: string[] = [];
    const dir = opendirSync(runs);
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (!e.isDirectory()) continue;
        try {
          ids.push(decodeId(e.name));
        } catch {
          /* Unexpected entries are retained, not interpreted. */
        }
      }
    } finally {
      dir.closeSync();
    }
    for (const id of ids) this.settleInterrupted(id);
  }
  /** Unreadable retained bytes are left untouched and refused on selection; only
   * a failed write of the settled snapshot (storage) stops startup. */
  private retained(path: string): FileSnapshot | null | undefined {
    try {
      return this.files.read(path, RECORD_BYTES);
    } catch {
      return null;
    }
  }
  private settleInterrupted(id: string): void {
    const path = this.path(id, "state.json");
    const file = this.retained(path);
    if (file === null) return;
    if (!file) {
      const accepted = this.retained(this.path(id, "accepted.json"));
      if (!accepted) return;
      let run: WorkflowRun;
      try {
        const o = closed(
          parseWireJson(accepted.bytes.toString("utf8"), RECORD_BYTES),
          ["epoch", "request"],
        );
        const request = decodeWorkflowRequest(o.request);
        let goal = request.action === "research" ? request.goal : "";
        if (request.action === "execute")
          try {
            goal = this.proposal(request.proposalId).plan.goal;
          } catch {
            /* The run identity still settles honestly without a goal. */
          }
        run = {
          id,
          epoch: decodeId(o.epoch),
          goal,
          status: "unknown",
          phase: "finished",
          steps: [],
          notice: RESTARTED,
          mergedCommit: null,
          humanReviewed: false,
        };
      } catch {
        return; // Corrupt retained bytes stay as they are; selection refuses them.
      }
      this.write(path, run);
      return;
    }
    let run: WorkflowRun;
    try {
      run = decodeWorkflowRun(
        parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
      );
    } catch {
      return;
    }
    if (
      run.id !== id ||
      (!["queued", "running"].includes(run.status) && run.phase === "finished")
    )
      return;
    const integrating = run.phase === "integrating";
    run.status = "unknown";
    run.phase = "finished";
    if (run.delivery) {
      if (run.delivery.preparation === "pending")
        run.delivery.preparation = "unknown";
      if (run.delivery.integration.status === "applying") {
        run.delivery.integration.status = "unknown";
        run.delivery.integration.reason =
          "Owner restarted during integration; observe the target, never replay.";
      }
      run.delivery.cleanup = {
        status: "retained",
        reason:
          "Owner restarted; artifacts retained without replay or cleanup.",
      };
      if (run.delivery.workspace && run.delivery.workspace.state !== "removed")
        run.delivery.workspace.state = "retained";
      for (const child of run.delivery.artifacts ?? [])
        if (child.state !== "removed") child.state = "retained";
    }
    for (const task of run.tasks ?? [])
      if (task.state === "running") task.state = "failed";
    for (const step of run.steps)
      if (step.status === "running") step.status = "unknown";
    // Startup runs before model sources load: no secret projection here. The
    // retained notice was sanitized when written; the additions are fixed text.
    run.notice = diagnosticText(
      [
        run.notice,
        RESTARTED,
        integrating
          ? "Integration had started: inspect the target branch; a fast-forward may have completed."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      2048,
    );
    this.write(path, run, file);
  }
  private current(): void {
    this.o.owner.lease.assert();
    if (
      this.o.owner.state !== "idle" ||
      resolveWorkspace(this.o.coordination.store.root).root !== this.cwd
    )
      throw new ContractError("quarantine");
  }
  private floor(): void {
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
  }
  /** Fresh conversation choice is checked only at admission. Accepted work uses
   * its own snapshot through implementation, review, repairs and publication. */
  private model(version: ChoiceVersion) {
    const execution = this.contexts.capture(version);
    if (!execution.model) throw new ContractError("stale");
    return execution.model;
  }
  private executionCwd(live: Live, tree: string): string {
    if (live.execution.checkoutRoot !== this.cwd)
      throw new ContractError("stale");
    let cwd: string;
    try {
      cwd = executionDirectory(live.execution, tree);
    } catch {
      throw new ContractError("stale");
    }
    if (!withinWorkspace(tree, cwd)) throw new ContractError("stale");
    // Git does not track empty/untracked directories. Recreate only their
    // empty location in an existing isolated tree, never copy source profiles
    // or recreate a missing user checkout/worktree root.
    if (tree !== this.cwd) {
      if (!safeDirectory(tree)) throw new ContractError("stale");
      safeDirectory(cwd, true);
    }
    if (realpathSync(cwd) !== cwd) throw new ContractError("stale");
    return cwd;
  }
  private observation(plan: WorkflowPlan, runtime: WorkerRuntime) {
    const source = workflowObservation(this.cwd, plan);
    const delivery =
      plan.delivery === "local-merge"
        ? {
            policy: "task-branch-v1" as const,
            target: deliveryTarget(this.cwd, source),
          }
        : undefined;
    return {
      source,
      delivery,
      digest: hash(
        canonicalJson({
          runtime,
          source,
          delivery: delivery ?? null,
          working:
            plan.delivery === "working-copy"
              ? captureChanges(this.cwd).fingerprint
              : null,
        }),
      ),
    };
  }
  proposal(id: string): WorkflowProposal {
    const file = this.files.read(
      join(this.root, "proposals", `${decodeId(id)}.json`),
      RECORD_BYTES,
    );
    if (!file) throw new ContractError("unavailable");
    return decodeWorkflowProposal(
      parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
    );
  }
  /** Full consent observation at prepare/execute admission. */
  private assertProposal(p: WorkflowProposal, digest: string) {
    this.current();
    // Retained proposals still read; executing one needs the current rules.
    try {
      decodeWorkflowPlan(p.plan, { strict: true });
    } catch {
      throw new WorkflowRefusal(
        "invalid",
        "This retained proposal predates self-revising delivery. Publish a current delivery agreement; nothing was started.",
      );
    }
    const selected = this.model(p.model);
    const runtime = this.o.models.workerSettings(
      this.contexts.capture(p.model).cwd,
      selected,
    );
    const observed = this.observation(p.plan, runtime);
    if (p.plan.delivery === "local-merge" && !p.delivery)
      throw new WorkflowRefusal(
        "invalid",
        "Publish a new delivery agreement with explicit named-branch placement before execution.",
      );
    if (
      p.epoch !== this.o.owner.lease.registration.epoch ||
      p.digest !== digest ||
      p.cwd !== this.contexts.capture(p.model).cwd ||
      (p.checkoutRoot !== undefined && p.checkoutRoot !== this.cwd) ||
      observed.digest !== p.observation ||
      p.display?.runtime !== describeWorkerRuntime(runtime) ||
      canonicalJson(observed.delivery ?? null) !==
        canonicalJson(p.delivery ?? null) ||
      p.digest !==
        hash(
          canonicalJson(
            p.delivery ? { plan: p.plan, delivery: p.delivery } : p.plan,
          ),
        )
    )
      throw new ContractError("stale");
    return { source: observed.source, runtime };
  }
  private projectDelivery(run: WorkflowRun): WorkflowRun {
    return run.delivery
      ? {
          ...run,
          delivery: decodeDeliveryObservation(
            JSON.parse(sanitizeData(run.delivery, this.o.secrets())),
          ),
        }
      : run;
  }
  activity() {
    return [...this.active.values()].map((live) =>
      managedActivity({
        id: live.run.id,
        source: "workflow",
        execution: live.execution,
        root: this.o.coordination.store.root,
        epoch: live.run.epoch,
        now: Date.now(),
        executionCwd: live.run.delivery?.worktreeRoot ?? null,
        phase: live.abort.signal.aborted
          ? "stopping"
          : live.run.status === "queued"
            ? "queued"
            : live.run.phase === "finished"
              ? "settling"
              : live.run.phase,
      }),
    );
  }
  activeRuns(): WorkbenchResult & { kind: "workflow-active" } {
    this.o.owner.lease.assert();
    return {
      kind: "workflow-active",
      runs: [...this.active.values()].map(({ run }) => ({
        ...this.projectDelivery(structuredClone(run)),
        goal: clipUnits(run.goal, 320),
        steps: [],
      })),
    };
  }
  /** Bounded readonly listing. Progress is not an empty or complete page. */
  history(
    after: string | null,
    scan?: string,
  ): Extract<
    WorkbenchResult,
    { kind: "workflow-history" | "workflow-history-progress" }
  > {
    const selected = this.historyScanner.read(after, scan);
    if (selected.kind === "workflow-history-progress") return selected;
    const remaining = selected.ids;
    const entries = remaining
      .slice(0, WORKFLOW_LIMITS.historyPage)
      .map((id) => {
        try {
          const view = this.view(id);
          if (view.kind !== "workflow" || view.response.type !== "run")
            throw new ContractError("invalid");
          const run = view.response.run;
          return {
            id,
            run: {
              ...run,
              goal: clipUnits(sanitizeText(run.goal, this.o.secrets()), 320),
              notice: this.notice(run.notice),
              steps: [],
            },
          };
        } catch {
          return { id, run: null };
        }
      });
    return {
      kind: "workflow-history",
      entries,
      next: selected.next,
    };
  }
  closeHistory(): void {
    this.historyScanner.close();
  }
  async join(id: string): Promise<void> {
    await this.active.get(id)?.original;
  }
  view(id: string, before?: number): WorkbenchResult {
    this.o.owner.lease.assert();
    const live = this.active.get(id);
    const file = live
      ? undefined
      : this.files.read(this.path(id, "state.json"), RECORD_BYTES);
    if (!live && !file) throw new ContractError("unavailable");
    const run = decodeWorkflowRun(
      live
        ? live.run
        : parseWireJson(
            file ? file.bytes.toString("utf8") : "null",
            RECORD_BYTES,
          ),
    );
    if (run.id !== id) throw new ContractError("corrupt-selected");
    if (before !== undefined) {
      const end = run.stepsBefore ?? 0;
      if (!Number.isSafeInteger(before) || before < 1 || before > end)
        throw new ContractError("invalid");
      const offset =
        Math.floor((before - 1) / (MAX_STEPS / 2)) * (MAX_STEPS / 2);
      const page = this.stepPage(id, offset);
      run.steps = page;
      run.stepsBefore = offset;
    }
    if (!live && ["running", "queued"].includes(run.status))
      run.status = "unknown";
    // Like detail/transcript reads, previews must use today's known secrets,
    // including archived pages written before a literal became sensitive.
    const secrets = this.o.secrets();
    run.goal = diagnosticText(run.goal, 8192, secrets);
    run.notice = this.notice(run.notice);
    for (const step of run.steps) {
      const clean = sanitizeText(step.text, secrets);
      step.text = diagnosticText(clean, 65536);
      step.truncated ||= Buffer.byteLength(clean) > 65536;
      if (step.runtime)
        step.runtime.sdkVersion = diagnosticText(
          step.runtime.sdkVersion,
          128,
          secrets,
        );
    }
    return {
      kind: "workflow",
      commandId: null,
      response: { type: "run", run: this.projectDelivery(run) },
    };
  }
  private stepPage(id: string, offset: number): WorkflowStep[] {
    const file = this.files.read(
      this.path(id, `pages/${offset}.json`),
      RECORD_BYTES,
    );
    if (!file) throw new ContractError("unavailable");
    const page = closed(
      parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
      ["offset", "steps"],
    );
    if (page.offset !== offset) throw new ContractError("corrupt-selected");
    // Reuse the public step decoder without fabricating execution observations.
    return decodeWorkflowRun({
      id,
      epoch: id,
      goal: "",
      status: "completed",
      phase: "finished",
      steps: page.steps,
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    }).steps;
  }
  private findStep(run: WorkflowRun, id: string): WorkflowStep | undefined {
    const current = run.steps.find((s) => s.id === id);
    if (current) return current;
    const file = this.files.read(
      this.path(run.id, `members/${hash(id)}.json`),
      RECORD_BYTES,
    );
    if (!file) return;
    const member = closed(
      parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
      ["id", "offset"],
    );
    if (
      member.id !== id ||
      !Number.isSafeInteger(member.offset) ||
      (member.offset as number) < 0 ||
      (member.offset as number) >= (run.stepsBefore ?? 0)
    )
      throw new ContractError("corrupt-selected");
    return this.stepPage(run.id, member.offset as number).find(
      (s) => s.id === id,
    );
  }
  transcript(id: string, stepId: string): WorkbenchResult {
    const view = this.view(id);
    if (view.kind !== "workflow" || view.response.type !== "run")
      throw new ContractError("unavailable");
    const run = view.response.run,
      step = this.findStep(run, stepId);
    if (!step?.childRunId) throw new ContractError("unavailable");
    const file = this.files.read(
      this.path(id, `transcripts/${step.childRunId}.json`),
      RECORD_BYTES,
    );
    const turn = file
      ? decodeChatTurn(parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES))
      : null;
    if (turn && (turn.id !== step.childRunId || turn.epoch !== run.epoch))
      throw new ContractError("corrupt-selected");
    if (turn) {
      // Like detail(): currently known literals are filtered on every read,
      // including records retained before they were known. Never rewritten.
      const secrets = this.o.secrets();
      const clean = (value: string, maximum: number) =>
        clipBytes(sanitizeText(value, secrets), maximum);
      turn.notice = clean(turn.notice, 1024);
      for (const item of turn.items) {
        item.text = clean(item.text, 256 * 1024);
        item.name = clean(item.name, 128);
        item.args = clean(item.args, 64 * 1024);
      }
      if (turn.status === "running" && step.status !== "running") {
        turn.status = "unknown";
        turn.notice =
          "Retained transcript is incomplete; original activity is not inferred.";
      }
      if (turn.status !== "running" || run.status !== "running")
        delete turn.retry;
    }
    return { kind: "workflow-transcript", runId: id, stepId, turn };
  }
  detail(id: string, stepId: string): WorkbenchResult {
    const view = this.view(id);
    if (
      view.kind !== "workflow" ||
      view.response.type !== "run" ||
      !this.findStep(view.response.run, stepId)
    )
      throw new ContractError("invalid");
    const file = this.files.read(
      this.path(id, `results/${hash(stepId)}.json`),
      RECORD_BYTES,
    );
    if (!file) throw new ContractError("unavailable");
    // Read projection protects pre-fix records and newly known literals, and
    // budgets their encoded size again after redaction. Never rewrite history.
    return {
      kind: "file",
      path: `workflow/${id}/${stepId}`,
      ...workflowResultDetail(
        parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
        this.o.secrets(),
      ),
    };
  }
  /** Cancel is an observation plus a stop request; it stays available while the
   * owner is quarantined or stopping (which have already requested stops). */
  private cancel(commandId: string, epoch: string, runId: string) {
    this.o.owner.lease.assert();
    if (epoch !== this.o.owner.lease.registration.epoch)
      throw new ContractError("stale");
    this.active
      .get(runId)
      ?.abort.abort({ source: "user", reason: "cancel", target: runId });
    return { ...this.view(runId), commandId } as WorkbenchResult;
  }
  /** `definite` is for callers whose own command identity is this one (the
   * native workflow route): a refusal is then reported as having had no effect
   * only when that is provable. Callers that already recorded evidence for
   * this identity (browser approval) must not request it. */
  command(
    commandId: string,
    epoch: string,
    r: WorkflowRequest,
    options: { definite?: boolean } = {},
  ): WorkbenchResult {
    if (r.action === "cancel") return this.cancel(commandId, epoch, r.runId);
    if (!options.definite) return this.admit(commandId, epoch, r, () => {});
    let effects = true;
    try {
      effects =
        this.o.owner.state !== "idle" || this.attempted(commandId, r.action);
      return this.admit(commandId, epoch, r, () => {
        effects = true;
      });
    } catch (error) {
      if (
        !effects &&
        error instanceof ContractError &&
        !(error instanceof UnacceptedConversationCommand) &&
        this.o.owner.state === "idle"
      )
        throw new UnacceptedWorkflowCommand(
          error.code,
          error instanceof WorkflowRefusal ? error.detail : undefined,
        );
      throw error;
    }
  }
  /** Any earlier record of this command identity makes a refusal uncertain:
   * a retry must observe the original, never be reported as unattempted. */
  private attempted(commandId: string, action: WorkflowRequest["action"]) {
    const id = decodeId(commandId);
    if (this.active.has(id)) return true;
    if (action === "prepare")
      // A prepare leaves only an in-memory grant; an unexpired one is its record.
      return [...this.grants.values()].some(
        (g) => g.commandId === id && g.expiresAt >= Date.now(),
      );
    if (action === "propose")
      return !!this.files.read(
        join(this.root, "proposals", `${id}.json`),
        RECORD_BYTES,
      );
    return this.files.directory(join(this.root, "runs", id));
  }
  private admit(
    commandId: string,
    epoch: string,
    r: Exclude<WorkflowRequest, { action: "cancel" }>,
    effect: () => void,
  ): WorkbenchResult {
    this.current();
    if (epoch !== this.o.owner.lease.registration.epoch)
      throw new ContractError("stale");
    const secrets = this.o.secrets();
    if (r.action === "propose") {
      this.model(r.model);
      this.floor();
      // Credential-looking text is redacted, not refused: the stored, displayed
      // and approved plan is the redacted one, so approval binds those bytes.
      const plan = decodeWorkflowPlan(
        JSON.parse(sanitizeData(r.plan, secrets)),
        { strict: true },
      );
      const selected = this.model(r.model);
      const runtime = this.o.models.workerSettings(
        this.contexts.capture(r.model).cwd,
        selected,
      );
      const { source, digest, delivery } = this.observation(plan, runtime);
      const p: WorkflowProposal = {
        ...(delivery ? { delivery } : {}),
        id: commandId,
        epoch,
        model: r.model,
        plan,
        cwd: this.contexts.capture(r.model).cwd,
        checkoutRoot: this.cwd,
        observation: digest,
        display: {
          runtime: describeWorkerRuntime(runtime),
          model: `${selected.provider}/${selected.model} · ${selected.thinking}`,
          branch: source.branch,
          baseCommit: source.head,
        },
        digest: hash(canonicalJson(delivery ? { plan, delivery } : plan)),
      };
      // Only the owner's own environment (cwd/branch) could still carry a literal.
      if (sanitizeData(p, secrets) !== canonicalJson(p))
        throw new ContractError("forbidden");
      const target = join(this.root, "proposals", `${commandId}.json`);
      const previous = this.files.read(target, RECORD_BYTES);
      if (previous) {
        if (previous.bytes.toString("utf8") !== canonicalJson(p))
          throw new ContractError("conflict");
      } else {
        effect();
        this.write(target, p);
      }
      return {
        kind: "workflow",
        commandId,
        response: { type: "proposal", proposal: p },
      };
    }
    if (r.action === "prepare") {
      const p = this.proposal(r.proposalId);
      this.assertProposal(p, r.digest);
      for (const [key, v] of this.grants)
        if (v.expiresAt < Date.now()) this.grants.delete(key);
      if (this.grants.size >= 16) throw new ContractError("capacity");
      const grant = randomUUID(),
        expiresAt = Date.now() + 120000;
      effect();
      this.grants.set(grant, {
        commandId,
        proposalId: p.id,
        digest: p.digest,
        expiresAt,
      });
      return {
        kind: "workflow",
        commandId,
        response: { type: "grant", proposal: p, grant, expiresAt },
      };
    }
    if (
      r.action === "research" &&
      r.roots?.some((p) => sanitizeText(p, secrets) !== p)
    )
      throw new ContractError("forbidden");
    const request: WorkflowRequest =
      r.action === "research"
        ? {
            ...r,
            goal: clipBytes(sanitizeText(r.goal, secrets), 8192),
            questions: r.questions.map((q) =>
              clipBytes(sanitizeText(q, secrets), 8192),
            ),
          }
        : r;
    // A receipt lookup observes the same admitted original, never starts it again.
    const acceptedPath = this.path(commandId, "accepted.json");
    const prior = this.files.read(acceptedPath, RECORD_BYTES);
    if (prior) {
      if (prior.bytes.toString("utf8") !== canonicalJson({ epoch, request }))
        throw new ContractError("conflict");
      return { ...this.view(commandId), commandId } as WorkbenchResult;
    }
    if (this.files.directory(dirname(acceptedPath)))
      throw new ContractError("quarantine");
    let proposal: WorkflowProposal | undefined;
    let delivery: WorkflowRun["delivery"];
    let target: Live["target"];
    let declared: string | undefined;
    let runtime: WorkerRuntime;
    if (request.action === "execute") {
      proposal = this.proposal(request.proposalId);
      const observed = this.assertProposal(proposal, request.digest);
      const source = observed.source;
      runtime = observed.runtime;
      // A second plan would be checked against a checkout the first one changes;
      // queued behind it, it could only end stale. Refused before the grant is used.
      if ([...this.active.values()].some((live) => live.proposal))
        throw new WorkflowRefusal(
          "conflict",
          "Another approved workflow is queued or running in this checkout. Approve this plan again after it settles.",
        );
      this.capacity();
      // Validated before use: a refusal leaves the grant (or another
      // proposal's grant) exactly as it was. Only use consumes it.
      const grant = this.grants.get(request.grant);
      if (grant && grant.expiresAt < Date.now())
        this.grants.delete(request.grant);
      if (
        !grant ||
        grant.expiresAt < Date.now() ||
        grant.proposalId !== proposal.id ||
        grant.digest !== proposal.digest
      )
        throw new ContractError("expired-grant");
      const writes = workflowWrites(proposal.plan);
      if (proposal.delivery) {
        delivery = deliveryObservation(
          proposal.delivery,
          this.worktreeRoot,
          commandId,
          proposal.plan.goal,
        );
        if (sanitizeData(delivery, secrets) !== canonicalJson(delivery))
          throw new ContractError("forbidden");
      }
      effect();
      this.grants.delete(request.grant);
      if (proposal.plan.delivery === "local-merge")
        target = { head: source.head, branch: source.branch };
      else declared = contentsIdentity(this.cwd, writes);
    } else if (request.action === "research") {
      const selected = this.model(request.model);
      runtime = this.o.models.workerSettings(
        this.contexts.capture(request.model).cwd,
        selected,
      );
      this.capacity();
    } else throw new ContractError("invalid");
    const execution = this.contexts.capture(
      proposal?.model ??
        (request.action === "research"
          ? request.model
          : (() => {
              throw new ContractError("invalid");
            })()),
    );
    const run: WorkflowRun = {
      ...(delivery ? { delivery } : {}),
      execution,
      id: commandId,
      epoch,
      goal:
        proposal?.plan.goal ??
        (request.action === "research" ? request.goal : ""),
      diagnostics: {
        acceptedAt: Date.now(),
        acquiredAt: null,
        settledAt: null,
        owner: {
          ...OWNER_RUNTIME,
          entry: diagnosticText(OWNER_RUNTIME.entry, 4096, secrets),
        },
      },
      status: "queued",
      phase: request.action === "research" ? "research" : "implementing",
      steps: [],
      stepsBefore: 0,
      revision: 0,
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    };
    const abort = new AbortController();
    let begin!: () => void;
    const ready = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const live: Live = {
      runtime,
      execution,
      run,
      abort,
      original: ready.then(() => this.execute(live, request)),
      proposal,
      target,
      declared,
      delivered: new Set(),
      notes: [],
    };
    effect();
    this.active.set(commandId, live);
    this.o.owner.trackConversation(live.original, () =>
      abort.abort({ source: "service", reason: "stop", target: commandId }),
    );
    try {
      this.write(acceptedPath, { epoch, request });
      this.write(this.path(commandId, "runtime.json"), {
        identity: hash(canonicalJson(runtime)),
        summary: describeWorkerRuntime(runtime),
      });
      live.file = this.write(this.path(commandId, "state.json"), run);
    } catch (e) {
      abort.abort();
      begin();
      throw e;
    }
    begin();
    return {
      kind: "workflow",
      commandId,
      response: { type: "run", run: structuredClone(run) },
    };
  }
  /** Concurrency and disk only. Retained history never disables new runs. */
  private capacity() {
    this.floor();
    if (this.active.size >= MAX_ACTIVE) throw new ContractError("capacity");
  }
  private save(live: Live) {
    if (!live.file) throw new ContractError("corrupt-selected");
    live.file = this.write(
      this.path(live.run.id, "state.json"),
      live.run,
      live.file,
    );
  }
  /** The terminal snapshot must persist: clip previews rather than lose it. */
  private saveFinal(live: Live) {
    const cause = live.abort.signal.reason;
    if (live.abort.signal.aborted && cause?.source)
      live.run.notice = this.notice(
        live.run.notice,
        `${cause.source}: ${cause.reason} (${live.run.id})`,
      );
    try {
      canonicalJson(live.run, RECORD_BYTES);
    } catch {
      live.run.steps = live.run.steps.map((s) => ({
        ...s,
        text: clipBytes(s.text, 256),
        truncated: true,
      }));
      live.run.notice = this.notice(
        clipBytes(live.run.notice, 1024),
        "Run snapshot exceeded its bound; step previews were clipped.",
      );
    }
    this.save(live);
  }
  private assertRunning(live: Live) {
    this.current();
    this.floor();
    // current() already resolved the canonical checkout. Most conversations
    // use that same cwd: do not spawn a second Git lookup at every worker,
    // check and publication boundary. Distinct conversation paths still need
    // their own fresh membership/identity check, even within one checkout.
    if (
      live.abort.signal.aborted ||
      (live.execution.cwd !== this.cwd &&
        (resolveWorkspace(live.execution.cwd).root !== this.cwd ||
          realpathSync(live.execution.cwd) !== live.execution.cwd))
    )
      throw new ContractError("stale");
  }
  private step(
    live: Live,
    id: string,
    kind: WorkflowStep["kind"],
    childRunId?: string,
  ): WorkflowStep {
    // Leave space for the new worker's timing, runtime and final preview before
    // its next save. Both count and encoded bytes are view bounds, not quotas.
    const needsPage =
      live.run.steps.length >= MAX_STEPS ||
      (live.run.steps.length >= MAX_STEPS / 2 &&
        Buffer.byteLength(JSON.stringify(live.run)) > RECORD_BYTES - 65536);
    if (needsPage) {
      // Pages are whole and fixed-size. A step still running stays in view, so
      // the oldest settled steps fill the page around it.
      const prefix = live.run.steps
        .filter((s) => s.status !== "running")
        .slice(0, MAX_STEPS / 2);
      if (prefix.length < MAX_STEPS / 2) throw new ContractError("capacity");
      const paged = new Set(prefix);
      const offset = live.run.stepsBefore ?? 0;
      this.write(this.path(live.run.id, `pages/${offset}.json`), {
        offset,
        steps: prefix,
      });
      for (const step of prefix)
        this.write(this.path(live.run.id, `members/${hash(step.id)}.json`), {
          id: step.id,
          offset,
        });
      live.run.steps = live.run.steps.filter((s) => !paged.has(s));
      live.run.stepsBefore = offset + prefix.length;
    }
    const s: WorkflowStep = {
      id: `${clipUnits(id, STEP_UNITS)}-${randomUUID()}`,
      ...(childRunId ? { childRunId } : {}),
      kind,
      ...(childRunId
        ? {
            timing: {
              createdAt: Date.now(),
              preparedAt: null,
              startedAt: null,
              stopRequestedAt: null,
              closedAt: null,
              settledAt: null,

              stopReason: null,
            },
          }
        : {}),
      status: "running",
      text: "",
      exitCode: null,
      truncated: false,
    };
    live.run.steps.push(s);
    try {
      this.save(live);
    } catch (e) {
      live.run.steps.pop();
      throw e;
    }
    return s;
  }
  /** A step never stays `running` after its operation settled or failed. */
  private closeStep(live: Live, s: WorkflowStep, text?: string) {
    if (s.status !== "running") return;
    s.status =
      this.o.owner.state === "quarantined"
        ? "unknown"
        : live.abort.signal.aborted
          ? "canceled"
          : "failed";
    s.text = diagnosticText(
      text || s.text || "Operation did not settle with a recorded result.",
      1024,
      this.o.secrets(),
    );
    try {
      this.save(live);
    } catch {
      /* A storage failure has already quarantined the owner. */
    }
  }
  private sanitizeResult(result: RunResult): RunResult {
    return workflowResult(result, this.o.secrets());
  }
  private finishStep(
    live: Live,
    s: WorkflowStep,
    original: RunResult,
    preview?: string,
    report?: ReturnType<typeof implementationReport>,
  ) {
    const result = this.sanitizeResult(original);
    this.write(this.path(live.run.id, `results/${hash(s.id)}.json`), {
      stepId: s.id,
      result,
    });
    const shown = preview ?? (result.text || result.output);
    s.status = result.outcome;
    s.text = diagnosticText(
      shown,
      s.kind === "research" ? 16384 : 1024,
      this.o.secrets(),
    );
    s.exitCode = result.exitCode;
    s.truncated =
      result.truncated || Buffer.byteLength(shown) > Buffer.byteLength(s.text);
    // Observers stop following a settled step; publish its verdict atomically.
    if (
      s.kind === "review" &&
      result.outcome === "completed" &&
      result.closed &&
      result.exitCode === 0
    ) {
      const verdict = reviewVerdict(result.text);
      s.status = verdict
        ? verdict.approved
          ? "completed"
          : "rejected"
        : "failed";
      s.text = diagnosticText(
        verdict
          ? verdict.approved
            ? `Agent review approved (automatic, not human review). ${verdict.summary}`
            : `Agent review rejected: ${[verdict.summary, ...verdict.blockingIssues].filter(Boolean).join(" | ") || "no reason given"}`
          : `Agent review reply could not be parsed as a verdict${result.truncated ? " (the reply was clipped)" : ""}; it is not counted as approval.`,
        1024,
        this.o.secrets(),
      );
    }
    if (
      report !== undefined &&
      result.outcome === "completed" &&
      result.closed &&
      result.exitCode === 0
    ) {
      s.status = report?.status === "completed" ? "completed" : "failed";
      s.text = diagnosticText(
        report
          ? report.status === "blocked"
            ? `Assignment blocked: ${report.summary}`
            : report.summary
          : "Assignment did not submit a complete structured report; the owner will diagnose actual outputs.",
        1024,
        this.o.secrets(),
      );
    }
    if (!result.closed) this.o.owner.quarantine();
    this.save(live);
  }
  private async worker(
    live: Live,
    cwd: string,
    id: string,
    prompt: string,
    readonly: boolean,
    version: ChoiceVersion,
    roots: string[] | undefined,
    kind: WorkflowStep["kind"],
  ): Promise<{
    result: RunResult;
    step: WorkflowStep;
    report: ReturnType<typeof implementationReport>;
  }> {
    this.assertRunning(live);
    const model = live.execution.model;
    if (
      !model ||
      canonicalJson(version) !== canonicalJson(live.execution.version)
    )
      throw new ContractError("stale");
    this.o.models.assertCurrent(model);
    if (cwd !== this.cwd) await live.delivery?.assertTip(cwd);
    const runCwd = this.executionCwd(live, cwd);
    const role = loadAgentDefinitions().find(
      (r) =>
        r.role ===
        (readonly
          ? kind === "diagnosis"
            ? "diagnosis-worker"
            : "design-explorer"
          : "implementation-worker"),
    );
    if (!role) throw new ContractError("unavailable");
    if (cwd !== this.cwd) await assertWorktree(this.cwd, cwd);
    const childRunId = randomUUID(),
      op = randomUUID();
    const plan = live.proposal?.plan;
    const baseContext = plan
      ? `${workflowContext(plan)}
Execution cwd: ${runCwd}
Checkout root: ${cwd}
Write paths are relative to the checkout root.`
      : "Read applicable project documentation. Cite evidence and separate observations from assumptions.";
    const reader = await this.reader(live, cwd, id, kind);
    const knowledge = projectKnowledge(
      cwd,
      `${live.run.goal} ${id} ${prompt.slice(0, 1024)}`,
      reader.writes,
      this.o.secrets(),
      Math.max(0, Math.min(16 * 1024, 32000 - Buffer.byteLength(baseContext))),
      reader.named,
    );
    const request = decodeWorkerPublicRequest({
      protocol: 2,
      taskId: live.run.id,
      taskKind: readonly
        ? kind === "diagnosis"
          ? "diagnosis"
          : "research"
        : "code",
      runId: live.run.id,
      childRunId,
      assignmentId: id,
      purpose: readonly
        ? kind === "diagnosis"
          ? "diagnosis"
          : kind === "review"
            ? "review"
            : "research"
        : "edit",
      ...(readonly && kind === "review" && live.run.delivery?.candidate
        ? {
            changes: {
              root: cwd,
              base: live.run.delivery.binding.target.head,
              candidate: live.run.delivery.candidate,
            },
          }
        : {}),
      model,
      role: { role: role.role, sha256: role.sha256 },
      context: `${baseContext}

${knowledge.text}`,
      instructions: `${role.content}\nRead applicable AGENTS.md, existing project conventions and relevant tests before work. Do not delegate, restart the workflow, mutate Git, install dependencies, publish or deploy. The owner handles recovery; preserve partial work and report actionable remaining gaps. Report actual work and uncertainty. Do not weaken tests to manufacture success. Worker completion is not verification. There is no total runtime deadline. Continue naturally; report a blocked assignment only for a concrete missing condition, preserving completed outputs and actionable remaining work. Do not duplicate the entire acceptance pipeline inside one worker.`,
      prompt: text(prompt, 32768, true),
      handoff: { graphRevision: 1, inputs: [] },
    });
    const step = this.step(live, id, kind, childRunId);
    const current = () => {
      try {
        this.assertRunning(live);
        return true;
      } catch {
        return false;
      }
    };
    let native: NativeSettlement | undefined;
    let selectedMessageId: string | undefined;
    const auth = this.o.models.prepareTracked({
      runtime: live.runtime,
      request,
      cwd: runCwd,
      operationId: op,
      epoch: live.run.epoch,

      signal: live.abort.signal,
      current,
      journal: {
        preparation: (v) => {
          this.write(
            this.path(live.run.id, `auth/${v.operationId}-intent.json`),
            v,
          );
        },
        settlement: (v) => {
          this.write(
            this.path(live.run.id, `auth/${v.operationId}-settled.json`),
            v,
          );
        },
      },
    });
    try {
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !current())
        throw new ContractError("auth-unavailable");
      if (step.timing) {
        step.timing.preparedAt = Date.now();
        this.save(live);
      }
      this.write(this.path(live.run.id, `launches/${childRunId}.json`), {
        cwd: runCwd,
        runtime: live.runtime ? describeWorkerRuntime(live.runtime) : null,
        knowledge: {
          sources: knowledge.sources.map(
            ({ excerpt: _excerpt, ...source }) => source,
          ),
          omitted: knowledge.omitted,
        },
        request,
      });
      const transcript: ChatTurn = {
        id: childRunId,
        epoch: live.run.epoch,
        status: "running",
        items: [],
        notice: "",
        omitted: { thinking: false, media: false, other: false },
      };
      let transcriptFile: FileSnapshot | undefined;
      let credentials: readonly string[] = [];
      const saveTranscript = () => {
        transcriptFile = this.write(
          this.path(live.run.id, `transcripts/${childRunId}.json`),
          transcript,
          transcriptFile,
        );
      };
      const recorder = new WorkflowTranscript(transcript, () => [
        ...this.o.secrets(),
        ...credentials,
      ]);
      const running = Promise.resolve().then(() =>
        launchWorkflowWorker(prepared.prepared, runCwd, live.abort.signal, {
          ownerSecrets: this.o.secrets(),
          roots: roots?.length
            ? roots.map((p) => resolve(runCwd, p))
            : [kind === "research" ? runCwd : cwd],
          onLifecycle: (event) => {
            if (!step.timing) return;
            if (event.kind === "spawned") step.timing.startedAt = event.at;
            else if (event.kind === "closed") step.timing.closedAt = event.at;
            else {
              step.timing.stopRequestedAt = event.at;
              step.timing.stopReason = event.reason ?? null;
            }
            // Memory only: never put journal I/O ahead of TERM/KILL. The
            // running original persists these facts with its result below.
          },
          maySignal: () => {
            try {
              this.o.owner.lease.assert();
              return true;
            } catch {
              return false;
            }
          },
          onNative: (v, messageId) => {
            native = v;
            selectedMessageId = messageId;
          },
          onFrame: (frame, secrets) => {
            credentials = secrets;
            if (frame.event.kind === "ready" && frame.event.runtime) {
              step.runtime = {
                ...frame.event.runtime,
                sdkVersion: sanitizeText(frame.event.runtime.sdkVersion, [
                  ...this.o.secrets(),
                  ...secrets,
                ]),
              };
              this.save(live);
            }
            // Capture bounds never stop the worker; storage failures still do.
            if (recorder.accept(frame)) saveTranscript();
          },
        }),
      );
      this.o.owner.trackConversationProcess(
        running.then(() => {
          if (!native) throw new ContractError("quarantine");
          return native;
        }),
        () =>
          live.abort.abort({
            source: "service",
            reason: "stop",
            target: live.run.id,
          }),
      );
      const completed = this.sanitizeResult(await running);
      if (native)
        this.write(this.path(live.run.id, `native/${childRunId}.json`), native);
      // A killed editing process can leave owned tool activity uncertain. Never
      // treat its direct-child close as permission to launch another editor.
      if (
        !readonly &&
        completed.closed &&
        ["failed", "timeout"].includes(completed.outcome) &&
        native?.cleanup !== "settled" &&
        !settledWorkerCleanup(completed.output)
      ) {
        completed.outcome = "unknown";
        this.o.owner.quarantine();
      }
      let report: ReturnType<typeof implementationReport> = readonly
        ? null
        : implementationReport(recorder.assignmentReport() ?? "", [
            ...this.o.secrets(),
            ...credentials,
          ]);
      if (completed.outcome === "completed") {
        // The runner's preview may cut through an owner literal before it is
        // sanitized: use the sanitized complete message, then bound it.
        const selected = recorder.selected(selectedMessageId);
        if (selected === undefined) {
          if (recorder.complete) throw new ContractError("corrupt-selected");
          completed.text = report
            ? canonicalJson(report, RECORD_BYTES)
            : FINAL_UNAVAILABLE;
          completed.truncated ||= !report;
        } else {
          const secrets = [...this.o.secrets(), ...credentials];
          const finalBytes = kind === "diagnosis" ? RECOVERY_BYTES : 16384;
          // This is the independently retained, complete selected message, not
          // runProcess's preview. Stderr/other diagnostic clipping says nothing
          // about its completeness. Never parse a display-truncated fallback.
          // Older workers/results remain parseable; current workers submit via cadence_report.
          if (!readonly && !report)
            report = implementationReport(selected, secrets);
          let final = report
            ? canonicalJson(report, RECORD_BYTES)
            : sanitizeText(selected, secrets);
          if (kind === "diagnosis") {
            try {
              // Decode before sanitizing values: escaped provider/owner literals
              // must not reappear when the recovery decision is parsed later.
              final = sanitizeData(
                parseWireJson(
                  selected
                    .trim()
                    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, "$1"),
                  RECOVERY_BYTES,
                ),
                secrets,
              );
            } catch {
              /* Keep the labelled original invalid reply; it grants no action. */
            }
          }
          if (kind === "review") {
            const review = reviewReport(selected, secrets);
            final = review.text;
            completed.truncated ||= review.truncated;
          }
          completed.text = report ? final : diagnosticText(final, finalBytes);
          completed.truncated ||=
            !report && Buffer.byteLength(final) > finalBytes;
        }
      }
      transcript.status = completed.outcome;
      delete transcript.retry;
      saveTranscript();
      this.finishStep(
        live,
        step,
        completed,
        undefined,
        readonly ? undefined : report,
      );
      if (
        completed.closed &&
        completed.outcome === "failed" &&
        modelRequestFailed(completed.output)
      )
        throw new Error(
          "The model request failed after automatic recovery or was not retryable. Partial work is preserved; no workflow step was replayed.",
        );
      return { result: completed, step, report };
    } finally {
      await auth.settled;
      if (step.timing) {
        step.timing.settledAt = Date.now();
        this.save(live);
      }
      this.closeStep(
        live,
        step,
        "Worker did not produce a completed native/recorded result.",
      );
    }
  }
  /** One recorded process. Checks and private-worktree Git follow the run's
   * cancellation; the user-checkout fast-forward passes its own signal. */
  private async run(
    live: Live,
    cwd: string,
    operation: { check: WorkflowCheck } | { git: string[] },
    options: { uninterruptible?: boolean } = {},
  ): Promise<RunResult> {
    this.assertRunning(live);
    const shell = "check" in operation;
    if (cwd !== this.cwd) {
      if (shell) await live.delivery?.assertTip(cwd);
      else await live.delivery?.assertBinding(cwd);
    }
    if (cwd !== this.cwd && shell) await assertWorktree(this.cwd, cwd);
    const runCwd = shell ? this.executionCwd(live, cwd) : cwd;
    const id = randomUUID();
    this.write(this.path(live.run.id, `operations/${id}-intent.json`), {
      cwd: runCwd,
      args: shell ? operation.check : operation.git,
    });
    let native: CheckNativeSettlement | undefined;
    const environment = {
      ...(this.o.checkEnvironment ?? {}),
      CADENCE_SUBAGENT_CHILD: "1",
    };
    const running = Promise.resolve().then(() =>
      runProcess({
        command: shell
          ? process.platform === "win32"
            ? ((environment as NodeJS.ProcessEnv).COMSPEC ?? "cmd.exe")
            : "/bin/sh"
          : "git",
        args: shell
          ? process.platform === "win32"
            ? ["/d", "/s", "/c", `"${operation.check.command}"`]
            : ["-c", operation.check.command]
          : gitArguments([
              "--no-lazy-fetch",
              "-c",
              `core.hooksPath=${join(this.root, "empty-hooks")}`,
              "-c",
              "commit.gpgsign=false",
              "-c",
              "gc.auto=0",
              "-c",
              "maintenance.auto=false",
              ...operation.git,
            ]),
        windowsVerbatimArguments:
          shell && process.platform === "win32" ? true : undefined,
        cwd: runCwd,
        env: shell ? environment : gitEnvironment(),
        retainOutput: true,
        stopTarget: id,
        // An uninterruptible operation is never tied to the run's cancellation.
        signal: options.uninterruptible
          ? new AbortController().signal
          : live.abort.signal,
        uninterruptible: options.uninterruptible,
        timeoutMs: shell ? operation.check.timeoutMs : undefined,
        secrets: [...this.o.secrets()],
        maySignal: () => {
          try {
            this.o.owner.lease.assert();
            return true;
          } catch {
            return false;
          }
        },
        onCheckNative: (v) => {
          native = v;
        },
      }),
    );
    this.o.owner.trackCheck(
      running.then(() => {
        if (!native) throw new ContractError("quarantine");
        return native;
      }),
      () =>
        live.abort.abort({
          source: "service",
          reason: "stop",
          target: live.run.id,
        }),
    );
    const result = this.sanitizeResult(await running);
    this.write(this.path(live.run.id, `operations/${id}-settled.json`), {
      result,
      native,
    });
    if (!result.closed) this.o.owner.quarantine();
    return result;
  }
  private async check(
    live: Live,
    cwd: string,
    c: WorkflowCheck,
    title: string,
  ): Promise<{ result: RunResult; step: WorkflowStep }> {
    const step = this.step(live, title, "check");
    try {
      const result = await this.run(live, cwd, { check: c });
      this.finishStep(live, step, result);
      return { result, step };
    } finally {
      this.closeStep(live, step);
    }
  }
  private success(result: RunResult, step?: WorkflowStep) {
    if (
      result.outcome !== "completed" ||
      !result.closed ||
      result.exitCode !== 0
    )
      throw new WorkflowFailure(
        result.outcome === "completed" ? "failed" : result.outcome,
        `Operation ${result.outcome}: ${diagnosticText(result.output || result.text, 512, this.o.secrets())}`,
        step?.id,
      );
  }
  /** Visible Git step; several commands of one logical operation share it. */
  private async gitStep<T>(
    live: Live,
    cwd: string,
    title: string,
    body: (git: (args: string[]) => Promise<RunResult>) => Promise<T>,
  ): Promise<T> {
    const operation = () => {
      this.assertRunning(live);
      if (cwd !== this.cwd) live.delivery?.assertWorkspace(cwd);
      return this.recordGitStep(live, cwd, title, body);
    };
    if (!live.delivery) return operation();
    const { delivery } = live;
    // A run's own Git steps queue here, so assignments that finish together
    // never spend the shared repository lease's wait on one another.
    const turn = (live.git ?? Promise.resolve()).then(() =>
      delivery.resources.mutate(
        delivery.view.binding.target.repository,
        live.abort.signal,
        operation,
        () => this.o.owner.state === "idle",
      ),
    );
    live.git = turn.then(
      () => {},
      () => {},
    );
    return turn;
  }
  private async recordGitStep<T>(
    live: Live,
    cwd: string,
    title: string,
    body: (git: (args: string[]) => Promise<RunResult>) => Promise<T>,
  ): Promise<T> {
    const step = this.step(live, title, "git");
    const lines: string[] = [];
    let last: RunResult | undefined;
    try {
      const value = await body(async (args) => {
        const result = await this.run(live, cwd, { git: args });
        last = result;
        lines.push(
          `git ${args.slice(0, args[0] === "worktree" ? 2 : 1).join(" ")}: ${result.outcome}${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}`,
        );
        if (result.exitCode !== 0 && result.output) lines.push(result.output);
        this.success(result, step);
        return result;
      });
      const summary = lines.join("\n") || "No Git operation was needed.";
      if (last) this.finishStep(live, step, last, summary);
      else {
        step.status = "completed";
        step.text = summary;
        this.save(live);
      }
      return value;
    } catch (error) {
      if (last && step.status === "running")
        this.finishStep(
          live,
          step,
          {
            ...last,
            outcome: last.outcome === "completed" ? "failed" : last.outcome,
          },
          [...lines, this.describe(error)].join("\n"),
        );
      throw error;
    } finally {
      this.closeStep(live, step, lines.join("\n"));
    }
  }
  private async setup(live: Live, cwd: string, p: WorkflowProposal) {
    // A failed command may be diagnosed and retried; already successful setup
    // commands are effects, not preconditions to replay on every continuation.
    for (const c of p.plan.setup)
      await this.recoverStage(live, cwd, p, `setup: ${c.name}`, async () => {
        const { result, step } = await this.check(
          live,
          cwd,
          c,
          `setup: ${c.name}`,
        );
        this.success(result, step);
      });
  }
  private async checks(
    live: Live,
    cwd: string,
    plan: WorkflowPlan,
    baseline = false,
    observed: WorkflowStep[] = [],
    waived: Set<string> = new Set(),
  ): Promise<boolean> {
    live.run.phase = "verifying";
    this.save(live);
    let passed = true;
    // A declared check a recorded deviation set aside still runs and is shown;
    // its failure no longer gates acceptance. `waived` collects those steps.
    const setAside = new Set(
      baseline ? [] : (live.run.deviations ?? []).flatMap((d) => d.waives),
    );
    for (const c of baseline ? plan.baselineChecks : plan.checks) {
      const { result: r, step } = await this.check(live, cwd, c, c.name);
      observed.push(step);
      if (
        !r.closed ||
        r.outcome === "unknown" ||
        r.outcome === "canceled" ||
        r.outcome === "timeout"
      )
        this.success(r, step);
      const ok = r.outcome === "completed" && r.exitCode === 0;
      if (!ok && setAside.has(c.name)) waived.add(step.id);
      else passed &&= ok;
    }
    return passed;
  }
  private async unchangedHead(cwd: string, before: string): Promise<void> {
    if ((await gitHead(cwd)) !== before) throw new ContractError("stale");
  }
  private async commit(
    live: Live,
    cwd: string,
    allowed: string[],
    message: string,
    before: string,
    title: string,
  ): Promise<string | null> {
    await this.unchangedHead(cwd, before);
    const changes = await assertWorkflowScope(cwd, allowed);
    if (!changes.length) return null;
    return this.gitStep(live, cwd, title, async (git) => {
      await this.unchangedHead(cwd, before);
      if (live.delivery && (await live.delivery.assertTip(cwd)) !== before)
        throw new ContractError("stale");
      await assertWorkflowScope(cwd, allowed);
      await git(["add", "--", ...changes]);
      await assertWorkflowScope(cwd, allowed);
      await this.unchangedHead(cwd, before);
      const staged = await gitRun(cwd, [
        "diff",
        "--cached",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
      ]);
      if (staged.code === 0) return null;
      await git(["commit", "--no-verify", "-m", message]);
      const commit = await gitHead(cwd);
      await assertWorkflowCommit(cwd, before, commit, allowed);
      live.delivery?.update(commit, cwd);
      return commit;
    });
  }
  /** Native facts from this round, not worker prose or status previews. Private
   * records stay private; only redacted, explicitly bounded excerpts cross into
   * a review/repair request. Historical failures never become current evidence. */
  private evidence(live: Live, steps: WorkflowStep[]): string {
    const rows = steps.map((step) => {
      const file = this.files.read(
        this.path(live.run.id, `results/${hash(step.id)}.json`),
        RECORD_BYTES,
      );
      if (!file) throw new ContractError("unavailable");
      const record = closed(
        parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
        ["stepId", "result"],
      );
      if (record.stepId !== step.id)
        throw new ContractError("corrupt-selected");
      const result = this.sanitizeResult(record.result as RunResult);
      return {
        header: canonicalJson({
          stepId: sanitizeText(step.id, this.o.secrets()),
          status: step.status,
          outcome: result.outcome,
          exitCode: result.exitCode,
          closed: result.closed,
          truncated: result.truncated,
        }),
        output: diagnosticText(
          step.kind === "review" ? result.text : result.output || result.text,
          RECORD_BYTES,
          this.o.secrets(),
        ),
      };
    });
    // Fits beside the maximum declared scope in the 32 KiB worker prompt.
    const budget = Math.max(
      0,
      Math.floor(
        (EVIDENCE_BYTES -
          rows.reduce((n, r) => n + Buffer.byteLength(r.header) + 64, 0)) /
          Math.max(1, rows.length),
      ),
    );
    return rows
      .map(({ header, output }) => {
        const marker = "\n[excerpt: middle omitted]\n";
        const half = Math.floor((budget - Buffer.byteLength(marker)) / 2);
        const excerpt =
          Buffer.byteLength(output) <= budget || half <= 0
            ? diagnosticText(output, budget)
            : `${clipBytes(output, half)}${marker}${Buffer.from(output).subarray(-half).toString("utf8").replace(/^�+/u, "")}`;
        return `${header}\nRetained output excerpt:\n${excerpt}`;
      })
      .join("\n\n");
  }
  private assignment(
    task: WorkflowPlan["tasks"][number],
    completed: string[],
  ): string {
    return `Execute the remaining work for assignment ${task.id}: ${task.title} in the admitted delivery. Inspect actual existing outputs first; an earlier failed attempt or recovery may already have completed part or all of it. Do not redo completed work. The initial implementation instructions are a route; equivalent in-scope implementations are allowed. Preserve the goal, explicit decisions and acceptance.
Setup has completed for this checkout. The run's baseline checks passed before implementation (on the integration candidate for local-merge). Do not rerun initial cleanliness preconditions against predecessor outputs or restart the whole plan.
Predecessor assignments already applied here: ${completed.join(", ") || "none"}. Preserve their outputs; their presence is not an authorization conflict. Unexpected edits still require reporting, not overwriting.
The full plan is context, not an instruction to implement other assignments. The owner runs acceptance checks and automatic review after all assignments; do not duplicate the whole pipeline.
${task.instructions}
Write only these exact files: ${task.writes.join(", ")} (a declared directory includes its contents)`;
  }
  private async implementation(
    live: Live,
    cwd: string,
    id: string,
    prompt: string,
    version: ChoiceVersion,
    kind: WorkflowStep["kind"] = "implementation",
  ) {
    const { result, step, report } = await this.worker(
      live,
      cwd,
      id,
      `${prompt}\n${IMPLEMENTATION_REPORT}`,
      false,
      version,
      undefined,
      kind,
    );
    this.attemptResult(live, result, step);
    if (!report || report.status === "blocked") {
      step.status = "failed";
      step.text = diagnosticText(
        report
          ? `Assignment blocked: ${report.summary}`
          : "Assignment did not return a complete structured completion report; native exit zero is not task completion.",
        1024,
        this.o.secrets(),
      );
      this.save(live);
      throw new AttemptFailure(`${id}: ${step.text}`, [step.id]);
    }
    step.text = diagnosticText(report.summary, 1024, this.o.secrets());
    step.truncated ||=
      Buffer.byteLength(report.summary) > Buffer.byteLength(step.text);
    this.save(live);
    return step;
  }
  /** The run's current write scope: the agreement's, plus what revisions added. */
  private scope(live: Live, p: WorkflowProposal): string[] {
    return [
      ...new Set([
        ...workflowWrites(p.plan),
        ...(live.run.scope ?? []),
        ...(live.managed ? KNOWLEDGE_SCOPE : []),
      ]),
    ];
  }
  /** What one worker reads first: the agreement's list for its assignment (or
   * for the review), any recorded investigation that list cites, and the write
   * paths the route table is matched against. */
  private async reader(
    live: Live,
    cwd: string,
    id: string,
    kind: WorkflowStep["kind"],
  ): Promise<{ writes: string[]; named: KnowledgeNamed }> {
    const p = live.proposal;
    if (!p) return { writes: [], named: {} };
    const task =
      kind === "implementation"
        ? (live.route?.tasks ?? p.plan.tasks).find((t) => t.id === id)
        : undefined;
    const reads =
      kind === "review" ? (p.plan.reviewReads ?? []) : (task?.reads ?? []);
    const extra: NonNullable<KnowledgeNamed["extra"]>[number][] = [];
    for (const reading of reads)
      if ("research" in reading) {
        const found = await this.investigation(reading.research);
        if (found)
          extra.push({
            label: `investigation ${reading.research}`,
            reason: `Recorded investigation, named by the agreement: ${reading.reason}`,
            body: found,
          });
      }
    return {
      writes: task
        ? (live.owned?.get(cwd) ?? task.writes)
        : this.scope(live, p),
      named: { reads, extra },
    };
  }
  private investigationPath(id: string): string {
    return join(this.root, "investigations", `${decodeId(id)}.json`);
  }
  /** A recorded investigation's answer, with a caution when the checkout has
   * moved since it was made. Absent or unreadable ones are simply not there. */
  private async investigation(id: string): Promise<string | null> {
    try {
      const index = this.files.read(this.investigationPath(id), RECORD_BYTES);
      if (!index) return null;
      const record = closed(parseWireJson(index.bytes.toString("utf8")), [
        "run",
        "step",
        "question",
        "commit",
        "at",
      ]);
      const result = this.files.read(
        this.path(
          decodeId(record.run),
          `results/${hash(text(record.step, 160, true))}.json`,
        ),
        RECORD_BYTES,
      );
      if (!result) return null;
      const stored = parseWireJson(
        result.bytes.toString("utf8"),
        RECORD_BYTES,
      ) as { result?: { text?: unknown } };
      const answer = diagnosticText(
        typeof stored.result?.text === "string" ? stored.result.text : "",
        6144,
        this.o.secrets(),
      );
      if (!answer) return null;
      let head: string | null = null;
      try {
        head = await gitHead(this.cwd);
      } catch {
        /* Not a Git checkout: nothing to compare with. */
      }
      const moved =
        typeof record.commit === "string" && head && record.commit !== head
          ? `Recorded at commit ${record.commit.slice(0, 12)}; the checkout has changed since. Verify before relying on it.\n`
          : "";
      return `Question: ${diagnosticText(text(record.question, 8192), 512, this.o.secrets())}\n${moved}${answer}`;
    } catch {
      return null;
    }
  }
  /** Recorded deviations, for the worker that must honour or judge them. */
  private deviationBrief(live: Live, reader: "work" | "review"): string {
    const deviations = live.run.deviations ?? [];
    if (!deviations.length) return "";
    const lines = deviations.map(
      (d) =>
        `- Revision ${d.revision}: "${d.item}" cannot be met (${d.reason}). Delivered instead: ${d.delivered}${d.waives.length ? ` Checks set aside: ${d.waives.join(", ")}.` : ""}`,
    );
    return `\n${
      reader === "review"
        ? "Recorded deviations from the agreement. Judge each one: approve only if the evidence shows the item could not be met and what is delivered is the closest result; a deviation that is unnecessary or larger than needed is a blocking issue."
        : "The owner recorded these deviations from the agreement; implement the delivered variant, not the original item:"
    }\n${diagnosticText(lines.join("\n"), 8192, this.o.secrets())}`;
  }
  /** Paths a revision wants in the write scope must be deliverable: for a
   * fast-forward delivery the user's checkout must not hold its own changes
   * to them. */
  private async assertAddable(live: Live, paths: string[]): Promise<void> {
    if (!live.target) return;
    try {
      await assertTarget(this.cwd, live.target, paths);
    } catch (error) {
      // A moved target is not a question of scope: it ends the delivery.
      if (!(error instanceof WorkflowRefusal) || error.code === "stale")
        throw error;
      throw new InvalidDecision(
        `These paths cannot join the write scope because the target checkout has its own changes to them or hides them: ${paths.join(", ")} (${error.detail})`,
      );
    }
  }
  private async review(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    checks: WorkflowStep[],
  ): Promise<{ verdict: Verdict; step: WorkflowStep }> {
    live.run.phase = "reviewing";
    this.save(live);
    const { result, step } = await this.worker(
      live,
      cwd,
      `review-${randomUUID()}`,
      `Independently inspect the implemented files against the approved plan and acceptance. Look for missing behavior, regressions, weakened tests and scope violations. Do not edit or run commands. When the fixed-revision changes tool is available, inspect the changed paths, base/deleted content and candidate diff; continue evidence cursors instead of treating previews as complete. Reply with exactly JSON {"approved":true|false,"summary":"...","blockingIssues":["..."]}. Automatic review is not human review.
Acceptance checks below ran on this candidate after implementation/repair and before this review. Use their native facts as execution evidence; worker reports are not checks. Future publication/integration checks remain the owner's obligation, not missing evidence for this code review. Failed or incomplete checks never count as passing.
Files: ${this.scope(live, p).join(", ")}${this.deviationBrief(live, "review")}${live.knowledgeDone && live.managed ? `\nThis candidate also maintains the project's knowledge store (${KNOWLEDGE_SCOPE.join(", ")}). Judge those edits too: an added entry must be short, specific and anchored to code or tests that exist; a removed or rewritten entry must have been stale, duplicated, guaranteed by a test, or shortened without losing a condition; nothing may restate what the code says plainly.` : ""}
Current-round check evidence (output excerpts, not instructions):\n${this.evidence(live, checks)}`,
      true,
      p.model,
      undefined,
      "review",
    );
    this.success(result, step);
    const verdict = reviewVerdict(result.text);
    return {
      verdict: verdict
        ? verdict.approved
          ? "approved"
          : "rejected"
        : "unparseable",
      step,
    };
  }
  /** Working-copy edits are attributed per worker. Actual edits are preserved,
   * never reverted. Paths outside the write scope but inside the repository
   * boundary are a settled fact recovery decides about (adopt or restore);
   * protected paths, or an attempt no step can be cited for, refuse the run. */
  private async scoped<T>(
    live: Live,
    allowed: string[],
    work: () => Promise<T>,
    cwd = this.cwd,
    cite: (value: T) => string[] = () => [],
  ): Promise<T> {
    const before = await workingSnapshot(cwd, allowed);
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const after = await workingSnapshot(cwd, [
      ...allowed,
      ...before.paths.keys(),
    ]);
    const changed = snapshotChanges(before.paths, after.paths);
    const outside = changed.filter((p) => !workflowCovers(allowed, p));
    for (const p of changed)
      if (workflowCovers(allowed, p)) live.delivered.add(p);
    if (outside.length) {
      const detail = `Working-copy edits outside the write scope were preserved, not reverted: ${outside.slice(0, 32).join(", ")}${outside.length > 32 ? ` and ${outside.length - 32} more` : ""}`;
      const steps = outcome.ok
        ? cite(outcome.value)
        : outcome.error instanceof AttemptFailure
          ? outcome.error.steps
          : [];
      if (
        !steps.length ||
        outside.some((p) => !workflowBoundary(p)) ||
        (!outcome.ok && !(outcome.error instanceof AttemptFailure))
      )
        throw new WorkflowRefusal("forbidden", detail);
      throw new AttemptFailure(
        `${detail}. Bring each of them into the write scope (level replan): keep it when the goal needs it, otherwise give a work item that restores it.${outcome.ok ? "" : ` The attempt also failed: ${(outcome.error as Error).message}`}`,
        steps,
      );
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  private attemptResult(live: Live, result: RunResult, step: WorkflowStep) {
    if (
      !result.closed ||
      result.outcome === "unknown" ||
      result.outcome === "canceled" ||
      live.abort.signal.aborted
    )
      this.success(result, step);
    if (result.outcome !== "completed" || result.exitCode !== 0)
      throw new AttemptFailure(
        `Settled ${step.kind} attempt ${result.outcome}: ${diagnosticText(result.output || result.text, 2048, this.o.secrets())}`,
        [step.id],
      );
  }
  private controller(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
  ): DeliveryController {
    live.controllers ??= new Map();
    const existing = live.controllers.get(cwd);
    if (existing) return existing;
    // An assignment in its own worktree decides inside the paths it owns; the
    // candidate decides inside the run's whole scope.
    const candidate = live.delivery?.view.worktreeRoot ?? this.cwd;
    const scope = () =>
      (cwd === candidate ? undefined : live.owned?.get(cwd)) ??
      this.scope(live, p);
    const checks = p.plan.checks.map((c) => c.name);
    const touches = (paths: string[], path: string) =>
      workflowCovers(paths, path) ||
      paths.some((other) => workflowCovers([path], other));
    /** Paths a decision adds for its own work here, not only for an
     * assignment its route adds, which will own them when it runs. */
    const mine = (decision: RecoveryDecision, added: string[]) =>
      added.filter(
        (path) =>
          touches(
            decision.work.flatMap((w) => w.writes),
            path,
          ) ||
          !touches(
            (decision.route?.add ?? []).flatMap((t) => t.writes),
            path,
          ),
      );
    const routed = () => {
      const route = live.route;
      if (!route) return "";
      const lines = (live.run.tasks ?? []).map((t) => {
        const task = route.tasks.find((entry) => entry.id === t.id);
        return `- ${t.id} [${t.state}${t.after.length ? `; after ${t.after.join(", ")}` : ""}${t.state === "queued" && task ? `; writes ${task.writes.join(", ")}` : ""}] ${t.title}`;
      });
      return `\nAssignments of the current route (only those still queued can be dropped or rewritten):\n${diagnosticText(lines.join("\n"), 6144, this.o.secrets())}`;
    };
    const controller = new DeliveryController({
      assertRunning: () => this.assertRunning(live),
      observe: () => sourceIdentityAsync(cwd, scope(), live.abort.signal),
      diagnose: async (failure, previous, floor, objection) => {
        live.run.phase = "recovering";
        live.run.notice = this.notice(
          "Diagnosing a settled attempt; partial work is preserved. No routine user confirmation is needed.",
          failure.message,
        );
        this.save(live);
        const steps = failure.steps
          .map((id) => this.findStep(live.run, id))
          .filter((s): s is WorkflowStep => !!s);
        const evidence = this.evidence(live, steps);
        const { result, step } = await this.worker(
          live,
          cwd,
          "diagnose",
          `${RECOVERY_INSTRUCTIONS}\nStage failure: ${failure.message}\nCurrent write scope: ${scope().join(", ")}\nLeast level for this decision: ${floor}\nDeclared acceptance checks: ${checks.join(", ")}\nDependency installation by revision: ${p.plan.policy?.installs ? "allowed with the project's own package manager" : "not allowed"}${routed()}${this.deviationBrief(live, "work")}${objection ? `\nYour previous reply for this failure could not be used: ${objection}` : ""}\nCurrent evidence:\n${evidence}\nPrevious recovery (historical, not current check evidence): ${previous ? diagnosticText(canonicalJson(previous), 2048, this.o.secrets()) : "none"}`,
          true,
          p.model,
          undefined,
          "diagnosis",
        );
        this.attemptResult(live, result, step);
        const decision = decodeRecoveryDecision(
          result.text,
          {
            scope: scope(),
            evidence: failure.steps,
            floor,
            checks,
            ...(live.route
              ? {
                  route: {
                    tasks: live.run.tasks ?? [],
                    scope: this.scope(live, p),
                  },
                }
              : {}),
          },
          this.o.secrets(),
        );
        if (
          decision.deviation &&
          (live.run.deviations?.length ?? 0) >= WORKFLOW_DEVIATIONS
        )
          throw new InvalidDecision(
            "This delivery already recorded as many deviations as one run may; continue without another",
          );
        const added = decision.scope.filter((p) => !workflowCovers(scope(), p));
        if (added.length) {
          const taken = [...(live.owned ?? [])]
            .filter(([tree]) => tree !== cwd)
            .flatMap(([, paths]) => paths);
          const contended = mine(decision, added).filter((path) =>
            touches(taken, path),
          );
          if (contended.length)
            throw new InvalidDecision(
              `Another assignment that is running owns these paths: ${contended.join(", ")}. Leave that work to it, or decide without them`,
            );
          await this.assertAddable(live, added);
        }
        return decision;
      },
      record: (record) => {
        const revision = (live.run.revision ?? 0) + 1;
        this.write(this.path(live.run.id, `revisions/${revision}.json`), {
          ...record,
          revision,
        });
        live.run.revision = revision;
        const { decision } = record;
        const added = decision.scope.filter((p) => !workflowCovers(scope(), p));
        if (added.length) {
          live.run.scope = [...new Set([...(live.run.scope ?? []), ...added])];
          live.owned?.get(cwd)?.push(...mine(decision, added));
        }
        let route = "";
        if (decision.route)
          try {
            route = live.route?.revise(decision.route, revision) ?? "";
          } catch (error) {
            // What was waiting when the decision was checked has started since.
            if (!(error instanceof InvalidDecision)) throw error;
            route = `The assignments were left as they were: ${error.message}`;
          }
        if (decision.deviation)
          live.run.deviations = [
            ...(live.run.deviations ?? []),
            { revision, ...decision.deviation },
          ];
        live.run.notice = this.notice(
          `Plan revision ${revision} (${decision.action === "blocked" ? "blocked" : decision.level}): ${decision.strategy}`,
          route,
        );
        this.save(live);
        return revision;
      },
      execute: async (work, revision) => {
        live.run.phase = "implementing";
        this.save(live);
        await this.editAttempt(
          live,
          cwd,
          p,
          `repair-${revision}`,
          `${work.title}\n${work.instructions}\nPreserve prior outputs. Write only: ${work.writes.join(", ")}`,
          work.writes,
        );
      },
    });
    live.controllers.set(cwd, controller);
    return controller;
  }
  /** Changes found outside the write scope when a candidate is about to be
   * committed are a settled fact for recovery to decide about (adopt or
   * restore), recorded as their own failed step. A protected path is left to
   * the commit's own refusal. */
  private async leftOutside(
    live: Live,
    cwd: string,
    scope: string[],
  ): Promise<void> {
    const outside = (await changedPaths(cwd)).filter(
      (path) => !workflowCovers(scope, path),
    );
    if (!outside.length || outside.some((path) => !workflowBoundary(path)))
      return;
    const step = this.step(live, "write-scope", "check");
    const detail = `Changes outside the write scope were preserved, not committed: ${outside.slice(0, 32).join(", ")}${outside.length > 32 ? ` and ${outside.length - 32} more` : ""}`;
    this.closeStep(live, step, detail);
    if (step.status !== "failed") this.assertRunning(live);
    throw new AttemptFailure(
      `${detail}. Bring each of them into the write scope (level replan): keep it when the goal needs it, otherwise give a work item that restores it.`,
      [step.id],
    );
  }
  private async editAttempt(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    id: string,
    prompt: string,
    allowed: string[],
    kind: WorkflowStep["kind"] = "implementation",
  ) {
    const head = live.target ? await gitHead(cwd) : null;
    if (live.delivery) {
      live.delivery.view.acceptance = null;
      this.save(live);
    }
    try {
      return await this.scoped(
        live,
        allowed,
        () =>
          this.implementation(
            live,
            cwd,
            id,
            `${prompt}${this.deviationBrief(live, "work")}`,
            p.model,
            kind,
          ),
        cwd,
        (step) => [step.id],
      );
    } finally {
      if (head) await this.unchangedHead(cwd, head);
    }
  }
  /** Converts only settled process/report failures into recovery. Scope, authority,
   * storage, Stop and unknown originals propagate without starting another worker. */
  private async recoverStage<T>(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    stage: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.controller(live, cwd, p).complete(stage, async () => {
      try {
        return await work();
      } catch (error) {
        if (
          error instanceof WorkflowFailure &&
          ["failed", "timeout"].includes(error.outcome) &&
          !live.abort.signal.aborted &&
          this.o.owner.state === "idle"
        ) {
          const step = error.step
            ? this.findStep(live.run, error.step)
            : undefined;
          if (step && ["failed", "timeout"].includes(step.status)) {
            if (step.kind === "check" && error.outcome === "timeout")
              throw error;
            throw new AttemptFailure(error.message, [step.id]);
          }
        }
        throw error;
      }
    });
  }
  private async verifyAndRepair(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    git: boolean,
    documents: string[] = [],
  ) {
    await this.recoverStage(live, cwd, p, "verification", async () => {
      // Read per round: a revision may have extended the scope since the last.
      const scope = [...this.scope(live, p), ...documents];
      let head: string | null = null;
      if (git) {
        const delivery = live.delivery;
        if (!delivery) throw new ContractError("stale");
        await this.leftOutside(live, cwd, scope);
        const before = await delivery.assertTip();
        await this.commit(
          live,
          cwd,
          scope,
          "Cadence: candidate for verification",
          before,
          "commit-candidate",
        );
        head = await delivery.assertTip();
        await assertCandidate(cwd, head);
        await assertCommittedScope(
          cwd,
          delivery.view.binding.target.head,
          head,
          scope,
        );
        delivery.view.candidate = head;
        delivery.view.acceptance = null;
        this.save(live);
      }
      delete live.run.verification;
      const beforeSource = await sourceIdentityAsync(
        cwd,
        scope,
        live.abort.signal,
      );
      const checks: WorkflowStep[] = [];
      const waived = new Set<string>();
      const checked = await this.checks(
        live,
        cwd,
        p.plan,
        false,
        checks,
        waived,
      );
      if (head) {
        await this.unchangedHead(cwd, head);
        await assertWorkflowScope(cwd, scope);
      }
      const checkedSource = await sourceIdentityAsync(
        cwd,
        scope,
        live.abort.signal,
      );
      if (beforeSource !== checkedSource)
        throw new AttemptFailure(
          "Checks changed approved source files; verify the resulting candidate, never reuse the earlier source evidence.",
          checks.map((s) => s.id),
        );
      const { verdict, step: review } = await this.review(live, cwd, p, checks);
      if (head) {
        await this.unchangedHead(cwd, head);
        await assertWorkflowScope(cwd, scope);
      }
      if (
        checkedSource !==
        (await sourceIdentityAsync(cwd, scope, live.abort.signal))
      )
        throw new WorkflowRefusal(
          "stale",
          "Approved files changed during readonly review; evidence is not valid for the new bytes.",
        );
      if (head) await assertCandidate(cwd, head);
      if (checked && verdict === "approved") {
        const id = randomUUID(),
          steps = [...checks.map((s) => s.id), review.id];
        this.write(this.path(live.run.id, `verification/${id}.json`), {
          id,
          agreement: p.digest,
          cwd,
          source: checkedSource,
          scope,
          steps,
          epoch: live.run.epoch,
          at: Date.now(),
        });
        live.run.verification = { id, source: checkedSource, steps };
        if (head && live.delivery) {
          live.delivery.view.acceptance = acceptanceRecord(
            head,
            (await gitText(cwd, ["rev-parse", `${head}^{tree}`])).trim(),
            p.digest,
            live.execution,
            checks,
            review,
            p.plan.checks.length,
            waived,
          );
        }
        this.save(live);
        return;
      }
      throw new AttemptFailure(
        `${checked ? "Checks passed." : "Acceptance checks failed."} Agent review: ${verdict}.`,
        [...checks.map((s) => s.id), review.id],
      );
    });
  }
  /** Whether this delivery can carry edits to the knowledge store: a
   * fast-forward cannot deliver ignored paths or ones the target checkout has
   * its own changes to. Skipped maintenance is said, never silent. */
  private async storeDeliverable(live: Live): Promise<boolean> {
    if (!live.target) return true;
    const skip = (why: string) => {
      live.notes.push(
        `Project knowledge was not maintained in this delivery: ${why}`,
      );
      return false;
    };
    const ignored = await gitRun(this.cwd, [
      "check-ignore",
      "-q",
      "--",
      KNOWLEDGE_STORE.index,
      `${KNOWLEDGE_STORE.topics}/topic.md`,
    ]);
    if (ignored.code === 0) return skip(".cadence/ is ignored by Git here.");
    try {
      await assertTarget(this.cwd, live.target, KNOWLEDGE_SCOPE);
    } catch {
      return skip(
        "the target checkout has its own changes to the knowledge store.",
      );
    }
    return true;
  }
  /** What the run failed at and how it revised its route, oldest first. */
  private revisionHistory(live: Live): string {
    const lines: string[] = [];
    for (let n = 1; n <= (live.run.revision ?? 0); n++) {
      try {
        const file = this.files.read(
          this.path(live.run.id, `revisions/${n}.json`),
          RECORD_BYTES,
        );
        if (!file) continue;
        const record = parseWireJson(
          file.bytes.toString("utf8"),
          RECORD_BYTES,
        ) as {
          stage?: unknown;
          failure?: unknown;
          decision?: {
            level?: unknown;
            cause?: unknown;
            strategy?: unknown;
            route?: { drop?: unknown; add?: unknown } | null;
          };
        };
        const ids = (value: unknown, key?: string) =>
          Array.isArray(value)
            ? value
                .map((v) =>
                  String(key ? (v as Record<string, unknown>)?.[key] : v),
                )
                .join(", ")
            : "";
        const dropped = ids(record.decision?.route?.drop),
          given = ids(record.decision?.route?.add, "id");
        lines.push(
          `- Revision ${n} (${String(record.stage)}, ${String(record.decision?.level ?? "repair")}): ${String(record.failure).slice(0, 300)} Cause: ${String(record.decision?.cause).slice(0, 300)} Then: ${String(record.decision?.strategy).slice(0, 300)}${dropped ? ` Dropped assignments: ${dropped}.` : ""}${given ? ` Added or rewrote assignments: ${given}.` : ""}`,
        );
      } catch {
        /* An unreadable revision is simply not part of the brief. */
      }
    }
    return diagnosticText(lines.join("\n"), 6144, this.o.secrets());
  }
  /** After the implementation passed its checks and review, one assignment
   * maintains project knowledge: the managed store, inside its budget, and
   * any existing documents the agreement named. The store must pass its
   * deterministic checks before the combined candidate is verified again. */
  private async learn(live: Live, cwd: string, p: WorkflowProposal) {
    const documents = workflowDocuments(p.plan);
    const managed = p.plan.version === 3 && (await this.storeDeliverable(live));
    if (!documents.length && !managed) return;
    live.managed = managed;
    const paths = [...(managed ? KNOWLEDGE_SCOPE : []), ...documents];
    await this.recoverStage(live, cwd, p, "project knowledge", async () => {
      live.run.phase = "learning";
      this.save(live);
      const before = lintKnowledge(cwd, [...live.delivered]);
      const topics = before.usage.topics.map((t) => t.path);
      const facts = (live.run.verification?.steps ?? [])
        .map((id) => this.findStep(live.run, id))
        .filter((s): s is WorkflowStep => !!s);
      const step = await this.editAttempt(
        live,
        cwd,
        p,
        "project-knowledge",
        `${curationInstructions({
          documents,
          managed,
          usage: before.usage,
          revalidate: before.revalidate,
          notes: before.findings.map((f) => `${f.path}: ${f.detail}`),
          // Stateless rotation: over many deliveries every topic gets a look.
          rotation: topics.length
            ? topics[
                Number.parseInt(live.run.id.slice(0, 8), 16) % topics.length
              ]
            : null,
          history: this.revisionHistory(live),
          deviations: this.deviationBrief(live, "work").trim(),
        })}\nLatest retained verification evidence (historical until the combined candidate is verified):\n${this.evidence(live, facts)}`,
        paths,
        "knowledge",
      );
      if (!managed) return;
      // What this delivery wrote must hold; the budget must hold regardless.
      const blocking = lintKnowledge(cwd, [...live.delivered]).findings.filter(
        (f) => f.blocking,
      );
      if (blocking.length)
        throw new AttemptFailure(
          `The knowledge store does not pass its checks; correct it within the budget: ${diagnosticText(blocking.map((f) => `${f.path}: ${f.detail}`).join("; "), 2048, this.o.secrets())}`,
          [step.id],
        );
    });
    live.knowledgeDone = true;
  }
  private documents(live: Live): string[] {
    const base = `.cadence/assistant/workflows/${live.run.id}`;
    return [`${base}/plan.md`, `${base}/result.md`];
  }
  /** Pre-delivery notes: honest about what they are not. */
  private notesBody(
    live: Live,
    plan: WorkflowPlan,
    changed: string[],
    merged = false,
  ) {
    const delivery = merged
      ? "after the fast-forward and before post-merge checks"
      : plan.delivery === "local-merge"
        ? "before final candidate checks, fast-forward integration and post-merge checks"
        : "before post-publication checks";
    return `# Workflow delivery notes\n\nWritten ${delivery}. This file is not a verification result: the owner retains the final run status, check outcomes and any merge commit.\n\nAutomatic Agent review, not human review.\n\n## Steps recorded so far\n${live.run.steps.map((s) => `- ${s.kind} ${s.id}: ${s.status}${s.exitCode === null ? "" : ` (exit ${s.exitCode})`}`).join("\n")}\n\n## Changed files\n${changed.map((p) => `- ${p}`).join("\n") || "None recorded."}\n`;
  }
  private documentBody(
    live: Live,
    plan: WorkflowPlan,
    name: string,
    changed: string[],
    merged = false,
  ): string {
    return name.endsWith("/plan.md")
      ? readableWorkflowPlan(plan)
      : this.notesBody(live, plan, changed, merged);
  }
  private publish(
    live: Live,
    cwd: string,
    plan: WorkflowPlan,
    names: string[],
    changed: string[],
  ) {
    this.assertRunning(live);
    for (const name of names) {
      const file = safeWorkflowFile(cwd, name);
      if (!safeDirectory(dirname(file), true))
        throw new ContractError("forbidden");
      writeFileSync(file, this.documentBody(live, plan, name, changed), {
        flag: name === ".cadence/project.md" ? "w" : "wx",
      });
    }
  }
  /** Fast-forward the user's checkout. Never interrupted: no cancellation,
   * timeout or output bound signals Git mid-update. HEAD is re-read afterwards
   * so the reported merge commit is the actual outcome. */
  private async merge(live: Live, candidate: string): Promise<void> {
    this.assertRunning(live);
    const step = this.step(live, "merge", "git");
    let result: RunResult | undefined;
    let actual: string | null = null;
    try {
      result = await this.run(
        live,
        this.cwd,
        { git: ["merge", "--ff-only", "--no-edit", "--quiet", candidate] },
        { uninterruptible: true },
      );
    } finally {
      try {
        actual = await gitHead(this.cwd);
        if (live.run.delivery) {
          assertRepository(live.run.delivery.binding.target);
          if (
            (await gitText(this.cwd, ["symbolic-ref", "HEAD"])).trim() !==
            live.run.delivery.binding.target.branch
          )
            actual = null;
        }
      } catch {
        actual = null;
      }
      if (actual === candidate) live.run.mergedCommit = candidate;
      if (live.run.delivery) {
        const integration = live.run.delivery.integration;
        integration.after = actual;
        integration.status =
          actual === candidate
            ? "applied"
            : actual === null
              ? "unknown"
              : "blocked";
        integration.reason =
          actual === candidate
            ? ""
            : actual === null
              ? "Target identity or outcome could not be confirmed; do not replay."
              : "Git did not leave the target at the accepted candidate.";
      }
      if (result)
        this.finishStep(
          live,
          step,
          actual === null ? { ...result, outcome: "unknown" } : result,
          `git merge --ff-only: ${result.outcome}${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}; target HEAD ${actual ? actual.slice(0, 12) : "unreadable"}${result.exitCode === 0 ? "" : `\n${result.output}`}`,
        );
      this.closeStep(live, step);
    }
    if (actual === null)
      throw new WorkflowFailure(
        "unknown",
        "The target HEAD could not be re-read after the fast-forward; whether it completed is unknown. Inspect the branch before acting; nothing will be retried.",
      );
    if (live.run.mergedCommit !== candidate) {
      if (result) this.success(result);
      throw new WorkflowRefusal(
        "stale",
        "The fast-forward did not leave the target at the candidate commit; nothing is reported as merged.",
      );
    }
  }
  private async integrate(
    live: Live,
    p: WorkflowProposal,
    scope: string[],
  ): Promise<void> {
    const delivery = live.delivery;
    if (!delivery) throw new ContractError("stale");
    try {
      await delivery.resources.mutate(
        delivery.view.binding.target.repository,
        live.abort.signal,
        async () => {
          this.assertRunning(live);
          const candidate = await delivery.assertAccepted(
            p.digest,
            live.execution,
            scope,
          );
          delivery.view.integration.before = delivery.targetHead();
          delivery.view.integration.status = "applying";
          delivery.view.integration.reason = "";
          delivery.view.postChecks = "not-run";
          live.run.phase = "integrating";
          this.save(live);
          await this.merge(live, candidate);
        },
        () => this.o.owner.state === "idle",
      );
    } catch (error) {
      if (["pending", "applied"].includes(delivery.view.integration.status))
        delivery.view.integration.status = "blocked";
      delivery.view.integration.reason = diagnosticText(
        this.describe(error),
        2048,
        this.o.secrets(),
      );
      this.save(live);
      throw error;
    }
  }
  /** Runs the current route's assignments until none is left: the agreement's,
   * as plan revisions left the ones that had not started. With nothing else
   * running and exactly one assignment able to start, it runs in the
   * candidate, as a serial plan always has. When several can start, each gets
   * its own worktree at the candidate's current commit; the owner commits its
   * work there and picks that commit onto the candidate. Assignments that run
   * together never own the same path, so a pick cannot conflict; whether
   * their results fit together is what the combined checks and review decide
   * afterwards. */
  private async assignments(
    live: Live,
    integration: string,
    p: WorkflowProposal,
  ): Promise<void> {
    const tasks = workflowOrder(p.plan.tasks);
    const delivery = live.delivery;
    // Without worktrees (direct working-copy delivery) nothing can run beside.
    const limit = delivery
      ? Math.max(1, this.o.parallel ?? PARALLEL.default)
      : 1;
    const states = new Map<string, WorkflowTaskState>(
      tasks.map((t) => [
        t.id,
        { id: t.id, title: t.title, after: [...t.after], state: "queued" },
      ]),
    );
    live.run.tasks = [...states.values()];
    const mark = (id: string, state: WorkflowTaskState["state"]) => {
      (states.get(id) as WorkflowTaskState).state = state;
      this.save(live);
    };
    /** Wakes the loop below when a revision changed what can start. */
    let revised: (() => void) | undefined;
    live.route = {
      tasks,
      revise: (route, revision) => {
        const change = revisedRoute([...states.values()], route);
        for (const id of change.superseded) {
          Object.assign(states.get(id) as WorkflowTaskState, {
            state: "superseded",
            revision,
          });
          tasks.splice(
            tasks.findIndex((t) => t.id === id),
            1,
          );
        }
        for (const task of change.rewritten) {
          tasks[tasks.findIndex((t) => t.id === task.id)] = task;
          Object.assign(states.get(task.id) as WorkflowTaskState, {
            title: task.title,
            after: [...task.after],
            revision,
          });
        }
        for (const task of change.added) {
          tasks.push(task);
          states.set(task.id, {
            id: task.id,
            title: task.title,
            after: [...task.after],
            state: "queued",
            revision,
          });
        }
        live.run.tasks = [...states.values()];
        revised?.();
        const named = (label: string, ids: string[]) =>
          ids.length ? `${label}: ${ids.join(", ")}.` : "";
        return [
          named("Assignments dropped", change.superseded),
          named(
            "Assignments rewritten",
            change.rewritten.map((t) => t.id),
          ),
          named(
            "Assignments added",
            change.added.map((t) => t.id),
          ),
        ]
          .filter(Boolean)
          .join(" ");
      },
    };
    const owned = new Map<string, string[]>();
    live.owned = owned;
    const done: string[] = [];
    const running = new Map<string, Promise<void>>();
    let failure: { error: unknown } | undefined;
    /** Whether a running assignment owns a path this one would write. */
    const contended = (task: WorkflowTask) => {
      const taken = [...owned.values()].flat();
      return (
        task.writes.some((path) => workflowCovers(taken, path)) ||
        taken.some((path) => workflowCovers(task.writes, path))
      );
    };
    const ready = () =>
      tasks.filter(
        (t) =>
          states.get(t.id)?.state === "queued" &&
          t.after.every((id) => done.includes(id)) &&
          !contended(t),
      );
    const attempt = (cwd: string, task: WorkflowTask, before: string[]) =>
      this.recoverStage(live, cwd, p, `assignment ${task.id}`, async () => {
        live.run.phase = "implementing";
        this.save(live);
        await this.editAttempt(
          live,
          cwd,
          p,
          task.id,
          this.assignment(task, before),
          owned.get(cwd) ?? task.writes,
        );
      });
    this.save(live);
    for (;;) {
      const next = failure ? [] : ready();
      if (!running.size && next.length && (limit === 1 || next.length === 1)) {
        const task = next[0];
        this.assertRunning(live);
        mark(task.id, "running");
        owned.set(integration, [...task.writes]);
        try {
          await attempt(integration, task, done);
        } catch (error) {
          mark(task.id, "failed");
          throw error;
        } finally {
          owned.delete(integration);
        }
        done.push(task.id);
        mark(task.id, "completed");
        continue;
      }
      if (delivery && next.length && running.size < limit) {
        // A child starts from the candidate's commit, so what earlier
        // assignments left there is committed before the first one forks.
        if (!running.size)
          await this.commit(
            live,
            integration,
            this.scope(live, p),
            "Cadence: assignments so far",
            await delivery.assertTip(),
            "commit-assignments",
          );
        for (const task of next.slice(0, limit - running.size)) {
          // One started earlier in this pass may now own a path of this one.
          if (contended(task)) continue;
          mark(task.id, "running");
          const child = delivery.childPath(task.id);
          owned.set(child, [...task.writes]);
          const before = [...done];
          running.set(
            task.id,
            (async () => {
              try {
                await this.gitStep(
                  live,
                  this.cwd,
                  `worktree-${task.id}`,
                  (git) => delivery.createChild(task.id, git),
                );
                await this.setup(live, child, p);
                await attempt(child, task, before);
                // After a sibling's failure nothing more is integrated; this
                // assignment's work stays in its retained worktree, not in
                // the candidate.
                if (failure) {
                  mark(task.id, "queued");
                  return;
                }
                await this.integrateChild(live, integration, child, task);
                done.push(task.id);
                mark(task.id, "completed");
              } catch (error) {
                failure ??= { error };
                mark(task.id, "failed");
              } finally {
                owned.delete(child);
                running.delete(task.id);
              }
            })(),
          );
        }
      }
      if (!running.size) break;
      // Every started assignment is joined before the stage fails or ends.
      await Promise.race([
        ...running.values(),
        new Promise<void>((resolve) => {
          revised = resolve;
        }),
      ]);
    }
    live.owned = undefined;
    live.route = undefined;
    if (failure) throw failure.error;
    if (tasks.some((t) => states.get(t.id)?.state !== "completed"))
      throw new ContractError("corrupt-selected");
  }
  /** Commits one assignment's work in its own worktree, picks that commit onto
   * the candidate and removes the worktree when nothing is left in it. */
  private async integrateChild(
    live: Live,
    integration: string,
    child: string,
    task: WorkflowTask,
  ): Promise<void> {
    const delivery = live.delivery;
    if (!delivery) throw new ContractError("stale");
    const writes = live.owned?.get(child) ?? task.writes;
    const commit = await this.commit(
      live,
      child,
      writes,
      `Cadence: assignment ${task.id}`,
      await delivery.assertTip(child),
      `commit-${task.id}`,
    );
    if (commit)
      await this.gitStep(
        live,
        integration,
        `integrate-${task.id}`,
        async (git) => {
          const before = await delivery.assertTip();
          // No worker edits the candidate while assignments run beside it.
          await assertWorkflowScope(integration, []);
          await git(["cherry-pick", "--no-edit", commit]);
          const picked = await gitHead(integration);
          await assertWorkflowCommit(integration, before, picked, writes);
          delivery.update(picked);
          delivery.applied(child, picked);
        },
      );
    else delivery.applied(child, await delivery.assertTip());
    await delivery.removeChild(child, (path, check) =>
      this.gitStep(
        live,
        this.cwd,
        `worktree-remove-${task.id}`,
        async (git) => {
          await check();
          await git(["worktree", "remove", path]);
        },
      ),
    );
  }
  private async implement(live: Live, p: WorkflowProposal) {
    const plan = p.plan;
    const allowed = workflowWrites(plan);
    const target = live.target;
    const git = plan.delivery === "local-merge";
    if (git && !target) throw new ContractError("invalid");
    const base = target?.head ?? "";
    const delivery = live.delivery;
    if (git && !delivery) throw new ContractError("stale");
    const integration = delivery?.view.worktreeRoot ?? this.cwd;
    if (delivery) {
      delivery.prepareHome();
      await this.gitStep(live, this.cwd, "worktree-integration", (run) =>
        delivery.create(run),
      );
      await assertWorktree(this.cwd, integration);
    }
    await this.setup(live, integration, p);
    await this.recoverStage(live, integration, p, "baseline", async () => {
      const checks: WorkflowStep[] = [];
      if (!(await this.checks(live, integration, plan, true, checks))) {
        const failures = checks.filter((s) => s.status !== "completed");
        throw new AttemptFailure(
          "Baseline checks failed; diagnose prerequisites without implicit installation or copying.",
          failures.map((s) => s.id),
        );
      }
    });
    if (git) {
      await this.unchangedHead(integration, base);
      await assertWorkflowScope(integration, allowed);
    }
    await this.assignments(live, integration, p);
    await this.verifyAndRepair(live, integration, p, git);
    await this.learn(live, integration, p);
    // Documentation is part of the candidate: review and checks bind its new bytes.
    if (live.knowledgeDone)
      await this.verifyAndRepair(live, integration, p, git);
    if (!git) {
      this.publish(
        live,
        this.cwd,
        plan,
        this.documents(live),
        [...live.delivered].sort(),
      );
      await this.verifyAndRepair(live, this.cwd, p, false);
      return;
    }
    if (!target || !delivery) throw new ContractError("invalid");
    const documents = this.documents(live);
    // Generated notes travel in the candidate only where a fast-forward can
    // deliver them; ignored/untracked/dirty destinations are written afterwards.
    const committed: string[] = [];
    for (const name of documents)
      if ((await documentPlacement(this.cwd, name)) === "commit")
        committed.push(name);
    const documentBefore = new Map(
      documents.map((name) => [name, pathIdentity(this.cwd, name)]),
    );
    const beforePublication = await delivery.assertTip();
    const changed = await committedPaths(integration, base, beforePublication);
    this.publish(live, integration, plan, committed, changed);
    await this.verifyAndRepair(live, integration, p, true, committed);
    // What the candidate may contain is the scope as revisions left it.
    await this.integrate(live, p, [...this.scope(live, p), ...committed]);
    const candidate = live.run.mergedCommit;
    if (!candidate) throw new ContractError("quarantine");
    for (const path of await committedPaths(this.cwd, base, candidate))
      live.delivered.add(path);
    try {
      this.assertRunning(live);
      for (const name of documents) {
        // A committed note arrived with the fast-forward. A direct note (ignored,
        // untracked or dirty destination) is always written here, never dropped.
        if (committed.includes(name) && (await tracked(this.cwd, name)))
          continue;
        this.assertRunning(live);
        const file = safeWorkflowFile(this.cwd, name),
          before = documentBefore.get(name) ?? null;
        if (before !== pathIdentity(this.cwd, name))
          throw new WorkflowRefusal(
            "conflict",
            `${name} changed during the run; the generated note was not written.`,
          );
        if (!safeDirectory(dirname(file), true))
          throw new ContractError("unavailable");
        writeFileSync(
          file,
          this.documentBody(live, plan, name, [...live.delivered].sort(), true),
          { flag: before ? "w" : "wx" },
        );
      }
      await this.recoverStage(
        live,
        integration,
        p,
        "post-merge verification",
        async () => {
          // Repairs stay in the owned candidate. Never commit the user's unrelated index.
          await delivery.assertTip();
          // Post-merge repair may have revised the scope since the last round.
          const scope = [...this.scope(live, p), ...committed];
          if (
            !delivery.view.acceptance ||
            (await assertWorkflowScope(integration, scope)).length
          ) {
            await this.verifyAndRepair(live, integration, p, true, committed);
            if (delivery.view.candidate !== live.run.mergedCommit)
              await this.integrate(live, p, scope);
          }
          const expected = live.run.mergedCommit;
          if (!expected) throw new ContractError("quarantine");
          assertRepository(delivery.view.binding.target);
          await assertTarget(
            this.cwd,
            { head: expected, branch: target.branch },
            scope,
          );
          delivery.view.postChecks = "unknown";
          this.save(live);
          const beforeSource = await sourceIdentityAsync(
            this.cwd,
            scope,
            live.abort.signal,
          );
          const checks: WorkflowStep[] = [];
          const checked = await this.checks(
            live,
            this.cwd,
            plan,
            false,
            checks,
          );
          const afterSource = await sourceIdentityAsync(
            this.cwd,
            scope,
            live.abort.signal,
          );
          if (
            beforeSource !== afterSource ||
            afterSource !== live.run.verification?.source
          )
            throw new WorkflowRefusal(
              "stale",
              "Post-merge source bytes differ from the reviewed candidate; actual changes and merge are preserved, not reported as verified delivery.",
            );
          const deliveredHead = live.run.mergedCommit;
          if (!deliveredHead) throw new ContractError("quarantine");
          await this.unchangedHead(this.cwd, deliveredHead);
          if (
            (await gitText(this.cwd, ["symbolic-ref", "HEAD"])).trim() !==
            target.branch
          )
            throw new ContractError("stale");
          delivery.view.postChecks = checked ? "passed" : "failed";
          this.save(live);
          if (!checked) {
            const failed = checks.filter((s) => s.status !== "completed");
            throw new AttemptFailure(
              "Post-merge checks failed; actual merge is retained, repairs stay in the candidate.",
              failed.map((s) => s.id),
            );
          }
        },
      );
    } catch (error) {
      if (delivery.view.postChecks === "passed")
        delivery.view.postChecks = "unknown";
      throw error;
    }
    this.assertRunning(live);
    await delivery.cleanup(async (path, check) => {
      await this.gitStep(
        live,
        this.cwd,
        "remove-merged-worktree",
        async (git) => {
          await check();
          await git(["worktree", "remove", path]);
        },
      );
    });
  }
  /** Start only against the target the approval observed; unrelated changes are fine. */
  private async assertStartable(live: Live, p: WorkflowProposal) {
    this.current();
    if (!live.execution.model) throw new ContractError("stale");
    this.o.models.assertCurrent(live.execution.model);
    if (
      p.epoch !== this.o.owner.lease.registration.epoch ||
      p.cwd !== live.execution.cwd
    )
      throw new ContractError("stale");
    const writes = workflowWrites(p.plan);
    if (live.target) await assertTarget(this.cwd, live.target, writes);
    else if ((await contentsIdentityAsync(this.cwd, writes)) !== live.declared)
      throw new WorkflowRefusal(
        "stale",
        "Declared targets changed between approval and start; nothing was edited.",
      );
  }
  private describe(error: unknown): string {
    return error instanceof WorkflowRefusal
      ? `${error.code}: ${error.detail}`
      : error instanceof ContractError
        ? error.code
        : error instanceof Error
          ? error.message
          : "Workflow failed";
  }
  private async execute(
    live: Live,
    request: WorkflowRequest,
  ): Promise<AcceptedWorkResult> {
    let failure = "";
    try {
      this.assertRunning(live);
      live.barrier = await this.o.gate.acquire(live.run.id, live.abort.signal);
      live.barrier.assertHeld();
      if (live.run.diagnostics) live.run.diagnostics.acquiredAt = Date.now();
      if (live.proposal) await this.assertStartable(live, live.proposal);
      if (live.run.delivery)
        live.delivery = new WorkflowDelivery(
          live.run.delivery,
          new RepositoryCoordination(
            this.o.coordination,
            this.cwd,
            live.run.epoch,
            live.run.id,
            () => this.o.owner.lease.assert(),
            () => this.o.owner.quarantine(),
          ),
          () => this.save(live),
        );
      live.run.status = "running";
      this.save(live);
      if (request.action === "research") {
        const answers = await settleLimited(
          this.o.parallel ?? PARALLEL.default,
          request.questions.map(
            (q, i) => () =>
              this.worker(
                live,
                this.cwd,
                `research-${i + 1}`,
                `Goal: ${request.goal}\nInvestigation: ${q}\nRead only. Cite paths and distinguish evidence, assumptions, user decisions and environment prerequisites.`,
                true,
                request.model,
                request.roots,
                "research",
              ),
          ),
        );
        let commit: string | null = null;
        try {
          commit = await gitHead(this.cwd);
        } catch {
          /* Not a Git checkout. */
        }
        for (const [i, a] of answers.entries()) {
          if (a.status === "rejected") throw a.reason;
          this.success(a.value.result);
          // An agreement can name this answer as something to read first.
          const { childRunId, id } = a.value.step;
          if (childRunId)
            this.write(this.investigationPath(childRunId), {
              run: live.run.id,
              step: id,
              question: request.questions[i],
              commit,
              at: Date.now(),
            });
        }
      } else if (live.proposal) await this.implement(live, live.proposal);
      else throw new ContractError("invalid");
      if (this.o.owner.state === "quarantined")
        throw new WorkflowFailure(
          "unknown",
          "Original operation or cleanup settlement is unknown; delivery is not reported as completed.",
        );
      if (live.abort.signal.aborted)
        throw new WorkflowFailure(
          "canceled",
          "Cancellation requested before delivery settled.",
        );
      live.run.status = "completed";
      // A delivery that departs from the agreement says so before anything else.
      const deviations = live.run.deviations ?? [];
      if (deviations.length)
        live.run.notice = this.notice(
          `Delivered with ${deviations.length} recorded deviation${deviations.length === 1 ? "" : "s"} from the agreement, each confirmed by the automatic review:`,
          deviations.map((d) => `${d.item} → ${d.delivered}`).join("\n"),
        );
    } catch (error) {
      live.run.status =
        this.o.owner.state === "quarantined"
          ? "unknown"
          : live.abort.signal.aborted
            ? "canceled"
            : error instanceof WorkflowFailure && error.outcome !== "completed"
              ? error.outcome
              : "failed";
      failure = this.describe(error);
    } finally {
      live.run.phase = "finished";
      if (live.run.diagnostics) live.run.diagnostics.settledAt = Date.now();
      if (live.delivery && this.o.owner.state === "idle") {
        try {
          live.delivery.finish();
        } catch {
          this.o.owner.quarantine();
          live.run.status = "unknown";
        }
      }
      const delivered = [...live.delivered].sort();
      live.run.notice = this.notice(
        failure,
        delivered.length
          ? `${live.run.status === "completed" ? "Changed files" : "Changed files so far"}: ${delivered.join(", ")}`
          : "",
        ...live.notes,
      );
      try {
        this.saveFinal(live);
      } catch {
        this.o.owner.quarantine();
      }
      if (this.o.owner.state === "idle") live.barrier?.release();
      this.active.delete(live.run.id);
    }
    return {
      status: this.o.owner.state === "quarantined" ? "uncertain" : "settled",
    };
  }
}
