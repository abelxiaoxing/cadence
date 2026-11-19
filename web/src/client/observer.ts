/* One observation attachment owner. No execution, preflight renewal or command replay. */
import {
  type ObservationState,
  ProjectionTracker,
} from "../../../src/service-client.ts";
import { compareSequence } from "../../../src/service-contract.ts";
import type { Scope, WorkspaceBootstrap } from "../types";
import type { BrowserClient } from "./browser";
import { refusedAccess } from "./observation-read";

export interface ViewerState {
  workspace?: WorkspaceBootstrap;
  epoch?: string;
  activeRuns?: import("../types").ActiveRuns;
  actions: boolean;
  attached: boolean;
  observation?: ObservationState;
  transportStatus: "current" | "stale" | "closed";
  attachmentVersion: number;
  /** Aborted synchronously on retirement, even before the next render. */
  readonly allocationSignal?: AbortSignal;
  error?: string;
}
/** Denial belongs to the selected project/page, not one poll, scope or owner
 * epoch. All its observation chains retire synchronously on the first refusal. */
export class ObservationAccess {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private denial?: { source: "entry" | "project" | "viewer"; code: string };
  get refusal() {
    return this.denial;
  }
  refuse(source: "entry" | "project" | "viewer", code: string) {
    if (!refusedAccess(code) || this.refusal) return;
    this.denial = { source, code };
    this.controller.abort(new Error(code));
  }
  check() {
    if (this.signal.aborted) throw this.signal.reason;
  }
  subscribe = (notify: () => void) => {
    this.signal.addEventListener("abort", notify);
    return () => this.signal.removeEventListener("abort", notify);
  };
  snapshot = () => this.refusal;
}
export class WorkspaceObserver {
  private serial: Promise<void> = Promise.resolve();
  private version = 0;
  private attachmentVersion = 0;
  private stopCurrent: (() => void) | undefined;
  private pollCurrent: (() => void) | undefined;
  private latest: ViewerState | undefined;
  private readonly readiness = new Set<(state: ViewerState) => void>();
  /** Wait for the existing observation owner; never allocate a second session.
   * The current explicit Send owns the abort/deadline and its context claim. */
  nextObservation(): number {
    return this.version + 1;
  }
  whenReady(
    epoch: string,
    signal: AbortSignal,
    expectedVersion = 0,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        this.readiness.delete(check);
        signal.removeEventListener("abort", abort);
        this.access.signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const check = (state: ViewerState) => {
        if (expectedVersion && this.version > expectedVersion)
          return finish(new Error("stale"));
        if (this.version < expectedVersion || state.epoch !== epoch) return;
        if (
          state.workspace?.epoch === epoch &&
          state.attached &&
          !state.error &&
          state.transportStatus === "current" &&
          (!state.observation || state.observation.connection === "current")
        )
          finish();
      };
      const abort = () =>
        finish(
          new Error(
            this.access.refusal?.code ?? this.latest?.error ?? "unavailable",
          ),
        );
      if (signal.aborted || this.access.signal.aborted) {
        abort();
        return;
      }
      this.readiness.add(check);
      this.access.signal.addEventListener("abort", abort, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (this.latest) check(this.latest);
    });
  }
  constructor(
    private readonly api: BrowserClient,
    readonly access = new ObservationAccess(),
  ) {}
  refresh(): void {
    this.pollCurrent?.();
  }
  observe(
    scope: Scope | null,
    publish: (value: ViewerState) => void,
  ): () => void {
    this.stopCurrent?.();
    const version = ++this.version;
    let disposed = false;
    let stopSocket: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let abort = new AbortController();
    let tracker = new ProjectionTracker();
    let generation = 0;
    let socketVersion = 0;
    let reading: Promise<void> | undefined;
    let storeId: string | undefined;
    // An HTTP poll can repair the projection, not prove a task socket alive.
    let socketError: string | undefined;
    let acquiring = false;
    let lastPoll = 0;
    // A failed read (e.g. a passive read fenced by publication) is observed
    // again soon rather than after the full reconcile period. Readonly only.
    let failed = false;
    let blocked = false;
    let allocationPendingRelease = false;
    let repairRevision = 0;
    let repairNeeded = false;
    let followup = false;
    let minimumSeq = "0";
    let actionCapability = false;
    let state: ViewerState = {
      actions: false,
      attached: false,
      transportStatus: "closed",
      attachmentVersion: 0,
    };
    this.latest = state;
    const current = () => !disposed && version === this.version;
    const matchesOwner = (data: { epoch: string; storeId: string }) =>
      data.epoch === state.epoch && data.storeId === storeId;
    const emit = () => {
      if (!current()) return;
      const observation = tracker.state;
      this.latest = {
        ...state,
        error: state.error ?? socketError,
        observation,
        actions:
          state.actions &&
          state.transportStatus === "current" &&
          (!scope || observation?.connection === "current"),
      };
      publish(this.latest);
      for (const check of this.readiness) check(this.latest);
    };
    const retire = () => {
      socketVersion++;
      abort.abort();
      stopSocket?.();
      stopSocket = undefined;
      state = {
        ...state,
        attached: false,
        actions: false,
        allocationSignal: undefined,
      };
    };
    const stop = () => {
      if (disposed) return;
      disposed = true;
      this.access.signal.removeEventListener("abort", revoked);
      retire();
      clearInterval(timer);
      clearTimeout(retry);
      if (version === this.version) {
        this.pollCurrent = undefined;
        this.latest = undefined;
      }
      if (!blocked) enqueue(detach);
    };
    this.stopCurrent = stop;
    // One serialized observation lifetime. Session retries reuse the transport's
    // exact allocation ID, even after a lost reply; no command/grant is replayed.
    const retryAttachment = () => {
      clearTimeout(retry);
      if (current() && !blocked) retry = setTimeout(reconnect, 1000);
    };
    const enqueue = (job: () => Promise<void>) => {
      this.serial = this.serial.then(job).catch((error: unknown) => {
        if (current() && !blocked) {
          retire();
          state.error = error instanceof Error ? error.message : "unavailable";
          state.transportStatus = "stale";
          emit();
          retryAttachment();
        }
      });
    };
    const reconnect = () => {
      if (!current() || blocked || acquiring) return;
      clearTimeout(retry);
      acquiring = true;
      enqueue(async () => {
        try {
          await acquire();
        } finally {
          acquiring = false;
        }
      });
    };
    const detach = async () => {
      // A poll may already be reading this allocation's session body. Join
      // its bounded, aborted read before releasing or replacing the viewer.
      await reading;
      const released = await this.api.transport.detach();
      allocationPendingRelease = false;
      // A final authenticated detach refusal concerns this project's access
      // even when navigation has already queued the next scope's acquisition.
      if (released?.kind === "error" && refusedAccess(released.error.code))
        this.access.refuse("viewer", released.error.code);
    };
    const poll = (refreshSession = true) => {
      if (!current() || !state.attached || blocked || reading) return reading;
      const signal = abort.signal;
      state.actions = false;
      lastPoll = Date.now();
      reading = read(refreshSession, signal, repairRevision).then(
        (succeeded) => {
          reading = undefined;
          if (!current() || signal.aborted) return;
          failed = !succeeded;
          state.actions = !!succeeded && actionCapability;
          emit();
          if (!succeeded && state.error === "stale") {
            if (acquiring) retryAttachment();
            else reconnect();
          } else if (followup) {
            followup = false;
            void poll();
          }
        },
      );
      emit();
      return reading;
    };
    const read = async (
      refreshSession: boolean,
      signal: AbortSignal,
      revision: number,
    ) => {
      try {
        // Keep the same attachment alive and notice a replacement owner even
        // in ordinary chat, where there is no WebSocket or changed model list.
        if (refreshSession) {
          const session = await this.api.client.session(signal);
          if (!current() || signal.aborted) return;
          if (session.kind === "error") {
            state.actions = false;
            state.error = session.error.code;
            if (refusedAccess(session.error.code)) deny(session.error.code);
            return;
          }
          if (!matchesOwner(session.value)) {
            state.error = "stale";
            return;
          }
          actionCapability = session.value.capabilities.actions;
        }
        // Safety roster is independent of selected history/workspace proof progress.
        // Inconclusive history must not make active work undiscoverable for Cancel.
        const active = await this.api.client.activeRuns(signal);
        if (!current() || signal.aborted) return;
        if (active.kind === "ok") {
          if (!matchesOwner(active.value)) {
            state.error = "stale";
            return;
          }
          state.activeRuns = active.value;
        } else if (refusedAccess(active.error.code)) {
          deny(active.error.code);
          return;
        } else state.activeRuns = undefined;
        emit();
        const workspace = await this.api.client.workspace(signal);
        if (!current() || signal.aborted) return;
        if (workspace.kind === "error") {
          state.error = workspace.error.code;
          if (refusedAccess(workspace.error.code)) deny(workspace.error.code);
          return;
        }
        if (!matchesOwner(workspace.value)) {
          state.error = "stale";
          return;
        }
        state.workspace = workspace.value;
        if (scope) {
          const ticket = tracker.beginSnapshot();
          const reply = await this.api.client.snapshot(scope, signal);
          if (!current() || signal.aborted) return;
          if (reply.kind === "error") {
            state.error = reply.error.code;
            if (refusedAccess(reply.error.code)) deny(reply.error.code);
            return;
          }
          if (!matchesOwner(reply.value)) {
            state.error = "stale";
            return;
          }
          // A snapshot begun before a new synchronization demand cannot
          // satisfy it, even at the same watermark.
          if (revision !== repairRevision) return;
          if (compareSequence(reply.value.committedSeq, minimumSeq) < 0) return;
          const previous = tracker.state;
          const installed = tracker.install(reply.value, Date.now(), ticket);
          if (installed !== undefined) {
            generation = installed;
            repairNeeded = false;
            if (
              state.transportStatus === "current" &&
              (previous?.connection !== "current" ||
                previous.snapshot.committedSeq !== reply.value.committedSeq)
            )
              state.transportStatus = "stale";
          }
        } else state.transportStatus = "current";
        state.error = undefined;
        return true;
      } catch {
        if (current() && !signal.aborted) {
          state.error = "Observation unavailable.";
          state.actions = false;
          state.transportStatus = "stale";
        }
      }
    };
    const deny = (code: string) => {
      this.access.refuse("viewer", code);
    };
    const revoked = () => {
      blocked = true;
      retire();
      state.transportStatus = "closed";
      state.error = this.access.refusal?.code;
      state.workspace = undefined;
      state.activeRuns = undefined;
      tracker = new ProjectionTracker();
      clearInterval(timer);
      clearTimeout(retry);
      if (allocationPendingRelease) enqueue(detach);
      emit();
    };
    const acquire = async () => {
      if (!current() || blocked) return;
      retire();
      emit();
      await detach();
      if (!current() || blocked) return;
      allocationPendingRelease = true;
      const session = await this.api.client.session(this.access.signal);
      if (!current() || blocked) return; // its stop/refusal already enqueued release
      if (session.kind === "error") {
        if (refusedAccess(session.error.code)) {
          // No viewer was granted by this initial allocation.
          allocationPendingRelease = false;
          deny(session.error.code);
          return;
        }
        throw new Error(session.error.code);
      }
      abort = new AbortController();
      tracker = new ProjectionTracker();
      storeId = session.value.storeId;
      repairRevision = 0;
      repairNeeded = followup = false;
      minimumSeq = "0";
      state = {
        epoch: session.value.epoch,
        attached: true,
        allocationSignal: abort.signal,
        actions: false,
        transportStatus: "closed",
        attachmentVersion: ++this.attachmentVersion,
      };
      actionCapability = session.value.capabilities.actions;
      emit();
      await poll(false); // acquire already read this exact session
      if (!current() || blocked || !scope || state.error === "stale") return;
      const socket = ++socketVersion;
      const lost = (error: string) => {
        retire();
        socketError = error;
        state.transportStatus = "closed";
        state.attachmentVersion = ++this.attachmentVersion;
        retryAttachment();
        emit();
      };
      stopSocket = this.api.transport.subscribe(
        scope,
        (message) => {
          if (!current() || blocked || socket !== socketVersion) return;
          const data =
            message.kind === "snapshot"
              ? message.snapshot
              : message.kind === "event"
                ? message.event
                : undefined;
          if (
            data &&
            (!matchesOwner(data) ||
              data.scope.kind !== scope.kind ||
              data.scope.id !== scope.id)
          ) {
            lost("stale");
            return;
          }
          let accepted = false;
          if (message.kind === "snapshot") {
            if (compareSequence(message.snapshot.committedSeq, minimumSeq) < 0)
              return;
            const installed = tracker.install(
              message.snapshot,
              Date.now(),
              tracker.beginSnapshot(),
            );
            if (installed !== undefined) {
              generation = installed;
              repairNeeded = followup = false;
              accepted = true;
            }
          } else if (message.kind === "event") {
            if (
              repairNeeded &&
              compareSequence(message.event.committedSeq, minimumSeq) <= 0
            )
              return;
            const result = repairNeeded
              ? "resync"
              : tracker.receive(message.event, generation, Date.now());
            if (result === "duplicate") return;
            accepted = result === "applied";
          }
          if (accepted) {
            socketError = undefined;
            state.transportStatus = "current";
          } else {
            state.transportStatus = "stale";
            if (data && compareSequence(data.committedSeq, minimumSeq) > 0)
              minimumSeq = data.committedSeq;
            repairNeeded = true;
            repairRevision++;
            // One trailing poll per outstanding demand, not per timer tick.
            if (reading) followup = true;
            else void poll();
          }
          emit();
        },
        (status) => {
          if (!current() || blocked || socket !== socketVersion) return;
          if (status === "closed") lost(socketError ?? "socket-closed");
          else {
            socketError = "socket-timeout";
            state.transportStatus = "stale";
            emit();
          }
        },
      );
    };
    if (this.access.signal.aborted) {
      revoked();
      return stop;
    }
    this.access.signal.addEventListener("abort", revoked, { once: true });
    reconnect();
    this.pollCurrent = () => {
      if (state.attached) void poll();
      else reconnect();
    };
    timer = setInterval(() => {
      if (!current() || blocked) return;
      tracker.tick(Date.now());
      emit();
      if (
        Date.now() - lastPoll >= (failed ? 2000 : 30000) ||
        (scope && tracker.needsPoll(Date.now()))
      )
        void poll();
    }, 1000);
    return stop;
  }
}
