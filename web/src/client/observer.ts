/* One observation attachment owner. No execution, preflight renewal or command replay. */
import {
  type ObservationState,
  ProjectionTracker,
} from "../../../src/service-client.ts";
import type { Scope, WorkspaceBootstrap } from "../types";
import type { BrowserClient } from "./browser";
export interface ViewerState {
  workspace?: WorkspaceBootstrap;
  epoch?: string;
  activeRuns?: import("../types").ActiveRuns;
  actions: boolean;
  attached: boolean;
  observation?: ObservationState;
  transportStatus: "current" | "stale" | "closed";
  attachmentVersion: number;
  error?: string;
}
const revoked = (code: string) =>
  code === "unauthenticated" || code === "forbidden";
export class WorkspaceObserver {
  private serial: Promise<void> = Promise.resolve();
  private version = 0;
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
    minimumVersion = 0,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        this.readiness.delete(check);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const check = (state: ViewerState) => {
        if (this.version < minimumVersion || state.epoch !== epoch) return;
        if (
          state.workspace?.epoch === epoch &&
          state.attached &&
          !state.error &&
          state.transportStatus === "current"
        )
          finish();
      };
      const abort = () =>
        finish(new Error(this.latest?.error ?? "unavailable"));
      if (signal.aborted) {
        abort();
        return;
      }
      this.readiness.add(check);
      signal.addEventListener("abort", abort, { once: true });
      if (this.latest) check(this.latest);
    });
  }
  constructor(private readonly api: BrowserClient) {}
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
    let reading = false;
    let acquiring = false;
    let lastPoll = 0;
    // A failed read (e.g. a passive read fenced by publication) is observed
    // again soon rather than after the full reconcile period. Readonly only.
    let failed = false;
    let blocked = false;
    let actionCapability = false;
    let state: ViewerState = {
      actions: false,
      attached: false,
      transportStatus: "closed",
      attachmentVersion: 0,
    };
    this.latest = state;
    const current = () => !disposed && version === this.version;
    const emit = () => {
      if (!current()) return;
      this.latest = { ...state, observation: tracker.state };
      publish(this.latest);
      for (const check of this.readiness) check(this.latest);
    };
    const stop = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearInterval(timer);
      clearTimeout(retry);
      socketVersion++;
      stopSocket?.();
      if (version === this.version) this.pollCurrent = undefined;
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
          abort.abort();
          socketVersion++;
          stopSocket?.();
          state.attached = false;
          state.error = error instanceof Error ? error.message : "unavailable";
          state.actions = false;
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
      await this.api.transport.detach();
    };
    const poll = async (refreshSession = true) => {
      if (!current() || !state.attached || reading || blocked) return;
      reading = true;
      state.actions = false;
      let succeeded = false;
      emit();
      lastPoll = Date.now();
      const signal = abort.signal;
      try {
        // Keep the same attachment alive and notice a replacement owner even
        // in ordinary chat, where there is no WebSocket or changed model list.
        if (refreshSession) {
          const session = await this.api.client.session(signal);
          if (!current() || signal.aborted) return;
          if (session.kind === "error") {
            state.actions = false;
            state.error = session.error.code;
            if (revoked(session.error.code)) revoke();
            return;
          }
          if (session.value.epoch !== state.epoch) {
            state.error = "stale";
            return;
          }
          actionCapability = session.value.capabilities.actions;
        }
        if (!scope) state.transportStatus = "current";
        // Safety roster is independent of selected history/workspace proof progress.
        // Inconclusive history must not make active work undiscoverable for Cancel.
        const active = await this.api.client.activeRuns(signal);
        if (!current() || signal.aborted) return;
        if (active.kind === "ok") {
          if (active.value.epoch !== state.epoch) {
            state.error = "stale";
            return;
          }
          state.activeRuns = active.value;
        } else if (revoked(active.error.code)) {
          revoke();
          return;
        } else state.activeRuns = undefined;
        emit();
        const workspace = await this.api.client.workspace(signal);
        if (!current() || signal.aborted) return;
        if (workspace.kind === "error") {
          state.error = workspace.error.code;
          if (revoked(workspace.error.code)) revoke();
          return;
        }
        if (workspace.value.epoch !== state.epoch) {
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
            if (revoked(reply.error.code)) revoke();
          } else if (reply.value.epoch !== state.epoch) {
            state.error = "stale";
          } else {
            const installed = tracker.install(reply.value, Date.now(), ticket);
            if (installed !== undefined) generation = installed;
            state.error = undefined;
            succeeded = true;
          }
        } else {
          state.error = undefined;
          succeeded = true;
        }
      } catch {
        if (current() && !signal.aborted) {
          state.error = "Observation unavailable.";
          state.actions = false;
          state.transportStatus = "stale";
        }
      } finally {
        reading = false;
        if (current() && !signal.aborted) {
          failed = !succeeded;
          state.actions = succeeded && actionCapability;
          emit();
          if (!succeeded && state.error === "stale") reconnect();
        }
      }
    };
    const revoke = () => {
      blocked = true;
      state.attached = false;
      state.actions = false;
      state.transportStatus = "closed";
      state.error = "Access revoked; explicit token re-entry required.";
      state.workspace = undefined;
      state.activeRuns = undefined;
      tracker = new ProjectionTracker();
      abort.abort();
      clearInterval(timer);
      clearTimeout(retry);
      socketVersion++;
      stopSocket?.();
      enqueue(detach);
      emit();
    };
    const acquire = async () => {
      if (!current() || blocked) return;
      state.attached = false;
      state.actions = false;
      abort.abort();
      socketVersion++;
      stopSocket?.();
      await detach();
      if (!current() || blocked) return;
      const session = await this.api.client.session();
      if (!current() || blocked) {
        await detach();
        return;
      }
      if (session.kind === "error") {
        if (revoked(session.error.code)) {
          revoke();
          return;
        }
        throw new Error(session.error.code);
      }
      abort = new AbortController();
      tracker = new ProjectionTracker();
      state = {
        epoch: session.value.epoch,
        attached: true,
        actions: session.value.capabilities.actions,
        transportStatus: "closed",
        attachmentVersion: state.attachmentVersion + 1,
      };
      actionCapability = session.value.capabilities.actions;
      emit();
      await poll(false); // acquire already read this exact session
      if (!current() || blocked || !scope) return;
      const socket = ++socketVersion;
      stopSocket = this.api.transport.subscribe(
        scope,
        (message) => {
          if (!current() || blocked || socket !== socketVersion) return;
          if (message.kind === "snapshot") {
            const installed = tracker.install(
              message.snapshot,
              Date.now(),
              tracker.beginSnapshot(),
            );
            if (installed !== undefined) generation = installed;
          } else if (message.kind === "event") {
            if (
              tracker.receive(message.event, generation, Date.now()) ===
              "resync"
            )
              void poll();
          } else void poll();
          emit();
        },
        (status) => {
          if (!current() || blocked || socket !== socketVersion) return;
          state.transportStatus = status;
          if (status === "closed") {
            state.attached = false;
            state.actions = false;
            state.attachmentVersion++;
            abort.abort();
            socketVersion++;
            // The server revoked this socket's attachment. Acquire observation only;
            // dialogs/grants are invalidated, never silently renewed.
            retryAttachment();
          }
          emit();
        },
      );
    };
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
    return () => {
      // Cleanup may be called after a replacement scope has already taken over.
      // It must neither clear the new poll hook nor detach the new attachment.
      if (!current()) return;
      stop();
      enqueue(detach);
    };
  }
}
