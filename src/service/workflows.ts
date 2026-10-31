/** Persistent conversation workflow coordinator. Clients never own execution. */
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  opendirSync,
  realpathSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadAgentDefinitions } from "../agent-registry.ts";
import { launchWorkflowWorker, runProcess } from "../subagent-process.ts";
import { captureChanges } from "../task-diff.ts";
import {
  gitArguments,
  gitEnvironment,
  readBounded,
  resolveWorkspace,
  safeDirectory,
} from "../task-store.ts";
import type { RunResult } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import {
  type CheckNativeSettlement,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
} from "../worker-public.mjs";
import { sanitizeData, sanitizeText } from "../worker-redaction.mjs";
import {
  ContractError,
  canonicalJson,
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
  decodeWorkflowPlan,
  decodeWorkflowProposal,
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
  workflowOrder,
} from "./contracts/workflow.ts";
import { ConversationCapture } from "./conversations.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { AcceptedWorkResult, ServiceOwner } from "./owner.ts";
import { type FileSnapshot, hash } from "./private-files.ts";
import type { ReviewBarrier } from "./scheduler.ts";
import type { TaskActions } from "./task-actions.ts";
import {
  assertWorkflowCommit,
  assertWorkflowScope,
  assertWorktree,
  gitRead,
  projectMarkdown,
  safeWorkflowFile,
  workflowObservation,
} from "./workflow-git.ts";

const RECORD_BYTES = 384 * 1024;
interface Options {
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  actions: TaskActions;
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
  plan?: WorkflowPlan;
}
class WorkflowFailure extends Error {
  constructor(
    readonly outcome: RunResult["outcome"],
    message: string,
  ) {
    super(message);
  }
}
export class Workflows {
  private readonly root: string;
  private readonly cwd: string;
  private readonly active = new Map<string, Live>();
  private readonly grants = new Map<
    string,
    { proposalId: string; digest: string; expiresAt: number }
  >();
  constructor(private readonly o: Options) {
    this.root = join(o.coordination.directory, "workflows-v1");
    this.cwd = realpathSync(o.coordination.store.root);
    // Interrupted processes never become a replay queue after restart.
    const runs = join(this.root, "runs");
    if (this.files.directory(runs)) {
      const dir = opendirSync(runs);
      try {
        let count = 0;
        for (let e = dir.readSync(); e; e = dir.readSync()) {
          if (++count > WORKFLOW_LIMITS.runs || !e.isDirectory())
            throw new ContractError("capacity");
          const id = decodeId(e.name);
          const state = this.files.read(
            this.path(id, "state.json"),
            RECORD_BYTES,
          );
          if (!state) throw new ContractError("quarantine");
          const run = decodeWorkflowRun(
            parseWireJson(state.bytes.toString("utf8"), RECORD_BYTES),
          );
          if (["queued", "running", "unknown"].includes(run.status))
            throw new ContractError("quarantine");
        }
      } finally {
        dir.closeSync();
      }
    }
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
  private current(): void {
    this.o.owner.lease.assert();
    if (
      this.o.owner.state !== "idle" ||
      resolveWorkspace(this.o.cwd).root !== this.cwd
    )
      throw new ContractError("quarantine");
  }
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
  private observation(
    plan: WorkflowPlan,
    source = workflowObservation(this.cwd, plan),
  ) {
    return hash(
      canonicalJson({
        source,
        working:
          plan.delivery === "working-copy"
            ? captureChanges(this.cwd).fingerprint
            : null,
      }),
    );
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
  private assertProposal(
    p: WorkflowProposal,
    digest: string,
    admitted = false,
  ) {
    this.current();
    this.model(p.model, admitted);
    if (
      p.epoch !== this.o.owner.lease.registration.epoch ||
      p.digest !== digest ||
      p.cwd !== this.cwd ||
      this.observation(p.plan) !== p.observation
    )
      throw new ContractError("stale");
  }
  activeRuns(): WorkbenchResult & { kind: "workflow-active" } {
    this.o.owner.lease.assert();
    return {
      kind: "workflow-active",
      runs: [...this.active.values()].map(({ run }) => ({
        ...structuredClone(run),
        goal: run.goal.slice(0, 320),
        steps: [],
      })),
    };
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
    if (turn && turn.status === "running" && step.status !== "running") {
      turn.status = "unknown";
      turn.notice =
        "Retained transcript is incomplete; original activity is not inferred.";
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
  command(
    commandId: string,
    epoch: string,
    r: WorkflowRequest,
  ): WorkbenchResult {
    this.current();
    if (epoch !== this.o.owner.lease.registration.epoch)
      throw new ContractError("stale");
    if (r.action === "cancel") {
      const live = this.active.get(r.runId);
      if (live) live.abort.abort();
      const view = this.view(r.runId);
      return { ...view, commandId } as WorkbenchResult;
    }
    const encoded = canonicalJson(r, RECORD_BYTES);
    if (sanitizeText(encoded, this.o.secrets()) !== encoded)
      throw new ContractError("forbidden");
    if (r.action === "propose") {
      this.model(r.model);
      this.capacity();
      const plan = decodeWorkflowPlan(r.plan);
      // Exact reviewed bytes are never silently redacted into a different plan.
      if (
        sanitizeText(canonicalJson(plan), this.o.secrets()) !==
        canonicalJson(plan)
      )
        throw new ContractError("forbidden");
      const source = workflowObservation(this.cwd, plan);
      const selected = this.model(r.model);
      const p: WorkflowProposal = {
        id: commandId,
        epoch,
        model: r.model,
        plan,
        cwd: this.cwd,
        observation: this.observation(plan, source),
        display: {
          model: `${selected.provider}/${selected.model} · ${selected.thinking}`,
          branch: source.branch,
          baseCommit: source.head,
        },
        digest: hash(canonicalJson(plan)),
      };
      if (sanitizeText(canonicalJson(p), this.o.secrets()) !== canonicalJson(p))
        throw new ContractError("forbidden");
      const target = join(this.root, "proposals", `${commandId}.json`);
      const previous = this.files.read(target, RECORD_BYTES);
      if (previous) {
        if (previous.bytes.toString("utf8") !== canonicalJson(p))
          throw new ContractError("conflict");
      } else this.write(target, p);
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
      this.grants.set(grant, { proposalId: p.id, digest: p.digest, expiresAt });
      return {
        kind: "workflow",
        commandId,
        response: { type: "grant", proposal: p, grant, expiresAt },
      };
    }
    // A receipt lookup observes the same admitted original, never starts it again.
    const acceptedPath = this.path(commandId, "accepted.json");
    const prior = this.files.read(acceptedPath, RECORD_BYTES);
    if (prior) {
      if (prior.bytes.toString("utf8") !== canonicalJson({ epoch, request: r }))
        throw new ContractError("conflict");
      return { ...this.view(commandId), commandId } as WorkbenchResult;
    }
    if (this.files.directory(dirname(acceptedPath)))
      throw new ContractError("quarantine");
    let proposal: WorkflowProposal | undefined;
    if (r.action === "execute") {
      proposal = this.proposal(r.proposalId);
      this.assertProposal(proposal, r.digest);
      const grant = this.grants.get(r.grant);
      this.grants.delete(r.grant);
      if (
        !grant ||
        grant.expiresAt < Date.now() ||
        grant.proposalId !== proposal.id ||
        grant.digest !== proposal.digest
      )
        throw new ContractError("expired-grant");
    } else this.model(r.model);
    this.capacity();
    if (this.active.size >= 4) throw new ContractError("capacity");
    const run: WorkflowRun = {
      id: commandId,
      epoch,
      goal: proposal?.plan.goal ?? (r.action === "research" ? r.goal : ""),
      status: "queued",
      phase: r.action === "research" ? "research" : "implementing",
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
      original: ready.then(() => this.execute(live, r, proposal)),
      plan: proposal?.plan,
    };
    this.active.set(commandId, live);
    this.o.owner.trackConversation(live.original, () => abort.abort());
    try {
      this.write(acceptedPath, { epoch, request: r });
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
  private capacity() {
    let bytes = 0,
      count = 0;
    const visit = (path: string, depth: number) => {
      if (depth > 5 || !this.files.directory(path)) return;
      const dir = opendirSync(path);
      try {
        for (let e = dir.readSync(); e; e = dir.readSync()) {
          if (++count > 10000) throw new ContractError("capacity");
          const p = join(path, e.name);
          if (e.isDirectory()) visit(p, depth + 1);
          else if (e.isFile()) bytes += lstatSync(p).size;
          else throw new ContractError("forbidden");
          if (bytes > 512 * 1024 * 1024) throw new ContractError("capacity");
        }
      } finally {
        dir.closeSync();
      }
    };
    // Worktrees have a separate disk floor, not a traversal through consumer files.
    visit(join(this.root, "runs"), 0);
    visit(join(this.root, "proposals"), 0);
    const runDirectory = join(this.root, "runs");
    if (this.files.directory(runDirectory)) {
      const dir = opendirSync(runDirectory);
      try {
        let runs = 0;
        while (dir.readSync())
          if (++runs >= WORKFLOW_LIMITS.runs)
            throw new ContractError("capacity");
      } finally {
        dir.closeSync();
      }
    }
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
  }
  private save(live: Live) {
    if (!live.file) throw new ContractError("corrupt-selected");
    live.file = this.write(
      this.path(live.run.id, "state.json"),
      live.run,
      live.file,
    );
  }
  private assertRunning(live: Live) {
    this.current();
    const space = statfsSync(this.o.coordination.directory);
    if (space.bavail * space.bsize < LIMITS.freeSpaceFloorBytes)
      throw new ContractError("capacity");
    if (live.abort.signal.aborted) throw new ContractError("stale");
  }
  private step(
    live: Live,
    id: string,
    kind: WorkflowStep["kind"],
    childRunId?: string,
  ): WorkflowStep {
    if (live.run.steps.length >= 256) throw new ContractError("capacity");
    const s: WorkflowStep = {
      id: `${id.slice(0, 80)}-${randomUUID()}`,
      ...(childRunId ? { childRunId } : {}),
      kind,
      status: "running",
      text: "",
      exitCode: null,
      truncated: false,
    };
    live.run.steps.push(s);
    this.save(live);
    return s;
  }
  private sanitizeResult(result: RunResult): RunResult {
    const secrets = this.o.secrets();
    return {
      ...result,
      text: sanitizeText(result.text, secrets),
      output: sanitizeText(result.output, secrets),
    };
  }
  private finishStep(live: Live, s: WorkflowStep, original: RunResult) {
    const result = this.sanitizeResult(original);
    this.write(this.path(live.run.id, `results/${hash(s.id)}.json`), {
      stepId: s.id,
      result,
    });
    s.status = result.outcome;
    s.text = diagnosticText(
      result.text || result.output,
      s.kind === "research" ? 16384 : 1024,
      this.o.secrets(),
    );
    s.exitCode = result.exitCode;
    s.truncated =
      result.truncated ||
      Buffer.byteLength(result.text || result.output) >
        Buffer.byteLength(s.text);
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
  ): Promise<RunResult> {
    this.assertRunning(live);
    const model = this.model(version, true);
    const role = loadAgentDefinitions().find(
      (r) =>
        r.role === (readonly ? "design-explorer" : "implementation-worker"),
    );
    if (!role) throw new ContractError("unavailable");
    const childRunId = randomUUID(),
      op = randomUUID();
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
      context: live.plan
        ? workflowContext(live.plan)
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
        if (cwd !== this.cwd) assertWorktree(this.cwd, cwd);
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
      const result = await auth.result;
      if (result.status !== "prepared" || !current())
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
      const capture = new ConversationCapture(
        transcript,
        saveTranscript,
        () => [...this.o.secrets(), ...credentials],
      );
      const running = Promise.resolve().then(() =>
        launchWorkflowWorker(result.prepared, cwd, live.abort.signal, {
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
            capture.accept(frame);
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
        // CaptureState's raw preview may cut through an owner literal. Select
        // the actual final message from the already sanitized full transcript,
        // then bound it; never persist a pre-sanitization clipped prefix.
        const selected = transcript.items.find(
          (item) => item.id === selectedMessageId && item.role === "assistant",
        );
        if (!selected) throw new ContractError("corrupt-selected");
        const text = sanitizeText(selected.text, [
          ...this.o.secrets(),
          ...credentials,
        ]);
        completed.text = diagnosticText(text, 16384);
        completed.truncated ||= Buffer.byteLength(text) > 16384;
      }
      transcript.status = completed.outcome;
      saveTranscript();
      this.finishStep(live, step, completed);
      return completed;
    } finally {
      await auth.settled;
      if (step.status === "running") {
        step.status =
          this.o.owner.state === "quarantined"
            ? "unknown"
            : live.abort.signal.aborted
              ? "canceled"
              : "failed";
        step.text =
          "Worker did not produce a completed native/recorded result.";
        this.save(live);
      }
    }
  }
  private async process(
    live: Live,
    cwd: string,
    args: string[] | WorkflowCheck,
    title: string,
  ): Promise<RunResult> {
    this.assertRunning(live);
    if (cwd !== this.cwd && !Array.isArray(args)) assertWorktree(this.cwd, cwd);
    const id = randomUUID();
    this.write(this.path(live.run.id, `operations/${id}-intent.json`), {
      cwd,
      args,
    });
    let native: CheckNativeSettlement | undefined;
    const shell = !Array.isArray(args);
    const step = shell ? this.step(live, title, "check") : undefined;
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
            ? ["/d", "/s", "/c", `"${args.command}"`]
            : ["-c", args.command]
          : gitArguments([
              "-c",
              `core.hooksPath=${join(this.root, "empty-hooks")}`,
              "-c",
              "commit.gpgsign=false",
              "-c",
              "gc.auto=0",
              "-c",
              "maintenance.auto=false",
              ...args,
            ]),
        windowsVerbatimArguments:
          shell && process.platform === "win32" ? true : undefined,
        cwd,
        env: shell ? environment : gitEnvironment(),
        signal: live.abort.signal,
        timeoutMs: shell ? args.timeoutMs : 30000,
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
    if (step) this.finishStep(live, step, result);
    return result;
  }
  private success(result: RunResult) {
    if (
      result.outcome !== "completed" ||
      !result.closed ||
      result.exitCode !== 0
    )
      throw new WorkflowFailure(
        result.outcome,
        `Operation ${result.outcome}: ${diagnosticText(result.text || result.output, 512, this.o.secrets())}`,
      );
  }
  private async git(live: Live, cwd: string, args: string[]) {
    this.success(await this.process(live, cwd, args, "git"));
  }
  private async setup(live: Live, cwd: string, plan: WorkflowPlan) {
    for (const c of plan.setup)
      this.success(await this.process(live, cwd, c, `setup: ${c.name}`));
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
      const r = await this.process(live, cwd, c, c.name);
      if (!r.closed || r.outcome === "canceled" || r.outcome === "timeout")
        this.success(r);
      passed &&= r.outcome === "completed" && r.exitCode === 0;
    }
    return passed;
  }
  private unchangedHead(cwd: string, before: string): void {
    if (gitRead(cwd, ["rev-parse", "HEAD"]).trim() !== before)
      throw new ContractError("stale");
  }
  private async commit(
    live: Live,
    cwd: string,
    allowed: string[],
    message: string,
    before: string,
  ): Promise<string | null> {
    this.unchangedHead(cwd, before);
    const changes = assertWorkflowScope(cwd, allowed);
    if (!changes.length) return null;
    await this.git(live, cwd, ["add", "--", ...changes]);
    assertWorkflowScope(cwd, allowed);
    this.unchangedHead(cwd, before);
    if (
      !gitRead(cwd, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
      ])
    )
      return null;
    await this.git(live, cwd, ["commit", "--no-verify", "-m", message]);
    const commit = gitRead(cwd, ["rev-parse", "HEAD"]).trim();
    assertWorkflowCommit(cwd, before, commit, allowed);
    return commit;
  }
  private async review(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
  ): Promise<boolean> {
    live.run.phase = "reviewing";
    this.save(live);
    const r = await this.worker(
      live,
      cwd,
      `review-${randomUUID()}`,
      `Independently inspect the implemented files against the approved plan and acceptance. Look for missing behavior, regressions, weakened tests and scope violations. Do not edit or run commands. Reply with exactly JSON {"approved":true|false,"summary":"...","blockingIssues":["..."]}. Automatic review is not human review.\nFiles: ${p.plan.tasks.flatMap((t) => t.writes).join(", ")}`,
      true,
      p.model,
    );
    this.success(r);
    try {
      const raw = r.text
        .trim()
        .replace(/^```(?:json)?\s*/u, "")
        .replace(/\s*```$/u, "");
      const verdict = JSON.parse(raw);
      return (
        verdict.approved === true &&
        Array.isArray(verdict.blockingIssues) &&
        verdict.blockingIssues.length === 0
      );
    } catch {
      return false;
    }
  }
  private async verifyAndRepair(
    live: Live,
    cwd: string,
    p: WorkflowProposal,
    git: boolean,
  ) {
    const allowed = p.plan.tasks.flatMap((t) => t.writes);
    for (let attempt = 0; attempt <= p.plan.repairAttempts; attempt++) {
      const beforeChecks = git
        ? gitRead(cwd, ["rev-parse", "HEAD"]).trim()
        : "";
      const reviewed = await this.review(live, cwd, p);
      const checked = await this.checks(live, cwd, p.plan);
      if (git) {
        this.unchangedHead(cwd, beforeChecks);
        assertWorkflowScope(cwd, allowed);
      }
      if (reviewed && checked) return;
      if (attempt === p.plan.repairAttempts)
        throw new Error(
          "Verification/review failed; repair budget exhausted. Artifacts preserved; nothing merged.",
        );
      const failures = live.run.steps
        .filter((s) => s.kind === "check" || s.kind === "review")
        .slice(-8);
      const beforeRepair = git
        ? gitRead(cwd, ["rev-parse", "HEAD"]).trim()
        : "";
      const repair = await this.worker(
        live,
        cwd,
        `repair-${attempt + 1}`,
        `Repair only within approved paths and acceptance. Do not remove or weaken tests, install dependencies, change scope or Git. If a product decision is missing, stop and report it.\nAllowed files: ${allowed.join(", ")}\nObserved failures/review: ${canonicalJson(failures, 65536)}`,
        false,
        p.model,
      );
      this.success(repair);
      if (git)
        await this.commit(
          live,
          cwd,
          allowed,
          `Cadence: bounded repair ${attempt + 1}`,
          beforeRepair,
        );
    }
  }
  private publish(live: Live, cwd: string, plan: WorkflowPlan): string[] {
    const base = `.cadence/assistant/workflows/${live.run.id}`;
    const documents = new Map<string, string>([
      [`${base}/plan.md`, readableWorkflowPlan(plan)],
      [
        `${base}/result.md`,
        `# Verified candidate\n\n${live.run.steps.map((s) => `- ${s.kind} ${s.id}: ${s.status}${s.exitCode === null ? "" : ` (exit ${s.exitCode})`}`).join("\n")}\n\nAutomatic review, not human review. Final integration/native outcomes are retained by the owner.\n`,
      ],
    ]);
    if (plan.projectContext)
      documents.set(
        ".cadence/project.md",
        projectMarkdown(cwd, plan.projectContext),
      );
    for (const [name, body] of documents) {
      const file = safeWorkflowFile(cwd, name);
      if (!safeDirectory(dirname(file), true))
        throw new ContractError("forbidden");
      writeFileSync(file, body, {
        flag: name === ".cadence/project.md" ? "w" : "wx",
      });
    }
    return [...documents.keys()];
  }
  private async implement(live: Live, p: WorkflowProposal) {
    const plan = p.plan;
    if (plan.delivery === "working-copy") {
      await this.setup(live, this.cwd, plan);
      if (!(await this.checks(live, this.cwd, plan, true)))
        throw new Error("Baseline checks failed; no implementation started.");
      for (const task of workflowOrder(plan.tasks)) {
        live.run.phase = "implementing";
        this.save(live);
        this.success(
          await this.worker(
            live,
            this.cwd,
            task.id,
            `${task.instructions}\nWrite only these exact files: ${task.writes.join(", ")}`,
            false,
            p.model,
          ),
        );
      }
      await this.verifyAndRepair(live, this.cwd, p, false);
      this.publish(live, this.cwd, plan);
      if (!(await this.checks(live, this.cwd, plan)))
        throw new Error(
          "Post-publication checks failed; direct working-copy edits preserved.",
        );
      return;
    }
    const initial = workflowObservation(this.cwd, plan);
    const home = join(this.root, "worktrees", live.run.id);
    this.files.directory(home, true);
    // Task identifiers never share the candidate/coordination namespace.
    const taskHome = join(home, "tasks");
    this.files.directory(taskHome, true);
    const integration = join(home, "integration");
    await this.git(live, this.cwd, [
      "worktree",
      "add",
      "--detach",
      integration,
      initial.head,
    ]);
    assertWorktree(this.cwd, integration);
    await this.setup(live, integration, plan);
    assertWorkflowScope(integration, []);
    if (!(await this.checks(live, integration, plan, true)))
      throw new Error(
        "Candidate baseline checks failed. Configure worktree prerequisites in the plan; no implicit dependency installation or copying.",
      );
    this.unchangedHead(integration, initial.head);
    const commits = new Map<string, string | null>(),
      pending = new Set(plan.tasks.map((t) => t.id));
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
          await this.git(live, this.cwd, [
            "worktree",
            "add",
            "--detach",
            cwd,
            initial.head,
          ]);
          for (const dep of workflowAncestors(plan.tasks, task.id)) {
            const commit = commits.get(dep.id);
            if (commit)
              await this.git(live, cwd, ["cherry-pick", "--no-edit", commit]);
          }
          const beforeWorker = gitRead(cwd, ["rev-parse", "HEAD"]).trim();
          await this.setup(live, cwd, plan);
          this.unchangedHead(cwd, beforeWorker);
          assertWorkflowScope(cwd, []);
          this.success(
            await this.worker(
              live,
              cwd,
              task.id,
              `${task.instructions}\nWrite only these exact files: ${task.writes.join(", ")}. Dependencies are already applied to this worktree.`,
              false,
              p.model,
            ),
          );
          const commit = await this.commit(
            live,
            cwd,
            task.writes,
            `Cadence: ${task.title}`,
            beforeWorker,
          );
          commits.set(task.id, commit);
          pending.delete(task.id);
        }),
      );
      const failed = outcomes.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    for (const task of workflowOrder(plan.tasks)) {
      const commit = commits.get(task.id);
      if (commit)
        await this.git(live, integration, ["cherry-pick", "--no-edit", commit]);
    }
    await this.verifyAndRepair(live, integration, p, true);
    const documentNames = [
      `.cadence/assistant/workflows/${live.run.id}/plan.md`,
      `.cadence/assistant/workflows/${live.run.id}/result.md`,
      ...(plan.projectContext ? [".cadence/project.md"] : []),
    ];
    const documentBefore = new Map(
      documentNames.map((p) => [
        p,
        readBounded(safeWorkflowFile(this.cwd, p), 128 * 1024),
      ]),
    );
    const beforePublication = gitRead(integration, [
      "rev-parse",
      "HEAD",
    ]).trim();
    const documents = this.publish(live, integration, plan);
    await this.commit(
      live,
      integration,
      documents,
      "Cadence: project context and delivery notes",
      beforePublication,
    );
    const head = gitRead(integration, ["rev-parse", "HEAD"]).trim();
    if (!(await this.checks(live, integration, plan)))
      throw new Error("Final candidate checks failed; nothing merged.");
    this.unchangedHead(integration, head);
    assertWorkflowScope(integration, []);
    this.assertProposal(p, p.digest, true);
    live.run.phase = "integrating";
    this.save(live);
    await this.git(live, this.cwd, ["merge", "--ff-only", "--no-edit", head]);
    live.run.mergedCommit = head;
    this.save(live);
    for (const name of documents) {
      if (gitRead(this.cwd, ["ls-files", "--", name]).trim()) continue;
      const file = safeWorkflowFile(this.cwd, name),
        before = documentBefore.get(name),
        now = readBounded(file, 128 * 1024);
      if ((before ? hash(before) : null) !== (now ? hash(now) : null))
        throw new ContractError("conflict");
      const content =
        name === ".cadence/project.md"
          ? projectMarkdown(this.cwd, plan.projectContext)
          : readBounded(safeWorkflowFile(integration, name), 128 * 1024);
      if (content === undefined || !safeDirectory(dirname(file), true))
        throw new ContractError("unavailable");
      writeFileSync(file, content, { flag: before ? "w" : "wx" });
    }
    if (!(await this.checks(live, this.cwd, plan)))
      throw new Error(
        "Local merge completed, but post-merge checks failed. No reset or rollback was attempted.",
      );
    this.unchangedHead(this.cwd, head);
  }
  private async execute(
    live: Live,
    request: WorkflowRequest,
    proposal?: WorkflowProposal,
  ): Promise<AcceptedWorkResult> {
    let barrier: ReviewBarrier | undefined;
    let budgetExpired = false;
    const timer = setTimeout(() => {
      budgetExpired = true;
      live.abort.abort();
    }, WORKFLOW_LIMITS.durationMs);
    try {
      this.assertRunning(live);
      barrier = await this.o.actions.scheduler.conversationBarrier(
        live.run.id,
        live.abort.signal,
      );
      barrier.assertHeld();
      this.o.actions.conversationBoundary(barrier);
      if (proposal) this.assertProposal(proposal, proposal.digest, true);
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
          this.success(a.value);
        }
      } else if (proposal) await this.implement(live, proposal);
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
      live.run.notice = diagnosticText(
        error instanceof ContractError
          ? error.code
          : error instanceof Error
            ? error.message
            : "Workflow failed",
        2048,
        this.o.secrets(),
      );
    } finally {
      clearTimeout(timer);
      live.run.phase = "finished";
      try {
        if (barrier && this.o.owner.state === "idle")
          this.o.actions.conversationBoundary(barrier);
        this.save(live);
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
