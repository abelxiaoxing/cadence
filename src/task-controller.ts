import { randomUUID } from "node:crypto";
import { runCheck, runWorker, type WorkerRequest } from "./subagent-process.ts";
import { captureChanges } from "./task-diff.ts";
import {
  type CheckoutLock,
  savedRecordIdentity,
  type TaskStore,
} from "./task-store.ts";
import {
  type ChangeView,
  type CheckDefinition,
  type CheckRecord,
  type RunResult,
  TASK_SCHEMA,
  type TaskKind,
  type TaskRecord,
} from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

export interface CurrentChoice {
  generation: number;
  id: string;
  revision: number;
  identity: string;
}
export interface ControllerServices {
  capture: typeof captureChanges;
  worker: typeof runWorker;
  check: typeof runCheck;
}
/** Current native choices authorize a work session, not future bytes or a transaction. */
export class TaskController {
  private task: TaskRecord | undefined;
  private generation = 0;
  private persistedIdentity = "";
  private active:
    | { abort: AbortController; settled: Promise<void> }
    | undefined;
  private unknownStop = false;
  constructor(
    readonly store: TaskStore,
    readonly cwd: string,
    private readonly services: ControllerServices = {
      capture: captureChanges,
      worker: runWorker,
      check: runCheck,
    },
  ) {}
  get busy(): boolean {
    return this.active !== undefined;
  }
  get blocked(): boolean {
    return this.unknownStop;
  }
  get current(): TaskRecord | undefined {
    return this.task && structuredClone(this.task);
  }
  choice(): CurrentChoice {
    if (!this.task) throw new Error("No task selected");
    return {
      generation: this.generation,
      id: this.task.id,
      revision: this.task.revision,
      identity: this.persistedIdentity,
    };
  }
  assertCurrent(choice: CurrentChoice): TaskRecord {
    if (
      this.busy ||
      this.unknownStop ||
      choice.generation !== this.generation ||
      choice.id !== this.task?.id ||
      choice.revision !== this.task?.revision ||
      choice.identity !== this.persistedIdentity
    )
      throw new Error("Stale choice or active/unresolved work");
    this.assertPersisted(choice.id);
    return structuredClone(this.task);
  }
  private assertPersisted(id: string): void {
    if (this.store.loadSnapshot(id)?.identity !== this.persistedIdentity)
      throw new Error("Task changed; reopen it");
  }
  create(kind: TaskKind, goal: string): TaskRecord {
    if (this.busy || this.unknownStop)
      throw new Error("Work is active or unresolved");
    const task: TaskRecord = {
      schema: TASK_SCHEMA,
      id: randomUUID(),
      revision: 1,
      kind,
      goal,
      plan: "",
      cwd: this.cwd,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    };
    this.task = this.store.save(task, 0);
    this.persistedIdentity = savedRecordIdentity(this.task);
    this.generation++;
    return this.current as TaskRecord;
  }
  open(id: string): TaskRecord {
    if (this.busy || this.unknownStop)
      throw new Error("Work is active or unresolved");
    const snapshot = this.store.loadSnapshot(id);
    if (!snapshot) throw new Error("Task not found");
    const task = snapshot.record;
    this.persistedIdentity = snapshot.identity;
    // Reopen is context only. A crashed running record is projected as interrupted, not resumed.
    if (task.phase === "running") {
      task.phase = "interrupted";
      task.result =
        "Previous work was interrupted; files may have changed. Inspect the lock and working copy. Continue is a new explicit run.";
    }
    this.task = task;
    this.generation++;
    return this.current as TaskRecord;
  }
  private save(task: TaskRecord, text: string, lock?: CheckoutLock): void {
    const expected = task.revision;
    task.revision++;
    task.activity = [
      ...task.activity,
      { at: new Date().toISOString(), text: diagnosticText(text, 512) },
    ].slice(-64);
    this.task = this.store.save(task, expected, lock, this.persistedIdentity);
    this.persistedIdentity = savedRecordIdentity(this.task);
    this.generation++;
  }
  editPlan(choice: CurrentChoice, plan: string): void {
    const task = this.assertCurrent(choice);
    task.plan = plan;
    task.phase = "planning";
    delete task.review;
    for (const check of task.checks) check.status = "stale";
    this.save(task, "Plan edited; prior review/check freshness invalidated");
  }
  observe(): ChangeView {
    return this.services.capture(this.store.root);
  }
  checkStatuses(view: ChangeView): string {
    if (this.task && this.task.kind !== "code" && !this.task.checks.length)
      return "Checks: not applicable to readonly conclusions; evidence/unavailable sources require human review (not certified)";
    const missing = this.unrunConfiguredChecks().map(
      (check) => `${check.name}: not-run (current configured command)`,
    );
    if (!this.task?.checks.length && !missing.length) return "Checks: not-run";
    return [
      ...missing,
      ...(this.task?.checks ?? []).map(
        (check) =>
          `${check.name}: ${check.fingerprint === view.fingerprint ? check.status : "stale"} (exit ${check.exitCode ?? "unknown"}, ${check.durationMs}ms)`,
      ),
    ].join("\n");
  }
  private unrunConfiguredChecks(): CheckDefinition[] {
    if (this.task?.kind !== "code") return [];
    return this.store
      .checks()
      .filter(
        (definition) =>
          !this.task?.checks.some(
            (check) =>
              check.name === definition.name &&
              check.command === definition.command &&
              check.timeoutMs === definition.timeoutMs,
          ),
      );
  }
  async start(
    choice: CurrentChoice,
    prepare: (task: TaskRecord, signal: AbortSignal) => Promise<WorkerRequest>,
    currentContext: () => boolean,
    onProgress?: (text: string) => void,
  ): Promise<RunResult> {
    return this.runAgent(choice, prepare, currentContext, onProgress, false);
  }
  async generatePlan(
    choice: CurrentChoice,
    prepare: (task: TaskRecord, signal: AbortSignal) => Promise<WorkerRequest>,
    currentContext: () => boolean,
    onProgress?: (text: string) => void,
  ): Promise<RunResult> {
    return this.runAgent(choice, prepare, currentContext, onProgress, true);
  }
  private async runAgent(
    choice: CurrentChoice,
    prepare: (task: TaskRecord, signal: AbortSignal) => Promise<WorkerRequest>,
    currentContext: () => boolean,
    onProgress: ((text: string) => void) | undefined,
    planning: boolean,
  ): Promise<RunResult> {
    const task = this.assertCurrent(choice);
    if (planning && task.kind !== "code")
      throw new Error("Plan generation is for code tasks");
    if (!planning && task.kind === "code" && !task.plan.trim())
      throw new Error("Review a readable plan before Start");
    if (!currentContext()) throw new Error("Host context changed");
    return this.operation(
      task,
      async (signal, lock, launched) => {
        const baseline = this.observe();
        task.baseline = diagnosticText(baseline.text, 16384);
        task.phase = "running";
        delete task.review;
        for (const check of task.checks) check.status = "stale";
        this.save(
          task,
          planning
            ? "Explicit readonly plan generation; no implementation consent"
            : "Explicit Start/Continue; direct working-copy edits are not transactional",
          lock,
        );
        const kind = planning ? "research" : task.kind;
        const request = await prepare(
          { ...structuredClone(task), kind },
          signal,
        );
        if (signal.aborted || !currentContext())
          throw new Error("Canceled or stale host before launch");
        this.assertPersisted(task.id);
        launched();
        // Tool selection follows the selected action, never a caller/model-provided escalation.
        return this.services.worker({ ...request, kind }, signal, onProgress);
      },
      planning
        ? (result) => {
            if (result.outcome === "completed" && result.text.trim()) {
              task.plan = diagnosticText(result.text, 32768);
              task.result =
                "Advisory readonly plan draft generated. Review/edit it and explicitly Start to implement; no code work has started.";
              return "planning";
            }
            if (result.outcome === "completed") result.outcome = "failed";
            task.result = diagnosticText(
              `Plan generation ${result.outcome}; prior plan retained. ${result.text}`,
              16384,
            );
          }
        : undefined,
    );
  }
  async check(
    choice: CurrentChoice,
    definition: CheckDefinition,
    currentContext: () => boolean,
  ): Promise<RunResult> {
    const task = this.assertCurrent(choice);
    if (task.kind !== "code")
      throw new Error("Parent shell checks require a code task");
    if (!currentContext()) throw new Error("Host context changed");
    let before: ChangeView | undefined;
    return this.operation(
      task,
      async (signal, lock, launched) => {
        before = this.observe();
        task.phase = "running";
        delete task.review;
        this.save(task, `Explicit parent check: ${definition.name}`, lock);
        if (signal.aborted || !currentContext())
          throw new Error("Canceled or stale host before check");
        launched();
        return this.services.check(definition, this.cwd, signal);
      },
      (result, after, log) => {
        const record: CheckRecord = {
          ...definition,
          cwd: this.cwd,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          log,
          status:
            before?.fingerprint !== after.fingerprint
              ? "stale"
              : result.outcome === "completed" && result.exitCode === 0
                ? "passed"
                : result.outcome === "canceled"
                  ? "canceled"
                  : "failed",
          fingerprint: before?.fingerprint ?? "",
        };
        task.checks = [
          ...task.checks.filter((check) => check.name !== definition.name),
          record,
        ].slice(-32);
      },
    );
  }
  private async operation(
    task: TaskRecord,
    body: (
      signal: AbortSignal,
      lock: CheckoutLock,
      launched: () => void,
    ) => Promise<RunResult>,
    finish?: (
      result: RunResult,
      after: ChangeView,
      log: string,
    ) => TaskRecord["phase"] | undefined,
  ): Promise<RunResult> {
    const lock = this.store.acquire();
    const abort = new AbortController();
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.active = { abort, settled };
    let result: RunResult | undefined;
    let launched = false;
    let failure: unknown;
    try {
      try {
        result = await body(abort.signal, lock, () => {
          launched = true;
        });
      } catch {
        result = {
          outcome: launched
            ? "unknown"
            : abort.signal.aborted
              ? "canceled"
              : "failed",
          closed: !launched,
          exitCode: null,
          signal: null,
          durationMs: 0,
          text: "Run unavailable or interrupted before a confirmed result",
          output: "",
          truncated: false,
        };
      }
      if (!result.closed) this.unknownStop = true;
      const after = this.observe();
      for (const check of task.checks)
        if (check.fingerprint !== after.fingerprint) check.status = "stale";
      const log = this.store.writeLog(lock, result.output);
      const finishedPhase = finish?.(result, after, log);
      if (!finish) task.result = diagnosticText(result.text, 16384);
      task.phase =
        finishedPhase ??
        (result.outcome === "completed"
          ? "review"
          : result.outcome === "failed"
            ? "failed"
            : "interrupted");
      this.save(
        task,
        `${result.outcome}; ${result.closed ? "no outstanding direct child; descendants not certified" : "stop unknown; lock retained"}`,
        lock,
      );
    } catch (error) {
      failure = error;
    } finally {
      try {
        if (result?.closed && !this.unknownStop) this.store.release(lock);
        else this.unknownStop = true;
      } catch (error) {
        this.unknownStop = true;
        failure ??= error;
      } finally {
        this.active = undefined;
        this.generation++;
        settle();
      }
    }
    if (failure) throw failure;
    if (!result) throw new Error("No settled result");
    return result;
  }
  done(
    choice: CurrentChoice,
    reviewed: ChangeView,
    acceptIssues: boolean,
  ): void {
    const task = this.assertCurrent(choice);
    const now = this.observe();
    if (now.fingerprint !== reviewed.fingerprint)
      throw new Error("Files changed after review; review again");
    for (const check of task.checks)
      if (check.fingerprint !== now.fingerprint) check.status = "stale";
    const issues =
      !now.complete ||
      task.phase !== "review" ||
      (task.kind === "code" && !task.checks.length) ||
      this.unrunConfiguredChecks().length > 0 ||
      task.checks.some((check) => check.status !== "passed");
    if (issues && !acceptIssues)
      throw new Error(
        "Unresolved/unrun/stale checks require explicit acknowledgment",
      );
    task.phase = "done";
    task.review = {
      fingerprint: now.fingerprint,
      outcome: issues ? "reviewed-with-issues" : "reviewed",
    };
    this.save(task, `Human ${task.review.outcome}; not certified`);
  }
  async cancel(): Promise<void> {
    this.generation++;
    const active = this.active;
    if (!active) return;
    active.abort.abort();
    await active.settled;
  }
}
