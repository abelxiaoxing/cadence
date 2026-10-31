import {
  type CheckNativeSettlement,
  ContractError,
  decodeCheckNativeSettlement,
  decodeCommittedBatch,
  decodeNativeSettlement,
  decodeWorkerCompletion,
  LIMITS,
  type NativeSettlement,
  type WorkerCompletion,
} from "../service-contract.ts";
import type { OwnerLease, OwnerPhase } from "./coordination.ts";
import type { PersistenceResult } from "./ports.ts";

/** Mandatory composition, not permissive defaults. Quiesce closes W4
 * admission/revokes grants synchronously; flush must account for ALL original
 * W3 writes. Closing a listener cannot substitute for either fact. */
export interface OwnerLifecyclePorts {
  quiesce(): void;
  flush(): Promise<PersistenceResult>;
  closeListener(): Promise<void>;
}
function committed(result: PersistenceResult): boolean {
  if (result.status !== "committed") return false;
  decodeCommittedBatch(result.batch);
  return true;
}
/** Owner-private control-flow disposition, not a public execution outcome. */
export type AcceptedWorkResult = { status: "settled" | "uncertain" };
type Kind = "process" | "auth" | "storage" | "work";
interface Activity {
  kind: Kind;
  settled: Promise<void>;
  requestStop?: () => void | Promise<void>;
}
export interface OwnerStopReport {
  state: "stopped" | "quarantined";
  pending: Record<Kind, number>;
  settlement: "known" | "uncertain";
}

/** Lifecycle/accounting only: intentionally implements NO AdmissionOwner.activate.
 * Client detach never calls stop. A new instance never reads/replays work queues.
 * Trusted adapters register original handles before yielding or launching further
 * effects. Credentials/results are not retained here or exposed in reports. */
export class ServiceOwner {
  private phase: OwnerPhase = "idle";
  private activities = new Set<Activity>();
  private uncertain = false;
  private attempt?: Promise<void>;
  private reportingExpired = false;
  private stopRequested = new Set<Activity>();
  private stopWaits = new Set<Promise<void>>();
  private flushing = false;
  private admissionClosed = false;
  private listenerClosed = false;
  private actionQuiesce?: () => void;
  private configurationGuard?: () => void;
  private configurationChanged?: () => void;
  constructor(
    readonly lease: OwnerLease,
    private readonly ports: OwnerLifecyclePorts,
  ) {}

  get state(): OwnerPhase {
    return this.phase;
  }
  /** Until actual W3/W4 composition exists this cannot accept product actions. */
  execution(): never {
    throw new ContractError("unavailable");
  }
  detach(): void {
    /* View lifetime is deliberately not owner lifetime. */
  }
  /** Exactly one runtime composition, including its checkout/configuration guard. */
  registerRuntime(
    quiesce: () => void,
    configuration?: { assertQuiescent(): void; changed?(): void },
  ): void {
    this.lease.assert();
    if (this.actionQuiesce || this.admissionClosed || this.phase !== "idle")
      throw new ContractError("conflict");
    this.actionQuiesce = quiesce;
    this.configurationGuard = configuration?.assertQuiescent;
    this.configurationChanged = configuration?.changed;
  }
  /** Synchronous owner-wide configuration barrier, not a process-roster guess. */
  assertQuiescent(): void {
    this.lease.assert();
    if (this.phase !== "idle" || this.admissionClosed || this.uncertain)
      throw new ContractError("quarantine");
    if (
      this.activities.size ||
      this.attempt ||
      this.flushing ||
      this.stopWaits.size
    )
      throw new ContractError("conflict");
    if (this.actionQuiesce && !this.configurationGuard)
      throw new ContractError("unavailable");
    this.configurationGuard?.();
  }
  /** Called only after a synchronous successful configuration install. */
  configurationInstalled(): void {
    this.configurationChanged?.();
  }
  trackAccepted(original: Promise<AcceptedWorkResult>): void {
    this.track("work", original, (value) => value.status === "settled");
  }
  /** Ordinary conversations share Stop/lifetime ownership without task admission. */
  trackConversation(
    original: Promise<AcceptedWorkResult>,
    requestStop: () => void,
  ): void {
    this.track(
      "work",
      original,
      (value) => value.status === "settled",
      requestStop,
    );
  }
  get acceptedPending(): number {
    return [...this.activities].filter((a) => a.kind === "work").length;
  }
  private track<T>(
    kind: Kind,
    original: Promise<T>,
    known: (value: T) => boolean,
    requestStop?: () => void | Promise<void>,
    continuation = false,
  ): void {
    let owned = false;
    try {
      this.lease.assert();
      owned = true;
    } catch {
      /* fail closed below */
    }
    // Real W3 hooks can represent both child queues plus the owner queue; retain
    // that existing reservation ceiling, with bounded internal-operation headroom.
    const refused =
      !owned ||
      (this.phase !== "idle" && !(continuation && this.phase !== "stopped")) ||
      this.activities.size >=
        LIMITS.ownerQueueFrames * (LIMITS.childReservations + 1) + 256;
    // Even refused late registrations describe already-started effects. Retain
    // their original promises for diagnosis; quarantine is not settlement.
    // Capacity must be reserved BEFORE effects by scheduler/writer. The guard here
    // quarantines a broken adapter, but cannot discard its outstanding effects.
    const activity: Activity = {
      kind,
      settled: Promise.resolve(),
      requestStop,
    };
    // Observe the ORIGINAL promise; a caller timeout/AbortSignal is not passed
    // into this accounting and cannot remove the activity.
    activity.settled = original
      .then(
        (value) => {
          try {
            if (!known(value)) this.quarantine();
          } catch {
            this.quarantine();
          }
        },
        () => {
          this.quarantine();
        },
      )
      .then(() => {
        this.activities.delete(activity);
      });
    this.activities.add(activity);
    if (refused) {
      this.quarantine();
      throw new ContractError("quarantine");
    }
  }
  trackWorker(
    original: Promise<WorkerCompletion>,
    requestStop: () => void | Promise<void>,
  ): void {
    this.track(
      "process",
      original,
      (value) => {
        const completion = decodeWorkerCompletion(value);
        return (
          completion.native.closure !== "unconfirmed" &&
          completion.recording.status !== "uncertain" &&
          (completion.recording.status !== "refused" ||
            completion.native.closure === "not-launched") &&
          !(
            completion.recording.status === "pending" &&
            completion.selected !== null
          )
        );
      },
      requestStop,
    );
  }
  trackConversationProcess(
    original: Promise<NativeSettlement>,
    requestStop: () => void,
  ): void {
    this.track(
      "process",
      original,
      (value) => decodeNativeSettlement(value).closure !== "unconfirmed",
      requestStop,
    );
  }
  trackCheck(
    original: Promise<CheckNativeSettlement>,
    requestStop: () => void | Promise<void>,
  ): void {
    this.track(
      "process",
      original,
      (value) => decodeCheckNativeSettlement(value).closure !== "unconfirmed",
      requestStop,
    );
  }
  /** Auth adapter registers getAuth itself, not awaitWithAbort(getAuth). Normal
   * rejection is conservatively credential-uncertain here until local recovery.
   * Track its separate original journal-settlement promise via trackPersistence. */
  trackAuth(
    original: Promise<unknown>,
    recordedSettlement?: Promise<PersistenceResult>,
  ): void {
    // Independently handle the settlement promise even if tracking the original
    // is refused; that refusal quarantines, never drops a late write into success.
    void recordedSettlement?.catch(() => {});
    try {
      this.track("auth", original, () => true);
    } finally {
      if (recordedSettlement) this.trackPersistence(recordedSettlement);
    }
  }
  trackPersistence(original: Promise<PersistenceResult>): void {
    this.track("storage", original, committed);
  }
  /** Real writer job hook. Safety settlements and our own flush may finish while
   * admission is closed; ordinary new jobs cannot gain authority through it. */
  trackHistory(original: Promise<PersistenceResult>, safety: boolean): void {
    this.track(
      "storage",
      original,
      committed,
      undefined,
      safety || this.flushing,
    );
  }
  private persistPhase(phase: OwnerPhase): void {
    this.phase = phase;
    try {
      this.lease.phase(phase);
    } catch {
      this.phase = "quarantined";
      this.uncertain = true;
    }
  }
  private closeAdmission(): void {
    if (this.admissionClosed) return;
    this.admissionClosed = true;
    try {
      this.actionQuiesce?.();
    } catch {
      this.uncertain = true;
    }
    try {
      this.ports.quiesce();
    } catch {
      this.uncertain = true;
    }
  }
  quarantine(): void {
    this.uncertain = true;
    this.phase = "quarantined";
    this.closeAdmission();
    this.persistPhase("quarantined");
    this.requestStops();
  }
  private requestStops(): Promise<void>[] {
    try {
      this.lease.assert();
    } catch {
      // Lost ownership is not authority to signal a possibly reused PID.
      this.uncertain = true;
      return [...this.stopWaits];
    }
    for (const activity of this.activities) {
      if (!activity.requestStop || this.stopRequested.has(activity)) continue;
      try {
        this.lease.assert();
      } catch {
        this.uncertain = true;
        break;
      }
      this.stopRequested.add(activity);
      // Invoke all stop requests before awaiting any original handle. Do not
      // interpret request completion as direct-child close.
      try {
        const wait = Promise.resolve(activity.requestStop()).catch(() => {
          this.uncertain = true;
        });
        this.stopWaits.add(wait);
        void wait.then(() => {
          this.stopWaits.delete(wait);
        });
      } catch {
        this.uncertain = true;
      }
    }
    return [...this.stopWaits];
  }
  private async drainActivities(): Promise<void> {
    await Promise.all([...this.activities].map((a) => a.settled));
  }
  private async drain(): Promise<void> {
    const requests = this.requestStops();
    await Promise.all(requests);
    // Each boundary rechecks the set in THIS continuation before the next effect:
    // even a helper's final resolution can register another original job.
    while (this.activities.size) await this.drainActivities();
    if (this.uncertain || this.reportingExpired) {
      this.persistPhase("quarantined");
      return;
    }
    try {
      // No accepting flush fallback when W3 isn't composed. The returned original
      // promise is awaited even if the management caller stops waiting.
      this.lease.assert();
      this.flushing = true;
      let result: PersistenceResult;
      try {
        result = await this.ports.flush();
      } finally {
        this.flushing = false;
        // Flush may register additional safety jobs before settling (or throwing).
        // They remain original lifetime work even after a reporting refusal.
        while (this.activities.size) await this.drainActivities();
      }
      if (!committed(result)) {
        this.quarantine();
        return;
      }
      if (this.reportingExpired || this.uncertain) {
        this.persistPhase("quarantined");
        return;
      }
      this.lease.assert();
      if (!this.listenerClosed) {
        try {
          await this.ports.closeListener();
          this.listenerClosed = true;
        } finally {
          // Closing the listener is not a storage barrier. A late safety write
          // must settle before release, including on uncertain close paths.
          while (this.activities.size) await this.drainActivities();
        }
      }
      if (this.reportingExpired || this.uncertain) {
        this.persistPhase("quarantined");
        return;
      }
      this.lease.release();
      this.phase = "stopped";
    } catch {
      this.quarantine();
    }
  }
  /** The 60s bound reports only. After a bounded report expires, a late settlement
   * cannot release locks. A further explicit stop may retry known-clean draining;
   * uncertain native/credential/storage facts never become clean by waiting. */
  async stop(waitMs: number = LIMITS.stopWaitMs): Promise<OwnerStopReport> {
    if (
      !Number.isSafeInteger(waitMs) ||
      waitMs < 1 ||
      waitMs > LIMITS.stopWaitMs
    )
      throw new ContractError("invalid");
    if (this.phase === "stopped") return this.report();
    if (!this.attempt) {
      this.reportingExpired = false;
      // Publish the coalesced attempt BEFORE any external synchronous callback.
      // quiesce/requestStop may reenter stop without starting another drain.
      let complete!: () => void;
      this.attempt = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const finish = () => {
        this.attempt = undefined;
        complete();
      };
      // Close the in-memory registration gate before invoking external adapters.
      this.phase = "stopping";
      this.closeAdmission();
      this.persistPhase(this.uncertain ? "quarantined" : "stopping");
      void this.drain().then(finish, () => {
        this.quarantine();
        finish();
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.attempt,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.reportingExpired = true;
            this.persistPhase("quarantined");
            resolve();
          }, waitMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return this.report();
  }
  /** Join the current ORIGINAL attempt; never retry or upgrade its report. */
  async settled(): Promise<void> {
    await this.attempt;
  }
  private report(): OwnerStopReport {
    const pending = {
      process: 0,
      auth: 0,
      storage: this.flushing ? 1 : 0,
      work: 0,
    };
    for (const activity of this.activities) pending[activity.kind]++;
    return {
      state: this.phase === "stopped" ? "stopped" : "quarantined",
      pending,
      settlement: this.phase === "stopped" ? "known" : "uncertain",
    };
  }
}
