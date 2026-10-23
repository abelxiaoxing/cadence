/** One finite per-run reducer, shared by admission validation and historical reads.
 * No SDK construction, current-context inference, transcript cache or restart replay. */
import type {
  AdmissionIntent,
  AuthPreparationIntent,
  AuthPreparationSettlement,
} from "../service/ports.ts";
import {
  type CaptureCoverage,
  ContractError,
  canonicalJson,
  compareSequence,
  type OwnerFact,
  type OwnerLink,
  type RecordingLink,
  type RunIdentity,
  type RunProjection,
  type RunSettlement,
  type StoredCommand,
  settlementOutcome,
  type WorkerCompletion,
} from "../service-contract.ts";
import { emptyScan, type HistoryFiles, HistoryReadBudget } from "./files.ts";
import {
  COMPLETE,
  captureCoverage,
  combineCoverage,
  type JournalRow,
} from "./types.ts";

export const uncertainSettlement = (completion: WorkerCompletion): boolean =>
  completion.native.closure === "unconfirmed" ||
  (completion.recording.status === "pending" &&
    completion.recording.selected !== null) ||
  completion.recording.status === "uncertain";

export function readRunState(
  files: HistoryFiles,
  runId: string,
  snapshotSeq?: string,
  budget = HistoryReadBudget.authority(),
): RunState {
  const state = new RunState(runId);
  if (snapshotSeq === "0") return state;
  for (const batch of files.scan(emptyScan(), false, budget)) {
    if (snapshotSeq && BigInt(batch.marker.last) > BigInt(snapshotSeq))
      throw new ContractError("corrupt-selected");
    for (const row of batch.rows) state.apply(row, batch.marker.last);
    if (snapshotSeq === batch.marker.last) return state;
  }
  if (snapshotSeq) throw new ContractError("corrupt-selected");
  return state;
}

const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new ContractError("corrupt-selected");
}
interface AuthState {
  intent: AuthPreparationIntent;
  result: AuthPreparationSettlement | null;
}
interface ChildFact {
  coverage: CaptureCoverage;
  link: RecordingLink;
  completion: WorkerCompletion | null;
  settlementSeq: string | null;
}
export interface PublicationState {
  intent: Extract<OwnerFact, { kind: "publication-intent" }> | null;
  status: StoredCommand["receipt"]["publication"];
  seq: string | null;
}
/** The same publication transition validates run and metadata-only operations. */
function publicationTransition(
  state: PublicationState,
  initial: { revision: number; identity: string | null },
  fact: Extract<
    OwnerFact,
    { kind: "publication-intent" | "publication-settled" }
  >,
  seq: string,
): PublicationState {
  if (fact.kind === "publication-intent") {
    requireFact(
      (!state.intent && state.status === "pending") ||
        state.status === "published",
    );
    requireFact(
      fact.expectedRevision ===
        (state.intent?.nextRevision ?? initial.revision) &&
        fact.expectedIdentity ===
          (state.intent?.nextIdentity ?? initial.identity),
    );
    return { intent: fact, status: "pending", seq };
  }
  // A pre-effect refusal has no candidate bytes to name. It can ONLY close
  // admission as uncertain, never claim a successful save or enable replay.
  if (
    ((!state.intent && state.status === "pending") ||
      (state.intent &&
        state.status === "published" &&
        fact.publicationId !== state.intent.publicationId)) &&
    fact.status === "uncertain" &&
    fact.observed === null
  )
    return { ...state, status: "uncertain", seq };
  requireFact(
    state.intent &&
      state.status === "pending" &&
      fact.publicationId === state.intent.publicationId,
  );
  if (fact.status === "published")
    requireFact(
      fact.observed?.revision === state.intent.nextRevision &&
        fact.observed.identity === state.intent.nextIdentity,
    );
  return { ...state, status: fact.status, seq };
}

export interface LineageProgress {
  operationId: string | null;
  state: PublicationState;
  endpoint: { revision: number; identity: string | null } | null;
  graphIdentity: string | null;
}
/** Bounded current-plan lineage, sharing the exact publication transition with
 * run/operation receipts. One task operation at a time; its progress may resume
 * only from the owner writer's remembered task fold state, whose operation
 * admission is re-read from the original journal. */
export class TaskPublicationLineage {
  private operation: AdmissionIntent | null = null;
  private state: PublicationState = {
    intent: null,
    status: "pending",
    seq: null,
  };
  private endpoint: { revision: number; identity: string | null } | null = null;
  private graphIdentity: string | null = null;
  apply(
    row: JournalRow,
    seq: string,
    taskId: string,
    savedGraphIdentity: string,
  ): void {
    const v = row.value;
    if (
      v.kind === "admission" &&
      v.intent.identity.kind === "action" &&
      v.intent.identity.expected.task?.id === taskId
    ) {
      const i = v.intent.identity;
      requireFact(i.expected.task);
      if (i.action.kind === "save-plan") {
        this.endpoint = {
          revision: i.expected.task.revision,
          identity: i.expected.task.identity,
        };
        this.graphIdentity = savedGraphIdentity;
      } else if (this.operation) {
        requireFact(
          this.state.status === "published" &&
            this.endpoint &&
            i.expected.task.revision === this.endpoint.revision &&
            i.expected.task.identity === this.endpoint.identity &&
            i.expected.task.graphIdentity === this.graphIdentity,
        );
      } else return;
      this.operation = v.intent;
      this.state = { intent: null, status: "pending", seq: null };
    }
    if (
      !this.operation ||
      v.kind !== "owner" ||
      v.link.operationId !== this.operation.operationId
    )
      return;
    const i = this.operation.identity;
    requireFact(i.kind === "action" && i.expected.task);
    for (const e of v.events) {
      if (
        e.kind !== "owner" ||
        e.value.kind !== "fact" ||
        (e.value.fact.kind !== "publication-intent" &&
          e.value.fact.kind !== "publication-settled")
      )
        continue;
      requireFact(
        v.link.taskId === taskId &&
          v.link.epoch === i.expected.epoch &&
          v.link.runId === this.operation.runId,
      );
      this.state = publicationTransition(
        this.state,
        i.expected.task,
        e.value.fact,
        seq,
      );
      if (this.state.status === "published" && this.state.intent)
        this.endpoint = {
          revision: this.state.intent.nextRevision,
          identity: this.state.intent.nextIdentity,
        };
    }
  }
  get operationId(): string | null {
    return this.operation?.operationId ?? null;
  }
  progress(): LineageProgress {
    return {
      operationId: this.operation?.operationId ?? null,
      state: structuredClone(this.state),
      endpoint: this.endpoint && { ...this.endpoint },
      graphIdentity: this.graphIdentity,
    };
  }
  /** `operation` is the re-read original admission named by `progress`. */
  static resumed(
    operation: AdmissionIntent | null,
    progress: LineageProgress,
  ): TaskPublicationLineage {
    if ((operation?.operationId ?? null) !== progress.operationId)
      throw new ContractError("invalid");
    const lineage = new TaskPublicationLineage();
    lineage.operation = operation;
    lineage.state = structuredClone(progress.state);
    lineage.endpoint = progress.endpoint && { ...progress.endpoint };
    lineage.graphIdentity = progress.graphIdentity;
    return lineage;
  }
  current(): { revision: number; identity: string } {
    requireFact(
      this.operation &&
        this.state.status === "published" &&
        this.endpoint?.identity,
    );
    return {
      revision: this.endpoint.revision,
      identity: this.endpoint.identity,
    };
  }
}

/** Metadata receipts are not execution receipts. Reduce their own accepted operation,
 * including publication, with no all-history operation cache or current authority;
 * only a remembered task fold state resumes it, from its re-read original admission. */
export class OperationState {
  command: { intent: AdmissionIntent; record: StoredCommand } | null = null;
  private reviewed = false;
  private publication: PublicationState = {
    intent: null,
    status: "pending",
    seq: null,
  };
  constructor(readonly operationId: string) {}
  apply(row: JournalRow, seq: string): void {
    const v = row.value;
    if (v.kind === "admission" && v.intent.operationId === this.operationId) {
      requireFact(
        !this.command &&
          v.intent.runId === null &&
          v.intent.identity.kind === "action",
      );
      this.command = { intent: v.intent, record: v.record };
    }
    if (v.kind !== "owner" || v.link.operationId !== this.operationId) return;
    for (const e of v.events) {
      if (
        e.kind === "owner" &&
        e.value.kind === "fact" &&
        e.value.fact.kind === "review"
      ) {
        const command = this.command;
        requireFact(command && command.intent.identity.kind === "action");
        const identity = command.intent.identity;
        requireFact(
          !this.reviewed &&
            identity.action.kind === "review" &&
            v.link.epoch === identity.expected.epoch &&
            v.link.taskId === identity.action.taskId &&
            v.link.runId === identity.action.runId,
        );
        this.reviewed = true;
        continue;
      }
      if (
        e.kind !== "owner" ||
        e.value.kind !== "fact" ||
        !["publication-intent", "publication-settled"].includes(
          e.value.fact.kind,
        )
      )
        continue;
      const fact = e.value.fact;
      if (
        fact.kind !== "publication-intent" &&
        fact.kind !== "publication-settled"
      )
        continue;
      const command = this.command;
      requireFact(command && command.intent.identity.kind === "action");
      const expected = command.intent.identity.expected;
      requireFact(
        v.link.runId === null &&
          v.link.epoch === expected.epoch &&
          v.link.taskId === (command.intent.createdTaskId ?? expected.task?.id),
      );
      this.publication = publicationTransition(
        this.publication,
        {
          revision: expected.task?.revision ?? 0,
          identity: expected.task?.identity ?? null,
        },
        fact,
        seq,
      );
    }
  }
  progress(): { reviewed: boolean; publication: PublicationState } {
    return {
      reviewed: this.reviewed,
      publication: structuredClone(this.publication),
    };
  }
  /** `command` is the re-read original admission row of this operation. */
  static resumed(
    operationId: string,
    command: { intent: AdmissionIntent; record: StoredCommand },
    progress: { reviewed: boolean; publication: PublicationState },
  ): OperationState {
    if (command.intent.operationId !== operationId)
      throw new ContractError("invalid");
    const state = new OperationState(operationId);
    state.command = command;
    state.reviewed = progress.reviewed;
    state.publication = structuredClone(progress.publication);
    return state;
  }
  publicationExpected(): { revision: number; identity: string | null } {
    const identity = this.command?.intent.identity;
    requireFact(
      identity?.kind === "action" &&
        (!this.publication.intent || this.publication.status === "published"),
    );
    return {
      revision:
        this.publication.intent?.nextRevision ??
        identity.expected.task?.revision ??
        0,
      identity:
        this.publication.intent?.nextIdentity ??
        identity.expected.task?.identity ??
        null,
    };
  }
  receipt(): StoredCommand | null {
    if (!this.command) return null;
    const receipt = this.command.record.receipt;
    return {
      identity: this.command.record.identity,
      receipt: {
        ...receipt,
        publication: this.publication.status,
        committedSeq: this.publication.seq ?? receipt.committedSeq,
        created:
          receipt.created && this.publication.status === "published"
            ? { ...receipt.created, state: "published" }
            : receipt.created,
      },
    };
  }
}
export function readOperationState(
  files: HistoryFiles,
  operationId: string,
): OperationState {
  const state = new OperationState(operationId);
  for (const batch of files.scan(
    emptyScan(),
    false,
    HistoryReadBudget.authority(),
  ))
    for (const row of batch.rows) state.apply(row, batch.marker.last);
  return state;
}

export class RunState {
  command: { intent: AdmissionIntent; record: StoredCommand } | null = null;
  admission: RunIdentity | null = null;
  admittedSeq: string | null = null;
  coverage = { ...COMPLETE, omissions: [...COMPLETE.omissions] };
  readonly auth = new Map<string, AuthState>(); // <=16 allocated children, not all history
  readonly children = new Map<string, ChildFact>();
  check: Extract<OwnerFact, { kind: "check-start" }> | null = null;
  settlement: Exclude<RunSettlement, { kind: "sdk" }> | null = null;
  settledSeq: string | null = null;
  publication: StoredCommand["receipt"]["publication"] = "pending";
  private recovered = false;
  private publicationSeq: string | null = null;
  private publicationIntent: Extract<
    OwnerFact,
    { kind: "publication-intent" }
  > | null = null;
  private gate: Extract<OwnerFact, { kind: "gate" }> | null = null;
  readonly gates = new Map<string, Extract<OwnerFact, { kind: "gate" }>>();
  readonly assignments = new Map<
    string,
    Extract<OwnerFact, { kind: "assignment-state" }>
  >();
  admissionClosed: Extract<OwnerFact, { kind: "admission-closed" }> | null =
    null;
  constructor(readonly runId: string) {}
  copy(): RunState {
    return Object.assign(new RunState(this.runId), structuredClone(this));
  }

  private identity(): RunIdentity {
    requireFact(this.admission);
    return this.admission;
  }
  private owner(link: OwnerLink): RunIdentity {
    const identity = this.identity();
    requireFact(
      link.runId === this.runId &&
        link.taskId === identity.context.task?.id &&
        link.epoch === identity.context.epoch &&
        link.operationId === identity.operationId,
    );
    return identity;
  }
  private worker(link: RecordingLink): RunIdentity {
    const identity = this.identity();
    requireFact(
      link.runId === this.runId &&
        link.taskId === identity.context.task?.id &&
        link.epoch === identity.context.epoch &&
        identity.assignments.some((a) => a.childRunId === link.childRunId),
    );
    return identity;
  }
  publicationExpected(): { revision: number; identity: string | null } {
    const identity = this.command?.intent.identity;
    requireFact(
      identity?.kind === "action" &&
        (!this.publicationIntent || this.publication === "published"),
    );
    return {
      revision:
        this.publicationIntent?.nextRevision ??
        identity.expected.task?.revision ??
        0,
      identity:
        this.publicationIntent?.nextIdentity ??
        identity.expected.task?.identity ??
        null,
    };
  }
  get unknownGate(): boolean {
    return (
      this.gate?.state === "unknown" ||
      [...this.gates.values()].some((g) => g.state === "unknown")
    );
  }
  get drained(): boolean {
    return (
      !["conflict", "uncertain"].includes(this.publication) &&
      this.settlement !== null &&
      settlementOutcome(this.settlement) !== "unknown" &&
      [...this.auth.values()].every((a) => a.result !== null) &&
      [...this.children.values()].every(
        (c) => c.completion !== null && !uncertainSettlement(c.completion),
      ) &&
      (this.settlement.kind !== "check" ||
        this.settlement.native.closure !== "unconfirmed") &&
      (this.gate === null || this.gate.state === "released") &&
      [...this.gates.values()].every((g) => g.state === "released")
    );
  }
  apply(row: JournalRow, committedSeq: string): void {
    const v = row.value;
    switch (v.kind) {
      case "recovery":
        if (this.command) this.recovered = true;
        return;
      case "admission":
        if (
          v.intent.runId !== this.runId ||
          v.intent.identity.kind !== "action"
        )
          return;
        requireFact(!this.command);
        this.command = { intent: v.intent, record: v.record };
        return;
      case "auth-preparation": {
        if (v.intent.runId !== this.runId) return;
        const i = this.identity();
        requireFact(
          !this.settlement &&
            !this.admissionClosed &&
            v.intent.epoch === i.context.epoch &&
            v.intent.sourceSelectionId === i.context.model.sourceSelectionId &&
            i.assignments.some((a) => a.childRunId === v.intent.childRunId) &&
            !this.auth.has(v.intent.operationId) &&
            ![...this.auth.values()].some(
              (a) => a.intent.childRunId === v.intent.childRunId,
            ),
        );
        this.auth.set(v.intent.operationId, { intent: v.intent, result: null });
        return;
      }
      case "auth-settlement": {
        const a = this.auth.get(v.result.operationId);
        if (!a) return; // Other runs' auth IDs have a different journal owner.
        requireFact(a.result === null);
        a.result = v.result;
        return;
      }
      case "launch": {
        if (v.link.runId !== this.runId) return;
        const i = this.worker(v.link);
        requireFact(
          !this.settlement &&
            !this.admissionClosed &&
            v.operationId === i.operationId &&
            !this.children.has(v.link.childRunId),
        );
        const auth = [...this.auth.values()].find(
          (a) => a.intent.childRunId === v.link.childRunId,
        );
        requireFact(
          auth?.result?.outcome === "resolved" && !auth.result.admissionClosed,
        );
        this.children.set(v.link.childRunId, {
          link: v.link,
          completion: null,
          settlementSeq: null,
          coverage: { ...COMPLETE, omissions: [] },
        });
        return;
      }
      case "settlement": {
        if (v.link.runId !== this.runId) return;
        this.worker(v.link);
        const child = this.children.get(v.link.childRunId);
        requireFact(
          child &&
            !child.completion &&
            equal(child.link, v.link) &&
            !this.settlement,
        );
        child.completion = v.completion;
        child.settlementSeq = committedSeq;
        this.coverage = combineCoverage(
          this.coverage,
          v.completion.native.capture,
        );
        return;
      }
      case "capture": {
        if (v.link.runId !== this.runId) return;
        this.worker(v.link);
        const child = this.children.get(v.link.childRunId);
        requireFact(child && !child.completion && equal(child.link, v.link));
        for (const e of v.events) {
          const coverage =
            e.kind === "end"
              ? e.detail.coverage
              : e.kind === "capture"
                ? captureCoverage(e.value.event)
                : null;
          if (coverage) {
            child.coverage = combineCoverage(child.coverage, coverage);
            this.coverage = combineCoverage(this.coverage, coverage);
          }
        }
        return;
      }
      case "owner":
        if (v.link.runId !== this.runId) return;
        for (const e of v.events)
          if (e.kind === "owner" && e.value.kind === "fact")
            this.fact(v.link, e.value.fact, committedSeq);
        return;
      default:
        return;
    }
  }
  private fact(link: OwnerLink, fact: OwnerFact, seq: string): void {
    if (fact.kind === "parent-admitted") {
      const command = this.command;
      requireFact(
        !this.admission && command && command.intent.identity.kind === "action",
      );
      const requested = command.intent.identity;
      requireFact(
        fact.runId === this.runId &&
          fact.identity.operationId === command.intent.operationId &&
          fact.identity.commandId === command.intent.commandId &&
          fact.identity.kind === requested.action.kind &&
          equal(fact.identity.context, requested.expected),
      );
      this.admission = fact.identity;
      this.owner(link);
      this.admittedSeq = seq;
      return;
    }
    // Review/changes can belong to separately confirmed operations. Their richer
    // reference joins remain a separate W3 boundary, not invented parent effects.
    if (["review", "changes", "handoff"].includes(fact.kind)) {
      const identity = this.identity();
      requireFact(
        link.taskId === identity.context.task?.id &&
          (fact.kind !== "handoff" || link.epoch === identity.context.epoch),
      );
      return;
    }
    // Accepted-but-unallocated work can only record nonapplication, never
    // fabricate a parent allocation/closure or a successful publication.
    if (!this.admission && fact.kind === "publication-settled") {
      const command = this.command;
      requireFact(command?.intent.identity.kind === "action");
      const expected = command.intent.identity.expected;
      requireFact(
        expected.task &&
          link.runId === this.runId &&
          link.operationId === command.intent.operationId &&
          link.epoch === expected.epoch &&
          link.taskId === expected.task.id &&
          fact.status === "uncertain" &&
          fact.observed === null,
      );
      this.applyPublication(expected.task, fact, seq);
      return;
    }
    const i = this.owner(link);
    const task = i.context.task;
    requireFact(task);
    switch (fact.kind) {
      case "parent-settled": {
        requireFact(
          i.kind !== "check" &&
            !this.settlement &&
            equal(
              fact.settlement.required.map(({ assignmentId, childRunId }) => ({
                assignmentId,
                childRunId,
              })),
              i.assignments,
            ),
        );
        for (const required of fact.settlement.required) {
          const child = this.children.get(required.childRunId);
          if (child)
            requireFact(
              child.completion &&
                equal(required.native, child.completion.native) &&
                equal(required.recording, child.completion.recording) &&
                required.settlementSeq === child.settlementSeq,
            );
          else
            requireFact(
              required.native === null &&
                required.settlementSeq === null &&
                required.recording.status !== "committed" &&
                required.recording.selected === null,
            );
        }
        requireFact([...this.auth.values()].every((a) => a.result !== null));
        this.settlement = fact.settlement;
        this.settledSeq = seq;
        return;
      }
      case "check-start": {
        const command = this.command?.intent.identity;
        requireFact(
          i.kind === "check" &&
            !this.check &&
            !this.settlement &&
            command?.kind === "action" &&
            command.action.kind === "check",
        );
        requireFact(
          equal(fact.selection, command.action.check) &&
            fact.cwdId === i.context.cwdId &&
            fact.checkEnvGeneration === i.context.checkEnvGeneration &&
            fact.before.identity === i.context.observation.identity &&
            fact.before.complete === i.context.observation.complete &&
            fact.before.checkoutGeneration === i.context.checkoutGeneration,
        );
        this.check = fact;
        return;
      }
      case "check-settled":
        requireFact(
          this.check &&
            !this.settlement &&
            fact.checkId === this.check.checkId &&
            equal(fact.before, this.check.before),
        );
        if (fact.ownAdvance) {
          const advance = fact.ownAdvance,
            gate = this.gates.get(fact.checkId);
          requireFact(
            advance.operationId === i.operationId &&
              advance.reservationId === this.check.checkId &&
              gate?.lane === "check" &&
              gate.state === "held" &&
              gate.checkoutGeneration === advance.from &&
              fact.before.checkoutGeneration === advance.from &&
              fact.after.checkoutGeneration === advance.to &&
              advance.to === advance.from + 1,
          );
        }
        this.settlement = {
          kind: "check",
          native: fact.native,
          capture: fact.coverage,
          settlementSeq: seq,
        };
        this.settledSeq = seq;
        this.coverage = combineCoverage(this.coverage, fact.coverage);
        return;
      case "admission-closed":
        requireFact(!this.settlement && !this.admissionClosed);
        this.admissionClosed = fact;
        return;
      case "assignment-state": {
        requireFact(
          !this.settlement &&
            i.assignments.some((a) => a.childRunId === fact.childRunId),
        );
        const previous = this.assignments.get(fact.childRunId);
        const launched = this.children.has(fact.childRunId);
        requireFact(previous?.state !== "unstarted");
        if (fact.state === "unstarted") requireFact(!launched);
        if (["waiting", "ready", "preparing"].includes(fact.state))
          requireFact(
            !launched && !this.admissionClosed && previous?.state !== "closing",
          );
        if (previous?.state === "preparing")
          requireFact(fact.state === "closing" || fact.state === "unstarted");
        this.assignments.set(fact.childRunId, fact);
        return;
      }
      case "gate": {
        // A run uses one gate vocabulary for its lifetime. Mixing modes would
        // create two independently releasable representations of the same lane.
        requireFact(
          fact.reservationId ? this.gate === null : this.gates.size === 0,
        );
        requireFact((fact.lane === "check") === (i.kind === "check"));
        if (fact.lane === "writer")
          requireFact(i.kind === "start" && i.context.task?.kind === "code");
        if (fact.reservationId)
          requireFact(
            i.kind === "check"
              ? this.check?.checkId === fact.reservationId
              : i.assignments.some((a) => a.childRunId === fact.reservationId),
          );
        const previous = fact.reservationId
          ? this.gates.get(fact.reservationId)
          : this.gate;
        if (fact.state === "waiting")
          requireFact(
            !this.settlement &&
              !this.admissionClosed &&
              (!previous || previous.state === "released"),
          );
        if (fact.state === "held")
          requireFact(
            !this.settlement &&
              !this.admissionClosed &&
              (!previous ||
                previous.state === "waiting" ||
                previous.state === "released"),
          );
        if (fact.state === "released")
          requireFact(
            previous?.state === "held" && previous.lane === fact.lane,
          );
        if (
          fact.reservationId &&
          fact.state === "released" &&
          i.kind !== "check"
        ) {
          const child = this.children.get(fact.reservationId);
          requireFact(
            [...this.auth.values()].every(
              (a) =>
                a.intent.childRunId !== fact.reservationId || a.result !== null,
            ) &&
              (!child ||
                (child.completion !== null &&
                  !uncertainSettlement(child.completion))),
          );
        }
        if (
          fact.reservationId &&
          fact.state === "released" &&
          i.kind === "check"
        )
          requireFact(
            this.settlement?.kind === "check" &&
              this.settlement.native.closure !== "unconfirmed",
          );
        if (fact.reservationId && fact.state === "held")
          requireFact(
            [...this.gates.entries()].every(
              ([id, gate]) =>
                id === fact.reservationId ||
                gate.state === "released" ||
                gate.state === "waiting" ||
                (gate.state === "held" &&
                  gate.lane === "reader" &&
                  fact.lane === "reader"),
            ),
          );

        if (previous)
          requireFact(
            fact.checkoutGeneration >= previous.checkoutGeneration &&
              previous.state !== "unknown",
          );
        if (fact.reservationId) this.gates.set(fact.reservationId, fact);
        else this.gate = fact;
        return;
      }
      case "publication-intent":
      case "publication-settled": {
        this.applyPublication(task, fact, seq);
        return;
      }
    }
  }
  private applyPublication(
    initial: { revision: number; identity: string | null },
    fact: Extract<
      OwnerFact,
      { kind: "publication-intent" | "publication-settled" }
    >,
    seq: string,
  ): void {
    const next = publicationTransition(
      {
        intent: this.publicationIntent,
        status: this.publication,
        seq: this.publicationSeq,
      },
      initial,
      fact,
      seq,
    );
    this.publicationIntent = next.intent;
    this.publication = next.status;
    this.publicationSeq = next.seq;
  }
  projections(epoch: string): RunProjection[] {
    if (!this.admission) return [];
    const observation: RunObservation = {
      admission: this.admission,
      recovered: this.recovered,
      publication: this.publication,
      gate: this.gate,
      admissionClosed: this.admissionClosed,
      unknownGate: this.unknownGate,
      settlement: this.settlement,
      coverage: this.coverage,
      children: this.children.size,
      auth: this.auth.size,
      closed: [...this.children.values()].filter((c) => c.completion !== null)
        .length,
      uncertain: [...this.children.values()].some(
        (c) => c.completion && uncertainSettlement(c.completion),
      ),
      check: this.check !== null,
    };
    return [
      projectRunObservation(this.runId, epoch, observation, null),
      ...this.admission.assignments.map((a) => {
        const child = this.children.get(a.childRunId);
        return projectRunObservation(this.runId, epoch, observation, {
          ...a,
          state: this.assignments.get(a.childRunId) ?? null,
          prepared: [...this.auth.values()].some(
            (x) => x.intent.childRunId === a.childRunId,
          ),
          launched: !!child,
          completion: child?.completion ?? null,
          settlementSeq: child?.settlementSeq ?? null,
          coverage: child?.coverage ?? COMPLETE,
        });
      }),
    ];
  }
  receipt(): StoredCommand | null {
    if (!this.command) return null;
    return {
      identity: this.command.record.identity,
      receipt: {
        ...this.command.record.receipt,
        execution: this.settlement ? settlementOutcome(this.settlement) : null,
        settlement: this.settlement,
        publication: this.publication,
        committedSeq: [this.publicationSeq, this.settledSeq].reduce<string>(
          (latest, seq) =>
            seq !== null && compareSequence(seq, latest) > 0 ? seq : latest,
          this.command.record.receipt.committedSeq,
        ),
      },
    };
  }
}

/** Shared readonly lifecycle projection. Historical navigation reconstructs these
 * bounded observations from authenticated original locators; it never invents
 * child native facts to satisfy the writer's transition reducer. */
export interface RunObservation {
  admission: RunIdentity;
  recovered: boolean;
  publication: StoredCommand["receipt"]["publication"];
  gate: Extract<OwnerFact, { kind: "gate" }> | null;
  admissionClosed?: Extract<OwnerFact, { kind: "admission-closed" }> | null;
  unknownGate?: boolean;
  settlement: Exclude<RunSettlement, { kind: "sdk" }> | null;
  coverage: CaptureCoverage;
  children: number;
  auth: number;
  closed: number;
  uncertain: boolean;
  check: boolean;
}
export interface ChildObservation {
  assignmentId: string;
  childRunId: string;
  state?: Extract<OwnerFact, { kind: "assignment-state" }> | null;
  prepared: boolean;
  launched: boolean;
  completion: WorkerCompletion | null;
  settlementSeq: string | null;
  coverage: CaptureCoverage;
}
export function projectRunObservation(
  runId: string,
  epoch: string,
  o: RunObservation,
  child: ChildObservation | null,
): RunProjection {
  const admission = o.admission,
    task = admission.context.task;
  requireFact(task);
  const old = admission.context.epoch !== epoch || o.recovered;
  if (child) {
    const settlement: RunSettlement | null =
      child.completion && child.settlementSeq
        ? {
            kind: "sdk",
            native: child.completion.native,
            recording: child.completion.recording,
            settlementSeq: child.settlementSeq,
          }
        : null;
    const outcome = settlement
      ? settlementOutcome(settlement)
      : o.settlement
        ? "blocked"
        : old
          ? "unknown"
          : null;
    return {
      runId,
      taskId: task.id,
      childRunId: child.childRunId,
      assignmentId: child.assignmentId,
      admission,
      lifecycle:
        outcome !== null
          ? "settled"
          : child.state?.state === "closing"
            ? "closing"
            : child.launched
              ? "running"
              : child.prepared
                ? "preparing"
                : "queued",
      outcome,
      settlement,
      reason:
        (old && !settlement && !o.settlement) ||
        (child.completion && uncertainSettlement(child.completion))
          ? "quarantine"
          : (child.state?.reason ??
            (o.settlement && !child.launched ? "parent-stopped" : null)),
      publication: o.publication,
      coverage: combineCoverage(
        child.coverage,
        child.completion?.native.capture ?? COMPLETE,
      ),
      result:
        child.completion?.recording.status === "committed"
          ? child.completion.recording.detail.content
          : null,
    };
  }
  const uncertain =
    o.unknownGate ||
    o.gate?.state === "unknown" ||
    o.uncertain ||
    (o.settlement?.kind === "check" &&
      o.settlement.native.closure === "unconfirmed") ||
    ["conflict", "uncertain"].includes(o.publication);
  const closing =
    !!o.admissionClosed ||
    uncertain ||
    (admission.assignments.length > 0 &&
      o.children === admission.assignments.length &&
      o.closed === o.children);
  const outcome = o.settlement
    ? settlementOutcome(o.settlement)
    : old
      ? "unknown"
      : null;
  return {
    runId,
    taskId: task.id,
    childRunId: null,
    assignmentId: null,
    admission,
    lifecycle:
      outcome !== null
        ? "settled"
        : closing
          ? "closing"
          : o.children || o.check
            ? "running"
            : o.auth
              ? "preparing"
              : "queued",
    outcome,
    settlement: o.settlement,
    reason:
      (old && !o.settlement) || uncertain
        ? "quarantine"
        : o.admissionClosed
          ? ["wait-expired", "handoff-overflow", "stale-dependency"].includes(
              o.admissionClosed.reason,
            )
            ? (o.admissionClosed.reason as RunProjection["reason"])
            : "parent-stopped"
          : o.gate?.state === "waiting"
            ? "writer"
            : null,
    publication: o.publication,
    coverage: o.coverage,
    result: null,
  };
}
