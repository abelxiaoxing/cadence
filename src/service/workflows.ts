/** Persistent conversation workflow coordinator. Clients never own execution. */
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  opendirSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadAgentDefinitions } from "../agent-registry.ts";
import { launchWorkflowWorker, runProcess } from "../subagent-process.ts";
import { captureChanges } from "../task-diff.ts";
import type { RunResult } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import {
  type CaptureFrame,
  type CheckNativeSettlement,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
} from "../worker-public.mjs";
import { sanitizeData, sanitizeText } from "../worker-redaction.mjs";
import {
  gitArguments,
  gitEnvironment,
  resolveWorkspace,
  safeDirectory,
} from "../workspace.ts";
import type { CheckoutGate, CheckoutPermit } from "./checkout-gate.ts";
import {
  ContractError,
  canonicalJson,
  closed,
  decodeId,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import type { ChoiceVersion } from "./contracts/models.ts";
import {
  type ChatTurn,
  decodeChatTurn,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import {
  clipUnits,
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  decodeWorkflowRequest,
  decodeWorkflowRun,
  readableWorkflowPlan,
  WORKFLOW_LIMITS,
  type WorkflowCheck,
  type WorkflowPlan,
  type WorkflowProposal,
  type WorkflowRequest,
  type WorkflowRun,
  type WorkflowStep,
  workflowAncestors,
  workflowContext,
  workflowCovers,
  workflowOrder,
} from "./contracts/workflow.ts";
import { ConversationCapture } from "./conversations.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { type FileSnapshot, hash } from "./private-files.ts";
import { UnacceptedConversationCommand } from "./workbench-send-refusal.ts";
import {
  assertTarget,
  assertWorkflowCommit,
  assertWorkflowScope,
  assertWorktree,
  committedPaths,
  contentsIdentity,
  contentsIdentityAsync,
  documentPlacement,
  gitHead,
  gitRun,
  nested,
  pathIdentity,
  projectMarkdown,
  safeWorkflowFile,
  scopeResidue,
  snapshotChanges,
  tracked,
  WorkflowRefusal,
  workflowObservation,
  workingSnapshot,
} from "./workflow-git.ts";
import { WorkflowHistoryScanner } from "./workflow-history.ts";

const RECORD_BYTES = 384 * 1024;
const MAX_STEPS = 256;
const STEP_UNITS = 80;
const MAX_ACTIVE = 4;
/** Private-worktree Git operations: realistic for large repositories. */
const GIT_MS = 10 * 60 * 1000;
const RESTARTED =
  "The owner restarted before this run settled. Its outcome is not inferred and nothing was replayed; worktrees and any partial edits are retained for inspection.";
const TRANSCRIPT_LIMIT =
  "Transcript bound reached: later worker activity was not retained here. The worker continued; its outcome and final result are recorded separately.";
const FINAL_UNAVAILABLE =
  "The final message exceeded the retained transcript bound and was not retained.";

interface Options {
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  gate: CheckoutGate;
  cwd: string;
  checkEnvironment?: Readonly<NodeJS.ProcessEnv>;
  secrets(): readonly string[];
  timeoutMs?: number;
}
interface Live {
  run: WorkflowRun;
  abort: AbortController;
  file?: FileSnapshot;
  original: Promise<AcceptedWorkResult>;
  proposal?: WorkflowProposal;
  /** Target observed at admission (local-merge) or declared-target identity (working copy). */
  target?: { head: string; branch: string };
  declared?: string;
  delivered: Set<string>;
  notes: string[];
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
/** Accepts the requested JSON verdict alone, fenced, or embedded in prose. */
export function reviewVerdict(
  reply: string,
): { approved: boolean; summary: string; blockingIssues: string[] } | null {
  const decode = (raw: string) => {
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.approved !== "boolean") return null;
    const issues = o.blockingIssues === undefined ? [] : o.blockingIssues;
    if (
      !Array.isArray(issues) ||
      issues.some((issue) => typeof issue !== "string")
    )
      return null;
    return {
      approved: o.approved && issues.length === 0,
      summary: typeof o.summary === "string" ? o.summary : "",
      blockingIssues: issues as string[],
    };
  };
  const body = reply.trim();
  const direct = decode(body);
  if (direct) return direct;
  // Every parseable verdict object in the reply must agree; an example and a
  // contrary answer side by side is ambiguous, never an approval.
  const found: NonNullable<ReturnType<typeof decode>>[] = [];
  let starts = 0;
  for (
    let start = body.indexOf("{");
    start >= 0 && starts < 64;
    start = body.indexOf("{", start + 1), starts++
  ) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const verdict = decode(body.slice(start, i + 1));
        if (verdict) found.push(verdict);
        break;
      }
    }
  }
  if (!found.length || found.some((v) => v.approved !== found[0].approved))
    return null;
  return found[0];
}
/** Workflow worker transcript. Its bound limits what is retained, never the
 * worker: past the bound a labelled prefix is kept and the worker continues.
 * The latest assistant message is tracked separately so the final result is
 * selected from sanitized complete text, never a raw clipped preview. */
export class WorkflowTranscript {
  overflowed = false;
  private pending = false;
  private readonly capture: ConversationCapture;
  /** Null while the current assistant message exceeds the tracker's bound. */
  private final: ConversationCapture | null = null;
  private latest: ChatTurn;
  private readonly messageDetails = new Set<string>();
  constructor(
    readonly turn: ChatTurn,
    private readonly secrets: () => readonly string[],
  ) {
    this.capture = new ConversationCapture(
      turn,
      () => {
        this.pending = true;
      },
      secrets,
    );
    this.latest = { ...structuredClone(turn), items: [] };
  }
  /** True when the retained transcript should be persisted now. */
  accept(frame: CaptureFrame): boolean {
    this.track(frame);
    if (this.overflowed) return false;
    try {
      this.capture.accept(frame);
    } catch {
      this.overflowed = true;
      this.turn.notice = TRANSCRIPT_LIMIT;
      this.turn.omitted.other = true;
      this.trimToBound();
      return true;
    }
    const save = this.pending;
    this.pending = false;
    return save;
  }
  private trimToBound(): void {
    for (;;) {
      try {
        canonicalJson(this.turn, RECORD_BYTES - 4096);
        return;
      } catch {
        if (!this.turn.items.length) return;
        this.turn.items.pop();
      }
    }
  }
  private track(frame: CaptureFrame): void {
    const e = frame.event;
    let relevant = false;
    if (e.kind === "message-start") {
      if (e.role === "assistant") {
        // Each assistant message starts a fresh bounded tracker.
        this.latest = { ...structuredClone(this.latest), items: [] };
        this.final = new ConversationCapture(
          this.latest,
          () => {},
          this.secrets,
        );
      }
      relevant = true;
    } else if (e.kind === "message-end") relevant = true;
    else if (e.kind === "detail-begin") {
      const owner = e.descriptor.owner.kind;
      if (owner === "message" || owner === "message-final") {
        this.messageDetails.add(e.detailId);
        relevant = true;
      }
    } else if (e.kind === "detail-chunk" || e.kind === "detail-end") {
      relevant = this.messageDetails.has(e.detailId);
      if (e.kind === "detail-end") this.messageDetails.delete(e.detailId);
    }
    if (!relevant || !this.final) return;
    try {
      this.final.accept(frame);
    } catch {
      this.final = null;
    }
  }
  /** Sanitized complete text of the selected final message, if retained. A
   * partially retained message is never returned as the final result. */
  selected(messageId: string | undefined): string | undefined {
    const find = (turn: ChatTurn) =>
      turn.items.find((i) => i.id === messageId && i.role === "assistant")
        ?.text;
    return (
      (this.final ? find(this.latest) : undefined) ??
      (this.overflowed ? undefined : find(this.turn))
    );
  }
  get complete(): boolean {
    return !this.overflowed && !!this.final;
  }
}

export class Workflows {
  private readonly historyScanner: WorkflowHistoryScanner;
  private readonly root: string;
  private readonly cwd: string;
  private readonly worktreeRoot: string;
  private readonly active = new Map<string, Live>();
  private readonly grants = new Map<
    string,
    { commandId: string; proposalId: string; digest: string; expiresAt: number }
  >();
  constructor(private readonly o: Options) {
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
      resolveWorkspace(this.o.cwd).root !== this.cwd
    )
      throw new ContractError("quarantine");
  }
  private floor(): void {
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
  }
  /** Exact model choice before admission; after admission access rotation is ignored. */
  private model(version: ChoiceVersion, admitted = false) {
    const state = this.o.choice.snapshot();
    if (
      !state.selected ||
      (admitted
        ? state.version.epoch !== version.epoch ||
          state.version.configRev !== version.configRev ||
          state.version.catalogId !== version.catalogId
        : canonicalJson(state.version) !== canonicalJson(version))
    )
      throw new ContractError("stale");
    this.o.models.assertCurrent(state.selected);
    return state.selected;
  }
  private observation(plan: WorkflowPlan) {
    const source = workflowObservation(this.cwd, plan);
    return {
      source,
      digest: hash(
        canonicalJson({
          source,
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
        "This proposal predates the current plan rules (task IDs over 48 characters or invisible characters in write paths). Publish a revised plan; nothing was started.",
      );
    }
    this.model(p.model);
    const observed = this.observation(p.plan);
    if (
      p.epoch !== this.o.owner.lease.registration.epoch ||
      p.digest !== digest ||
      p.cwd !== this.cwd ||
      observed.digest !== p.observation
    )
      throw new ContractError("stale");
    return observed.source;
  }
  activeRuns(): WorkbenchResult & { kind: "workflow-active" } {
    this.o.owner.lease.assert();
    return {
      kind: "workflow-active",
      runs: [...this.active.values()].map(({ run }) => ({
        ...structuredClone(run),
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
  view(id: string): WorkbenchResult {
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
    if (!live && ["running", "queued"].includes(run.status))
      run.status = "unknown";
    return {
      kind: "workflow",
      commandId: null,
      response: { type: "run", run },
    };
  }
  transcript(id: string, stepId: string): WorkbenchResult {
    const view = this.view(id);
    if (view.kind !== "workflow" || view.response.type !== "run")
      throw new ContractError("unavailable");
    const run = view.response.run,
      step = run.steps.find((s) => s.id === stepId);
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
    }
    return { kind: "workflow-transcript", runId: id, stepId, turn };
  }
  detail(id: string, stepId: string): WorkbenchResult {
    const view = this.view(id);
    if (
      view.kind !== "workflow" ||
      view.response.type !== "run" ||
      !view.response.run.steps.some((s) => s.id === stepId)
    )
      throw new ContractError("invalid");
    const file = this.files.read(
      this.path(id, `results/${hash(stepId)}.json`),
      RECORD_BYTES,
    );
    if (!file) throw new ContractError("unavailable");
    return {
      kind: "file",
      path: `workflow/${id}/${stepId}`,
      // Read projection also protects pre-fix records and newly known literals.
      // Never rewrite retained consumer records while observing them.
      text: sanitizeData(
        parseWireJson(file.bytes.toString("utf8"), RECORD_BYTES),
        this.o.secrets(),
      ),
      limited: false,
    };
  }
  /** Cancel is an observation plus a stop request; it stays available while the
   * owner is quarantined or stopping (which have already requested stops). */
  private cancel(commandId: string, epoch: string, runId: string) {
    this.o.owner.lease.assert();
    if (epoch !== this.o.owner.lease.registration.epoch)
      throw new ContractError("stale");
    this.active.get(runId)?.abort.abort();
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
      const { source, digest } = this.observation(plan);
      const selected = this.model(r.model);
      const p: WorkflowProposal = {
        id: commandId,
        epoch,
        model: r.model,
        plan,
        cwd: this.cwd,
        observation: digest,
        display: {
          model: `${selected.provider}/${selected.model} · ${selected.thinking}`,
          branch: source.branch,
          baseCommit: source.head,
        },
        digest: hash(canonicalJson(plan)),
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
    let target: Live["target"];
    let declared: string | undefined;
    if (request.action === "execute") {
      proposal = this.proposal(request.proposalId);
      const source = this.assertProposal(proposal, request.digest);
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
      const writes = proposal.plan.tasks.flatMap((t) => t.writes);
      effect();
      this.grants.delete(request.grant);
      if (proposal.plan.delivery === "local-merge")
        target = { head: source.head, branch: source.branch };
      else declared = contentsIdentity(this.cwd, writes);
    } else if (request.action === "research") {
      this.model(request.model);
      this.capacity();
    } else throw new ContractError("invalid");
    const run: WorkflowRun = {
      id: commandId,
      epoch,
      goal:
        proposal?.plan.goal ??
        (request.action === "research" ? request.goal : ""),
      status: "queued",
      phase: request.action === "research" ? "research" : "implementing",
      steps: [],
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
    this.o.owner.trackConversation(live.original, () => abort.abort());
    try {
      this.write(acceptedPath, { epoch, request });
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
    if (live.abort.signal.aborted) throw new ContractError("stale");
  }
  private step(
    live: Live,
    id: string,
    kind: WorkflowStep["kind"],
    childRunId?: string,
  ): WorkflowStep {
    if (live.run.steps.length >= MAX_STEPS) throw new ContractError("capacity");
    const s: WorkflowStep = {
      id: `${clipUnits(id, STEP_UNITS)}-${randomUUID()}`,
      ...(childRunId ? { childRunId } : {}),
      kind,
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
    const secrets = this.o.secrets();
    return {
      ...result,
      text: sanitizeText(result.text, secrets),
      output: sanitizeText(result.output, secrets),
    };
  }
  private finishStep(
    live: Live,
    s: WorkflowStep,
    original: RunResult,
    preview?: string,
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
  ): Promise<{ result: RunResult; step: WorkflowStep }> {
    this.assertRunning(live);
    const model = this.model(version, true);
    const role = loadAgentDefinitions().find(
      (r) =>
        r.role === (readonly ? "design-explorer" : "implementation-worker"),
    );
    if (!role) throw new ContractError("unavailable");
    if (cwd !== this.cwd) await assertWorktree(this.cwd, cwd);
    const childRunId = randomUUID(),
      op = randomUUID();
    const plan = live.proposal?.plan;
    const request = decodeWorkerPublicRequest({
      protocol: 2,
      taskId: live.run.id,
      taskKind: readonly ? "research" : "code",
      runId: live.run.id,
      childRunId,
      assignmentId: id,
      purpose: readonly ? "research" : "edit",
      model,
      role: { role: role.role, sha256: role.sha256 },
      context: plan
        ? workflowContext(plan)
        : "Read applicable AGENTS.md and existing project documentation, including .cadence/project.md. Cite evidence and separate observations from assumptions.",
      instructions: `${role.content}\nRead applicable AGENTS.md, existing project conventions and relevant tests before work. Do not delegate, retry, mutate Git, install dependencies, publish or deploy. Report actual work and uncertainty. Do not weaken tests to manufacture success. Worker completion is not verification.`,
      prompt: text(prompt, 32768, true),
      handoff: { graphRevision: 1, inputs: [] },
    });
    const step = this.step(
      live,
      id,
      readonly
        ? live.run.phase === "research"
          ? "research"
          : "review"
        : "implementation",
      childRunId,
    );
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
      request,
      operationId: op,
      epoch: live.run.epoch,
      timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
      signal: live.abort.signal,
      current,
      journal: {
        preparation: (v) => {
          this.write(this.path(live.run.id, `auth/${op}-intent.json`), v);
        },
        settlement: (v) => {
          this.write(this.path(live.run.id, `auth/${op}-settled.json`), v);
        },
      },
    });
    try {
      const prepared = await auth.result;
      if (prepared.status !== "prepared" || !current())
        throw new ContractError("auth-unavailable");
      this.write(this.path(live.run.id, `launches/${childRunId}.json`), {
        cwd,
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
        launchWorkflowWorker(prepared.prepared, cwd, live.abort.signal, {
          timeoutMs: this.o.timeoutMs ?? LIMITS.workerMs,
          ownerSecrets: this.o.secrets(),
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
        () => live.abort.abort(),
      );
      const completed = this.sanitizeResult(await running);
      if (completed.outcome === "completed") {
        // The runner's preview may cut through an owner literal before it is
        // sanitized: use the sanitized complete message, then bound it.
        const selected = recorder.selected(selectedMessageId);
        if (selected === undefined) {
          if (recorder.complete) throw new ContractError("corrupt-selected");
          completed.text = FINAL_UNAVAILABLE;
          completed.truncated = true;
        } else {
          const final = sanitizeText(selected, [
            ...this.o.secrets(),
            ...credentials,
          ]);
          completed.text = diagnosticText(final, 16384);
          completed.truncated ||= Buffer.byteLength(final) > 16384;
        }
      }
      transcript.status = completed.outcome;
      saveTranscript();
      this.finishStep(live, step, completed);
      return { result: completed, step };
    } finally {
      await auth.settled;
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
    if (cwd !== this.cwd && shell) await assertWorktree(this.cwd, cwd);
    const id = randomUUID();
    this.write(this.path(live.run.id, `operations/${id}-intent.json`), {
      cwd,
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
        cwd,
        env: shell ? environment : gitEnvironment(),
        // An uninterruptible operation is never tied to the run's cancellation.
        signal: options.uninterruptible
          ? new AbortController().signal
          : live.abort.signal,
        uninterruptible: options.uninterruptible,
        timeoutMs: shell ? operation.check.timeoutMs : GIT_MS,
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
      () => live.abort.abort(),
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
  ): Promise<RunResult> {
    const step = this.step(live, title, "check");
    try {
      const result = await this.run(live, cwd, { check: c });
      this.finishStep(live, step, result);
      return result;
    } finally {
      this.closeStep(live, step);
    }
  }
  private success(result: RunResult) {
    if (
      result.outcome !== "completed" ||
      !result.closed ||
      result.exitCode !== 0
    )
      throw new WorkflowFailure(
        result.outcome === "completed" ? "failed" : result.outcome,
        `Operation ${result.outcome}: ${diagnosticText(result.output || result.text, 512, this.o.secrets())}`,
      );
  }
  /** Visible Git step; several commands of one logical operation share it. */
  private async gitStep<T>(
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
        this.success(result);
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
  private async setup(live: Live, cwd: string, plan: WorkflowPlan) {
    for (const c of plan.setup)
      this.success(await this.check(live, cwd, c, `setup: ${c.name}`));
  }
  private async checks(
    live: Live,
    cwd: string,
    plan: WorkflowPlan,
    baseline = false,
  ): Promise<boolean> {
    live.run.phase = "verifying";
    this.save(live);
    let passed = true;
    for (const c of baseline ? plan.baselineChecks : plan.checks) {
      const r = await this.check(live, cwd, c, c.name);
      if (!r.closed || r.outcome === "canceled" || r.outcome === "timeout")
        this.success(r);
      passed &&= r.outcome === "completed" && r.exitCode === 0;
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
      return commit;
    });
  }
  private async review(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
  ): Promise<Verdict> {
    live.run.phase = "reviewing";
    this.save(live);
    const { result, step } = await this.worker(
      live,
      cwd,
      `review-${randomUUID()}`,
      `Independently inspect the implemented files against the approved plan and acceptance. Look for missing behavior, regressions, weakened tests and scope violations. Do not edit or run commands. Reply with exactly JSON {"approved":true|false,"summary":"...","blockingIssues":["..."]}. Automatic review is not human review.\nFiles: ${p.plan.tasks.flatMap((t) => t.writes).join(", ")}`,
      true,
      p.model,
    );
    this.success(result);
    const verdict = reviewVerdict(result.text);
    step.status = verdict?.approved ? "completed" : "failed";
    step.text = diagnosticText(
      verdict
        ? verdict.approved
          ? `Agent review approved (automatic, not human review). ${verdict.summary}`
          : `Agent review rejected: ${[verdict.summary, ...verdict.blockingIssues].filter(Boolean).join(" | ") || "no reason given"}`
        : `Agent review reply could not be parsed as a verdict${result.truncated ? " (the reply was clipped)" : ""}; it is not counted as approval.`,
      1024,
      this.o.secrets(),
    );
    this.save(live);
    return verdict
      ? verdict.approved
        ? "approved"
        : "rejected"
      : "unparseable";
  }
  /** Working-copy edits are attributed per worker; out-of-scope paths fail the
   * run with the list. Actual edits are preserved, never reverted. */
  private async scoped<T>(
    live: Live,
    allowed: string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const before = await workingSnapshot(this.cwd, allowed);
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const after = await workingSnapshot(this.cwd, [
      ...allowed,
      ...before.paths.keys(),
    ]);
    const changed = snapshotChanges(before.paths, after.paths);
    const outside = changed.filter((p) => !workflowCovers(allowed, p));
    for (const p of changed)
      if (workflowCovers(allowed, p)) live.delivered.add(p);
    if (outside.length) {
      const detail = `Working-copy edits outside the approved scope were preserved, not reverted: ${outside.slice(0, 32).join(", ")}${outside.length > 32 ? ` and ${outside.length - 32} more` : ""}`;
      if (outcome.ok) throw new WorkflowRefusal("forbidden", detail);
      live.notes.push(detail);
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  private async verifyAndRepair(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    git: boolean,
  ) {
    const allowed = p.plan.tasks.flatMap((t) => t.writes);
    for (let attempt = 0; attempt <= p.plan.repairAttempts; attempt++) {
      const beforeChecks = git ? await gitHead(cwd) : "";
      const verdict = await this.review(live, cwd, p);
      const checked = await this.checks(live, cwd, p.plan);
      if (git) {
        await this.unchangedHead(cwd, beforeChecks);
        await assertWorkflowScope(cwd, allowed);
      }
      if (verdict === "approved" && checked) return;
      // An unreadable verdict has nothing to repair: report it, do not spend rounds.
      if (verdict === "unparseable" && checked)
        throw new Error(
          "Checks passed, but the automatic review reply could not be parsed as a verdict; nothing was delivered without an Agent review approval.",
        );
      if (attempt === p.plan.repairAttempts)
        throw new Error(
          `${checked ? "" : "Checks failed. "}${verdict === "rejected" ? "Agent review rejected the candidate. " : verdict === "unparseable" ? "Agent review reply could not be parsed. " : ""}Verification/review failed; repair budget exhausted. Artifacts preserved; nothing merged.`,
        );
      const failures = live.run.steps
        .filter((s) => s.kind === "check" || s.kind === "review")
        .slice(-8);
      const beforeRepair = git ? await gitHead(cwd) : "";
      const repair = () =>
        this.worker(
          live,
          cwd,
          `repair-${attempt + 1}`,
          `Repair only within approved paths and acceptance. Do not remove or weaken tests, install dependencies, change scope or Git. If a product decision is missing, stop and report it.\nAllowed paths (directories include their contents): ${allowed.join(", ")}\nObserved failures/review: ${canonicalJson(failures, 65536)}`,
          false,
          p.model,
        );
      this.success(
        (git ? await repair() : await this.scoped(live, allowed, repair))
          .result,
      );
      if (git)
        await this.commit(
          live,
          cwd,
          allowed,
          `Cadence: bounded repair ${attempt + 1}`,
          beforeRepair,
          `commit-repair-${attempt + 1}`,
        );
    }
  }
  private documents(live: Live, plan: WorkflowPlan): string[] {
    const base = `.cadence/assistant/workflows/${live.run.id}`;
    return [
      `${base}/plan.md`,
      `${base}/result.md`,
      ...(plan.projectContext ? [".cadence/project.md"] : []),
    ];
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
    cwd: string,
    plan: WorkflowPlan,
    name: string,
    changed: string[],
    merged = false,
  ): string {
    if (name === ".cadence/project.md")
      return projectMarkdown(cwd, plan.projectContext);
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
    for (const name of names) {
      const file = safeWorkflowFile(cwd, name);
      if (!safeDirectory(dirname(file), true))
        throw new ContractError("forbidden");
      writeFileSync(file, this.documentBody(live, cwd, plan, name, changed), {
        flag: name === ".cadence/project.md" ? "w" : "wx",
      });
    }
  }
  /** New run worktrees live outside the private namespace and the checkout. */
  private worktreeHome(id: string): string {
    if (nested(this.cwd, this.worktreeRoot))
      throw new ContractError("unsupported-context");
    for (const directory of [dirname(this.worktreeRoot), this.worktreeRoot]) {
      if (!safeDirectory(directory, true)) throw new ContractError("forbidden");
      const st = lstatSync(directory);
      if (
        process.platform !== "win32" &&
        ((st.mode & 0o077) !== 0 ||
          (process.getuid && st.uid !== process.getuid()))
      )
        throw new ContractError("forbidden");
    }
    const home = join(this.worktreeRoot, decodeId(id));
    if (safeDirectory(home)) throw new ContractError("conflict"); // never adopt contents
    safeDirectory(join(home, "tasks"), true);
    return home;
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
      } catch {
        actual = null;
      }
      if (actual === candidate) live.run.mergedCommit = candidate;
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
  /** Plain `git worktree remove` of clean worktrees at their expected commit.
   * Git's refusal (untracked/modified files) retains the worktree. */
  private async removeWorktrees(
    live: Live,
    entries: { path: string; expected: string; scope: string[] }[],
    home: string,
  ) {
    const removed: string[] = [],
      retained: string[] = [];
    const step = this.step(live, "remove-merged-worktrees", "git");
    try {
      for (const { path, expected, scope } of entries) {
        const label = path.slice(home.length + 1);
        try {
          if ((await gitHead(path)) !== expected) {
            retained.push(`${label} (HEAD moved)`);
            continue;
          }
          // `git worktree remove` deletes ignored files: anything left under an
          // approved path (including ignored edits) keeps the worktree.
          const residue = await scopeResidue(path, scope);
          if (residue.length) {
            retained.push(
              `${label} (uncommitted or ignored files under approved paths: ${residue.slice(0, 8).join(", ")}${residue.length > 8 ? ", …" : ""})`,
            );
            continue;
          }
          const r = await this.run(live, this.cwd, {
            git: ["worktree", "remove", path],
          });
          if (r.outcome === "completed" && r.exitCode === 0)
            removed.push(label);
          else
            retained.push(
              `${label} (${diagnosticText(r.output, 160, this.o.secrets()).trim() || "git refused"})`,
            );
        } catch (error) {
          retained.push(`${label} (${this.describe(error)})`);
        }
      }
      step.status = "completed";
      step.text = diagnosticText(
        [
          removed.length ? `Removed: ${removed.join(", ")}` : "",
          retained.length ? `Retained: ${retained.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join("\n") || "No worktree to remove.",
        1024,
        this.o.secrets(),
      );
      this.save(live);
    } finally {
      this.closeStep(live, step);
    }
    for (const directory of [join(home, "tasks"), home])
      try {
        rmdirSync(directory); // Only ever succeeds when already empty.
      } catch {
        /* Retained: not empty or not removable. */
      }
    if (retained.length)
      live.notes.push(`Retained worktrees: ${retained.join("; ")}`);
  }
  private async implement(live: Live, p: WorkflowProposal) {
    const plan = p.plan;
    const allowed = plan.tasks.flatMap((t) => t.writes);
    if (plan.delivery === "working-copy") {
      await this.setup(live, this.cwd, plan);
      if (!(await this.checks(live, this.cwd, plan, true)))
        throw new Error("Baseline checks failed; no implementation started.");
      for (const task of workflowOrder(plan.tasks)) {
        live.run.phase = "implementing";
        this.save(live);
        const { result } = await this.scoped(live, allowed, () =>
          this.worker(
            live,
            this.cwd,
            task.id,
            `${task.instructions}\nWrite only these exact files: ${task.writes.join(", ")} (a declared directory includes its contents)`,
            false,
            p.model,
          ),
        );
        this.success(result);
      }
      await this.verifyAndRepair(live, this.cwd, p, false);
      this.publish(
        live,
        this.cwd,
        plan,
        this.documents(live, plan),
        [...live.delivered].sort(),
      );
      if (!(await this.checks(live, this.cwd, plan)))
        throw new Error(
          "Post-publication checks failed; direct working-copy edits preserved.",
        );
      return;
    }
    const target = live.target;
    if (!target) throw new ContractError("invalid");
    const base = target.head;
    const home = this.worktreeHome(live.run.id);
    // Task identifiers never share the candidate/coordination namespace.
    const taskHome = join(home, "tasks");
    const integration = join(home, "integration");
    await this.gitStep(live, this.cwd, "worktree-integration", (git) =>
      git(["worktree", "add", "--detach", integration, base]),
    );
    await assertWorktree(this.cwd, integration);
    await this.setup(live, integration, plan);
    await assertWorkflowScope(integration, []);
    if (!(await this.checks(live, integration, plan, true)))
      throw new Error(
        "Candidate baseline checks failed. Configure worktree prerequisites in the plan; no implicit dependency installation or copying.",
      );
    await this.unchangedHead(integration, base);
    const commits = new Map<string, string | null>(),
      pending = new Set(plan.tasks.map((t) => t.id)),
      worktrees: { path: string; expected: string; scope: string[] }[] = [];
    while (pending.size) {
      this.assertRunning(live);
      const batch = workflowOrder(plan.tasks)
        .filter(
          (t) => pending.has(t.id) && t.after.every((d) => commits.has(d)),
        )
        .slice(0, WORKFLOW_LIMITS.parallel);
      if (!batch.length) throw new ContractError("invalid");
      live.run.phase = "implementing";
      this.save(live);
      // Join every already-launched sibling before failing or releasing the gate.
      const outcomes = await Promise.allSettled(
        batch.map(async (task) => {
          const cwd = join(taskHome, task.id);
          await this.gitStep(live, this.cwd, `worktree-${task.id}`, (git) =>
            git(["worktree", "add", "--detach", cwd, base]),
          );
          const picks = workflowAncestors(plan.tasks, task.id)
            .map((dep) => commits.get(dep.id))
            .filter((c): c is string => !!c);
          if (picks.length)
            await this.gitStep(
              live,
              cwd,
              `dependencies-${task.id}`,
              async (git) => {
                for (const commit of picks)
                  await git(["cherry-pick", "--no-edit", commit]);
              },
            );
          const beforeWorker = await gitHead(cwd);
          worktrees.push({
            path: cwd,
            expected: beforeWorker,
            scope: task.writes,
          });
          await this.setup(live, cwd, plan);
          await this.unchangedHead(cwd, beforeWorker);
          await assertWorkflowScope(cwd, []);
          this.success(
            (
              await this.worker(
                live,
                cwd,
                task.id,
                `${task.instructions}\nWrite only these exact files: ${task.writes.join(", ")} (a declared directory includes its contents). Dependencies are already applied to this worktree.`,
                false,
                p.model,
              )
            ).result,
          );
          const commit = await this.commit(
            live,
            cwd,
            task.writes,
            `Cadence: ${task.title}`,
            beforeWorker,
            `commit-${task.id}`,
          );
          if (commit)
            worktrees[worktrees.findIndex((w) => w.path === cwd)].expected =
              commit;
          commits.set(task.id, commit);
          pending.delete(task.id);
        }),
      );
      const failed = outcomes.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    const picks = workflowOrder(plan.tasks)
      .map((t) => commits.get(t.id))
      .filter((c): c is string => !!c);
    if (picks.length)
      await this.gitStep(
        live,
        integration,
        "integrate-task-commits",
        async (git) => {
          for (const commit of picks)
            await git(["cherry-pick", "--no-edit", commit]);
        },
      );
    await this.verifyAndRepair(live, integration, p, true);
    const documents = this.documents(live, plan);
    // Generated notes travel in the candidate only where a fast-forward can
    // deliver them; ignored/untracked/dirty destinations are written afterwards.
    const committed: string[] = [];
    for (const name of documents)
      if ((await documentPlacement(this.cwd, name)) === "commit")
        committed.push(name);
    const documentBefore = new Map(
      documents.map((name) => [name, pathIdentity(this.cwd, name)]),
    );
    const beforePublication = await gitHead(integration);
    const changed = await committedPaths(integration, base, beforePublication);
    this.publish(live, integration, plan, committed, changed);
    await this.commit(
      live,
      integration,
      committed,
      "Cadence: project context and delivery notes",
      beforePublication,
      "commit-delivery-notes",
    );
    const candidate = await gitHead(integration);
    if (!(await this.checks(live, integration, plan)))
      throw new Error("Final candidate checks failed; nothing merged.");
    await this.unchangedHead(integration, candidate);
    await assertWorkflowScope(integration, []);
    // Only what a safe fast-forward needs; `merge --ff-only` refuses other overlaps.
    this.assertRunning(live);
    await assertTarget(this.cwd, target, [...allowed, ...committed]);
    live.run.phase = "integrating";
    this.save(live);
    await this.merge(live, candidate);
    for (const path of await committedPaths(this.cwd, base, candidate))
      live.delivered.add(path);
    try {
      for (const name of documents) {
        // A committed note arrived with the fast-forward. A direct note (ignored,
        // untracked or dirty destination) is always written here, never dropped.
        if (committed.includes(name) && (await tracked(this.cwd, name)))
          continue;
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
          this.documentBody(
            live,
            this.cwd,
            plan,
            name,
            [...live.delivered].sort(),
            true,
          ),
          { flag: before ? "w" : "wx" },
        );
      }
      if (!(await this.checks(live, this.cwd, plan)))
        throw new Error(
          "Local merge completed, but post-merge checks failed. No reset or rollback was attempted.",
        );
      await this.unchangedHead(this.cwd, candidate);
    } finally {
      if (!live.abort.signal.aborted)
        try {
          await this.removeWorktrees(
            live,
            [
              ...worktrees,
              {
                path: integration,
                expected: candidate,
                scope: [...allowed, ...committed],
              },
            ],
            home,
          );
        } catch (error) {
          live.notes.push(
            `Worktrees retained: removal did not complete (${this.describe(error)}).`,
          );
        }
    }
  }
  /** Start only against the target the approval observed; unrelated changes are fine. */
  private async assertStartable(live: Live, p: WorkflowProposal) {
    this.current();
    this.model(p.model, true);
    if (p.epoch !== this.o.owner.lease.registration.epoch || p.cwd !== this.cwd)
      throw new ContractError("stale");
    const writes = p.plan.tasks.flatMap((t) => t.writes);
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
    let barrier: CheckoutPermit | undefined;
    let budgetExpired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failure = "";
    try {
      this.assertRunning(live);
      barrier = await this.o.gate.acquire(live.run.id, live.abort.signal);
      barrier.assertHeld();
      // The budget covers the run's own work, not time queued for the gate.
      timer = setTimeout(() => {
        budgetExpired = true;
        live.abort.abort();
      }, WORKFLOW_LIMITS.durationMs);
      if (live.proposal) await this.assertStartable(live, live.proposal);
      live.run.status = "running";
      this.save(live);
      if (request.action === "research") {
        const answers = await Promise.allSettled(
          request.questions.map((q, i) =>
            this.worker(
              live,
              this.cwd,
              `research-${i + 1}`,
              `Goal: ${request.goal}\nInvestigation: ${q}\nRead only. Cite paths and distinguish evidence, assumptions, user decisions and environment prerequisites.`,
              true,
              request.model,
            ),
          ),
        );
        for (const a of answers) {
          if (a.status === "rejected") throw a.reason;
          this.success(a.value.result);
        }
      } else if (live.proposal) await this.implement(live, live.proposal);
      else throw new ContractError("invalid");
      live.run.status = "completed";
    } catch (error) {
      live.run.status =
        this.o.owner.state === "quarantined"
          ? "unknown"
          : budgetExpired
            ? "timeout"
            : live.abort.signal.aborted
              ? "canceled"
              : error instanceof WorkflowFailure &&
                  error.outcome !== "completed"
                ? error.outcome
                : "failed";
      failure = this.describe(error);
    } finally {
      clearTimeout(timer);
      live.run.phase = "finished";
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
      if (this.o.owner.state === "idle") barrier?.release();
      this.active.delete(live.run.id);
    }
    return {
      status: this.o.owner.state === "quarantined" ? "uncertain" : "settled",
    };
  }
}
