import {
  type Action,
  type ActionPreview,
  type Command,
  ContractError,
  canonicalJson,
  decodeCancel,
  decodeCommand,
  decodeId,
  decodePreflightRequest,
  decodePreview,
  decodeSequence,
  decodeStoredCommand,
  LIMITS,
  type Preflight,
  type PublicError,
  publicError,
  type Receipt,
  type Reply,
} from "../service-contract.ts";
import type {
  AdmissionClock,
  AdmissionIntent,
  AdmissionOwner,
  AdmissionPersistence,
  Caller,
  CommandIdentity,
  StoredCommand,
} from "./ports.ts";

/** Conservative encoded-data reservations, not a total JavaScript heap claim.
 * Each ordinary slot covers request + preview + comparison copies. Grants have
 * a separate viewers*controlBytes ceiling. Unsettled port promises keep slots.
 */
interface PendingAdmission {
  bytes: number;
  command?: { id: string; identity: CommandIdentity };
  expired: boolean;
  deadline: Promise<never>;
  timer: ReturnType<typeof setTimeout>;
  reason: "context" | "persistence";
  originals: Set<Promise<unknown>>;
  finished: boolean;
  released: boolean;
  lane: "ordinary" | "cancel";
}
interface Grant {
  caller: string;
  issued: number;
  expires: number;
  preview: ActionPreview;
  lease: { valid: boolean };
}
const ok = <T>(value: T): Reply<T> => ({ kind: "ok", value });
const error = (e: PublicError): Reply<never> => ({ kind: "error", error: e });
function failure(e: unknown): Reply<never> {
  return error(
    publicError(e instanceof ContractError ? e.code : "unavailable"),
  );
}
function identity(command: Command): CommandIdentity {
  return { kind: "action", expected: command.expected, action: command.action };
}
function episode(action: Action): boolean {
  return (
    action.kind === "start" ||
    action.kind === "generate-plan" ||
    action.kind === "check"
  );
}

/** Single-owner admission only, not an executor. All public returns are credential-free.
 * Receipt lookup precedes current epoch/grant checks deliberately: observation of a
 * previous command never authorizes another effect. Authentication precedes this core.
 */
export class ActionAdmission {
  private tail: Promise<void> = Promise.resolve();
  private grants = new Map<string, Grant>();
  private confirmations = new Map<string, { valid: boolean }>();
  private fenced = false;
  private pending = new Set<PendingAdmission>();
  get accounting(): { count: number; bytes: number; unresolved: number } {
    return {
      count: this.pending.size,
      bytes: [...this.pending].reduce((n, p) => n + p.bytes, 0),
      unresolved: [...this.pending].reduce((n, p) => n + p.originals.size, 0),
    };
  }
  private reserve(lane: PendingAdmission["lane"]): PendingAdmission {
    const entries = [...this.pending].filter((p) => p.lane === lane);
    const bytes = lane === "ordinary" ? LIMITS.controlBytes * 4 : 4096;
    const maximum =
      lane === "ordinary" ? LIMITS.admissionBytes : LIMITS.cancelBytes;
    if (
      entries.length >= LIMITS.admissionCount ||
      entries.reduce((n, p) => n + p.bytes, 0) + bytes > maximum
    )
      throw new ContractError("capacity");
    let expire!: (reason: unknown) => void;
    const deadline = new Promise<never>((_, reject) => {
      expire = reject;
    });
    // Queued leases also have a bounded lifetime; handle rejection immediately.
    void deadline.catch(() => {});
    const pending: PendingAdmission = {
      lane,
      bytes,
      deadline,
      expired: false,
      reason: "context",
      originals: new Set(),
      finished: false,
      released: false,
      timer: setTimeout(() => {
        pending.expired = true;
        if (pending.originals.size) this.quarantine(pending.reason);
        expire(new ContractError("unavailable"));
      }, LIMITS.recordingStallMs),
    };
    this.pending.add(pending);
    return pending;
  }
  private claim(
    pending: PendingAdmission | null,
    id: string,
    requested: CommandIdentity,
  ): void {
    for (const p of this.pending)
      if (
        p.command?.id === id &&
        canonicalJson(p.command.identity) !== canonicalJson(requested)
      )
        throw new ContractError("conflict");
    if (requested.kind === "cancel") {
      const stored = this.persistence.reservedIdentity?.(id);
      if (stored && canonicalJson(stored) !== canonicalJson(requested))
        throw new ContractError("conflict");
    }
    if (pending) pending.command = { id, identity: requested };
  }
  private release(pending: PendingAdmission): void {
    if (pending.finished && !pending.originals.size && !pending.released) {
      pending.released = true;
      this.pending.delete(pending);
    }
  }
  private async bounded<T>(
    pending: PendingAdmission,
    operation: () => Promise<T>,
    reason: "persistence" | "context",
  ): Promise<T> {
    if (pending.expired) throw new ContractError("unavailable");
    pending.reason = reason;
    // Keep the ORIGINAL promise handled/accounted after the reporting deadline.
    const original = Promise.resolve().then(operation);
    pending.originals.add(original);
    const settled = () => {
      pending.originals.delete(original);
      this.release(pending);
    };
    void original.then(settled, settled);
    return Promise.race([original, pending.deadline]);
  }
  private async reserved<T>(
    lane: PendingAdmission["lane"],
    body: (pending: PendingAdmission) => Promise<Reply<T>>,
  ): Promise<Reply<T>> {
    let pending: PendingAdmission;
    try {
      pending = this.reserve(lane);
    } catch (e) {
      return failure(e);
    }
    try {
      return await body(pending);
    } finally {
      pending.finished = true;
      clearTimeout(pending.timer);
      this.release(pending);
    }
  }
  constructor(
    private readonly persistence: AdmissionPersistence,
    private readonly owner: AdmissionOwner,
    private readonly clock: AdmissionClock,
  ) {}
  private serial<T>(body: () => Promise<T>): Promise<T> {
    const result = this.tail.then(body);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /** Invalidate an attachment's unconsumed confirmations, not its accepted work. */
  detach(attachmentId: string): void {
    const lease = this.confirmations.get(attachmentId);
    if (lease) lease.valid = false;
    this.confirmations.delete(attachmentId);
    for (const [id, grant] of this.grants)
      if (grant.caller === attachmentId) this.grants.delete(id);
  }
  revokeGrants(): void {
    for (const lease of this.confirmations.values()) lease.valid = false;
    this.confirmations.clear();
    this.grants.clear();
  }
  private quarantine(reason: "persistence" | "activation" | "context"): void {
    if (this.fenced) return;
    this.fenced = true;
    this.revokeGrants();
    try {
      this.owner.quarantine(reason);
    } catch {
      /* Local fence remains even if owner diagnostics fail. */
    }
  }
  private access(caller: Caller, epoch: string, generation?: number): void {
    decodeId(caller.attachmentId);
    const current = this.owner.currentAccess();
    if (
      current.epoch !== epoch ||
      current.accessGeneration !== caller.accessGeneration ||
      (generation !== undefined && generation !== current.accessGeneration)
    )
      throw new ContractError("stale");
    if (caller.authority !== "local" && caller.authority !== "browser")
      throw new ContractError("forbidden");
  }
  private authorize(preview: ActionPreview, caller: Caller): void {
    const { action, version, graph } = preview;
    const task = version.task;
    this.access(caller, version.epoch, version.accessGeneration);
    if (action.kind === "create") {
      if (task !== null) throw new ContractError("stale");
      return;
    }
    if (!task || task.id !== action.taskId) throw new ContractError("stale");
    if (preview.activeRunId !== null) throw new ContractError("conflict");
    if (action.kind === "check") {
      if (
        task.kind !== "code" ||
        (action.check.kind === "manual" && caller.authority !== "local")
      )
        throw new ContractError("forbidden");
      if (
        action.check.kind === "configured" &&
        !preview.configuredChecks.some(
          (check) => canonicalJson(check) === canonicalJson(action.check),
        )
      )
        throw new ContractError("forbidden");
    }
    if (action.kind === "review") {
      if (
        action.runId !== preview.reviewRunId ||
        action.checksRevision !== preview.checksRevision
      )
        throw new ContractError("stale");
      if (action.changesIdentity !== version.observation.identity)
        throw new ContractError("stale");
      if (
        (preview.issues.length || !version.observation.complete) &&
        !action.acceptIssues
      )
        throw new ContractError("conflict");
    }
    if (action.kind === "generate-plan" && task.kind !== "code")
      throw new ContractError("forbidden");
    if (action.kind === "start" || action.kind === "save-plan") {
      const selected = action.kind === "save-plan" ? action.graph : graph;
      if (
        !selected ||
        selected.taskId !== task.id ||
        selected.taskKind !== task.kind
      )
        throw new ContractError("stale");
      const next = action.kind === "save-plan" ? 1 : 0;
      if (
        (selected.taskRevision !== task.revision + next &&
          !(
            action.kind === "start" &&
            selected.taskRevision < task.revision &&
            this.owner.currentGraph?.(selected, version) === true
          )) ||
        selected.revision !== (task.graphRevision ?? 0) + next
      )
        throw new ContractError("stale");
      if (
        action.kind === "start" &&
        task.kind === "code" &&
        !preview.readablePlan.trim()
      )
        throw new ContractError("unsupported-context");
      if (
        selected.assignments.some(
          (a) => canonicalJson(a.model) !== canonicalJson(version.model),
        )
      )
        throw new ContractError("unsupported-context");
    }
    // A generated proposal never enters start/dispatch here; generate-plan has no graph payload.
  }
  private async observe(
    action: Action,
    expected: Command["expected"],
    caller: Caller,
    pending: PendingAdmission,
  ): Promise<ActionPreview> {
    const preview = decodePreview(
      await this.bounded(pending, () => this.owner.observe(action), "context"),
    );
    if (
      canonicalJson(preview.action) !== canonicalJson(action) ||
      canonicalJson(preview.version) !== canonicalJson(expected)
    )
      throw new ContractError("stale");
    this.authorize(preview, caller);
    return preview;
  }
  preflight(input: unknown, caller: Caller): Promise<Reply<Preflight>> {
    return this.reserved("ordinary", (pending) =>
      this.preflightReserved(input, caller, pending),
    );
  }
  private async preflightReserved(
    input: unknown,
    caller: Caller,
    pending: PendingAdmission,
  ): Promise<Reply<Preflight>> {
    // Snapshot before enqueue/await: later caller mutation cannot change the displayed action.
    let request: ReturnType<typeof decodePreflightRequest>;
    try {
      request = decodePreflightRequest(input);
    } catch (e) {
      return failure(e);
    }
    caller = { ...caller };
    const lease = { valid: true };
    try {
      this.access(
        caller,
        request.expected.epoch,
        request.expected.accessGeneration,
      );
      this.detach(caller.attachmentId);
      const now = this.clock.now();
      for (const g of this.grants.values())
        if (now >= g.expires || now < g.issued) this.detach(g.caller);
      if (this.confirmations.size >= LIMITS.viewers)
        throw new ContractError("capacity");
      this.confirmations.set(caller.attachmentId, lease);
    } catch (e) {
      return failure(e);
    }
    return this.serial(async () => {
      try {
        if (!lease.valid) throw new ContractError("stale");
        if (this.fenced) throw new ContractError("quarantine");
        const preview = await this.observe(
          request.action,
          request.expected,
          caller,
          pending,
        );
        if (!lease.valid) throw new ContractError("stale");
        if (this.fenced) throw new ContractError("quarantine");
        const now = this.clock.now();
        // Grants are separately capped; pending requests hold pre-decoding reservations.
        for (const g of this.grants.values())
          if (now >= g.expires || now < g.issued) this.detach(g.caller);
        if (this.grants.size >= LIMITS.viewers)
          throw new ContractError("capacity");
        const grant = decodeId(this.clock.uuid());
        if (this.grants.has(grant)) throw new ContractError("conflict");
        const expires = now + LIMITS.grantMs;
        this.grants.set(grant, {
          caller: caller.attachmentId,
          issued: now,
          expires,
          preview,
          lease,
        });
        return ok({
          grant,
          expiresAt: new Date(expires).toISOString(),
          preview: structuredClone(preview),
        });
      } catch (e) {
        if (this.confirmations.get(caller.attachmentId) === lease)
          this.detach(caller.attachmentId);
        return failure(e);
      }
    });
  }
  private existing(
    record: StoredCommand,
    commandId: string,
    requested: CommandIdentity,
  ): Reply<Receipt> {
    const decoded = decodeStoredCommand(record);
    const receipt = decoded.receipt;
    if (
      receipt.commandId !== commandId ||
      canonicalJson(decoded.identity) !== canonicalJson(requested)
    )
      return error(publicError("conflict"));
    return ok(receipt);
  }
  submit(input: unknown, caller: Caller): Promise<Reply<Receipt>> {
    return this.reserved("ordinary", (pending) =>
      this.submitReserved(input, caller, pending),
    );
  }
  private async submitReserved(
    input: unknown,
    caller: Caller,
    pending: PendingAdmission,
  ): Promise<Reply<Receipt>> {
    let command: Command;
    try {
      command = decodeCommand(input);
      this.claim(pending, command.commandId, identity(command));
    } catch (e) {
      return failure(e);
    }
    caller = { ...caller };
    return this.serial(async () => {
      let selected: Grant | undefined;
      try {
        const requested = identity(command);
        try {
          // Caller is still currently authenticated even when observing an old-epoch receipt.
          this.access(caller, this.owner.currentAccess().epoch);
          const found = await this.bounded(
            pending,
            () =>
              this.persistence.lookupForAdmission
                ? this.persistence.lookupForAdmission(command.commandId)
                : this.persistence.lookup(command.commandId),
            "persistence",
          );
          this.access(caller, this.owner.currentAccess().epoch);
          if (found.status === "found")
            return this.existing(found.record, command.commandId, requested);
          if (found.status === "inconclusive") {
            this.quarantine("persistence");
            return error(publicError("receipt-inconclusive", "uncertain"));
          }
          decodeSequence(found.committedSeq);
        } catch {
          this.quarantine("persistence");
          return error(publicError("receipt-inconclusive", "uncertain"));
        }
        try {
          if (this.fenced) throw new ContractError("quarantine");
          const grant = this.grants.get(command.grant);
          if (!grant?.lease.valid || grant.caller !== caller.attachmentId)
            throw new ContractError("consumed-grant");
          selected = grant;
          // One use even if re-observation or persistence later refuses. No grant resurrection.
          this.grants.delete(command.grant);
          const now = this.clock.now();
          if (now < grant.issued || now >= grant.expires)
            throw new ContractError("expired-grant");
          if (
            canonicalJson({
              expected: grant.preview.version,
              action: grant.preview.action,
            }) !==
            canonicalJson({
              expected: command.expected,
              action: command.action,
            })
          )
            throw new ContractError("conflict");
          const current = await this.observe(
            command.action,
            command.expected,
            caller,
            pending,
          );
          if (
            !grant.lease.valid ||
            canonicalJson(current) !== canonicalJson(grant.preview)
          )
            throw new ContractError("stale");
          if (
            this.clock.now() >= grant.expires ||
            this.clock.now() < grant.issued
          )
            throw new ContractError("expired-grant");
        } catch (e) {
          return failure(e);
        }
        try {
          const intent: AdmissionIntent = {
            commandId: command.commandId,
            operationId: decodeId(this.clock.uuid()),
            runId: episode(command.action) ? decodeId(this.clock.uuid()) : null,
            identity: requested,
            createdTaskId:
              command.action.kind === "create"
                ? decodeId(this.clock.uuid())
                : null,
          };
          const committed = await this.bounded(
            pending,
            () => this.persistence.commit(intent),
            "persistence",
          );
          if (committed.status === "refused") {
            if (
              [
                "recording-exhausted",
                "corrupt-selected",
                "quarantine",
                "unavailable",
              ].includes(committed.error.code)
            )
              this.quarantine("persistence");
            return error(committed.error);
          }
          if (committed.status === "uncertain") {
            this.quarantine("persistence");
            return error(publicError("receipt-inconclusive", "uncertain"));
          }
          const reply = this.existing(
            committed.record,
            command.commandId,
            requested,
          );
          if (committed.status === "existing") return reply; // Never replay an existing effect.
          if (
            reply.kind !== "ok" ||
            reply.value.admission !== "accepted" ||
            reply.value.operationId !== intent.operationId ||
            reply.value.runId !== intent.runId ||
            (reply.value.created?.taskId ?? null) !== intent.createdTaskId
          )
            throw new ContractError("corrupt-selected");
          // A concurrent safety cancellation may fence this owner while commit awaits.
          // Keep its accepted receipt observable, but never enqueue through that fence.
          if (this.fenced) return error(publicError("quarantine", "accepted"));
          // Committed acceptance survives detach/token rotation/elapsed dialog time.
          // Only execution context/ownership freshness can prevent new effects now;
          // never reapply a client grant to already accepted work.
          try {
            const current = decodePreview(
              await this.bounded(
                pending,
                () => this.owner.observe(command.action),
                "context",
              ),
            );
            if (this.fenced)
              return error(publicError("quarantine", "accepted"));
            const normalized = {
              ...current,
              version: {
                ...current.version,
                controlRev: current.version.controlRev - 1,
                accessGeneration: command.expected.accessGeneration,
              },
            };
            if (
              canonicalJson(normalized) !== canonicalJson(selected.preview) ||
              this.owner.currentAccess().epoch !== command.expected.epoch
            )
              throw new ContractError("stale");
          } catch {
            this.quarantine("context");
            return error(publicError("stale", "accepted"));
          }
          try {
            this.owner.activate(intent, reply.value);
          } catch {
            this.quarantine("activation");
            return error(publicError("unavailable", "uncertain"));
          }
          return reply;
        } catch {
          this.quarantine("persistence");
          return error(publicError("receipt-inconclusive", "uncertain"));
        }
      } finally {
        if (
          selected &&
          this.confirmations.get(caller.attachmentId) === selected.lease
        )
          this.confirmations.delete(caller.attachmentId);
      }
    });
  }
  cancel(input: unknown, caller: Caller): Promise<Reply<Receipt>> {
    let pending: PendingAdmission;
    try {
      pending = this.reserve("cancel");
    } catch {
      // No async work/retention here. Quota cannot deny an authenticated exact-run
      // safety stop. The owner coalesces against its already bounded run handles.
      try {
        const command = decodeCancel(input);
        this.access(caller, command.epoch);
        this.claim(null, command.commandId, {
          kind: "cancel",
          epoch: command.epoch,
          runId: command.runId,
        });
        const run = this.owner.run(command.runId);
        if (!run || run.epoch !== command.epoch || run.runId !== command.runId)
          throw new ContractError("stale");
        if (run.state !== "settled" && !run.cancelRequested)
          this.owner.requestCancel(command);
        this.quarantine("persistence");
        return Promise.resolve(
          error(publicError("receipt-inconclusive", "uncertain")),
        );
      } catch (e) {
        return Promise.resolve(failure(e));
      }
    }
    return this.cancelReserved(input, caller, pending).finally(() => {
      pending.finished = true;
      clearTimeout(pending.timer);
      this.release(pending);
    });
  }
  private async cancelReserved(
    input: unknown,
    caller: Caller,
    pending: PendingAdmission,
  ): Promise<Reply<Receipt>> {
    let command: ReturnType<typeof decodeCancel>;
    try {
      command = decodeCancel(input);
      this.claim(pending, command.commandId, {
        kind: "cancel",
        epoch: command.epoch,
        runId: command.runId,
      });
    } catch (e) {
      return failure(e);
    }
    caller = { ...caller };
    // Cancellation does not queue behind unrelated grant preparation/persistence.
    // The durable writer reserves IDs atomically; original run handles coalesce stops.
    return (async () => {
      const requested: CommandIdentity = {
        kind: "cancel",
        epoch: command.epoch,
        runId: command.runId,
      };
      let conclusive = false;
      try {
        this.access(caller, this.owner.currentAccess().epoch);
        const found = await this.bounded(
          pending,
          () => this.persistence.lookup(command.commandId),
          "persistence",
        );
        this.access(caller, this.owner.currentAccess().epoch);
        if (found.status === "found")
          return this.existing(found.record, command.commandId, requested);
        this.claim(pending, command.commandId, requested);
        conclusive = found.status === "absent";
      } catch (e) {
        if (e instanceof ContractError && e.code === "conflict")
          return failure(e);
        /* Safety cancellation below still requires current authority and exact run. */
      }
      try {
        this.access(caller, command.epoch);
        const run = this.owner.run(command.runId);
        if (!run || run.runId !== command.runId || run.epoch !== command.epoch)
          throw new ContractError("stale");
      } catch (e) {
        return failure(e);
      }
      // Exact authenticated run safety stop precedes any cancellation journal
      // wait. Receipt identity lookup above still rejects a conflicting replay.
      try {
        const run = this.owner.run(command.runId);
        if (run && run.state !== "settled" && !run.cancelRequested)
          this.owner.requestCancel(command);
      } catch {
        this.quarantine("activation");
      }
      // Only AFTER the safety request may ordinary serialized observation join
      // existing originals. The real writer orders this read before later jobs;
      // still-inconclusive observation is never promoted to absence.
      const lookupAfterStop = this.persistence.lookupForAdmission?.bind(
        this.persistence,
      );
      if (!conclusive && lookupAfterStop) {
        try {
          const found = await this.bounded(
            pending,
            () => lookupAfterStop(command.commandId),
            "persistence",
          );
          this.access(caller, command.epoch);
          if (found.status === "found")
            return this.existing(found.record, command.commandId, requested);
          conclusive = found.status === "absent";
        } catch {
          /* Already requested stops remain effective; receipt is unknown. */
        }
      }
      let reply: Reply<Receipt> = error(
        publicError("receipt-inconclusive", "uncertain"),
      );
      if (conclusive) {
        try {
          const intent: AdmissionIntent = {
            commandId: command.commandId,
            operationId: decodeId(this.clock.uuid()),
            runId: command.runId,
            identity: requested,
            createdTaskId: null,
          };
          const result = await this.bounded(
            pending,
            () => this.persistence.commit(intent),
            "persistence",
          );
          if (result.status === "existing")
            return this.existing(result.record, command.commandId, requested);
          if (
            result.status === "refused" &&
            ![
              "recording-exhausted",
              "unavailable",
              "quarantine",
              "corrupt-selected",
              "receipt-inconclusive",
            ].includes(result.error.code)
          )
            return error(result.error);
          if (result.status === "committed") {
            reply = this.existing(result.record, command.commandId, requested);
            if (
              reply.kind !== "ok" ||
              reply.value.admission !== "accepted" ||
              reply.value.operationId !== intent.operationId ||
              reply.value.runId !== command.runId
            )
              reply = error(publicError("receipt-inconclusive", "uncertain"));
          }
        } catch {
          /* Request stop even if its receipt cannot be made durable. */
        }
      }
      // Already committed cancellation, like Start, survives access rotation.
      // Uncommitted safety requests still require current caller authority.
      try {
        if (reply.kind !== "ok") this.access(caller, command.epoch);
        else if (this.owner.currentAccess().epoch !== command.epoch)
          throw new ContractError("stale");
        const run = this.owner.run(command.runId);
        if (!run || run.epoch !== command.epoch)
          throw new ContractError("stale");
        if (run.state !== "settled" && !run.cancelRequested) {
          this.owner.requestCancel(command);
        }
      } catch {
        reply = error(publicError("unavailable", "uncertain"));
      }
      if (reply.kind === "error") this.quarantine("persistence");
      return reply;
    })();
  }
}
