/* One observation attachment owner. No execution, preflight renewal or command replay. */
import {
  type ObservationState,
  ProjectionTracker,
} from "../../../src/service-client.ts";
import {
  canonicalJson,
  compatibleBuild,
} from "../../../src/service-contract.ts";
import type { Scope, WorkspaceBootstrap } from "../types";
import type { BrowserClient } from "./browser";
import { localBuild } from "./build-identity";
export interface ViewerState {
  workspace?: WorkspaceBootstrap;
  activeRuns?: import("../types").ActiveRuns;
  actions: boolean;
  compatible?: boolean;
  cancelCompatible?: boolean;
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
  private pollCurrent: ((capabilities?: boolean) => void) | undefined;
  constructor(private readonly api: BrowserClient) {}
  refresh(capabilities = false): void {
    this.pollCurrent?.(capabilities);
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
    // A failed read (for example a transient inconclusive answer while the owner
    // publishes) is observed again soon with doubling delay, up to the 30s cadence.
    let reread: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let abort = new AbortController();
    let tracker = new ProjectionTracker();
    let generation = 0;
    let socketVersion = 0;
    let reading = false;
    let attached = false;
    let lastPoll = 0;
    let blocked = false;
    let actionCapability = false;
    let state: ViewerState = {
      actions: false,
      transportStatus: "closed",
      attachmentVersion: 0,
    };
    const current = () => !disposed && version === this.version;
    const emit = () => {
      if (current()) publish({ ...state, observation: tracker.state });
    };
    const stop = () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clearInterval(timer);
      clearTimeout(retry);
      clearTimeout(reread);
      socketVersion++;
      stopSocket?.();
      if (version === this.version) this.pollCurrent = undefined;
    };
    this.stopCurrent = stop;
    // Session allocation is deliberately awaited, not abandoned: a late successful
    // allocation must be detached before any replacement acquires another slot.
    const enqueue = (job: () => Promise<void>) => {
      this.serial = this.serial.then(job).catch(() => {
        if (current()) {
          blocked = true;
          abort.abort();
          clearInterval(timer);
          clearTimeout(retry);
          socketVersion++;
          stopSocket?.();
          state.error =
            "Observation unavailable or detach unconfirmed; explicit re-entry required.";
          state.actions = false;
          state.transportStatus = "closed";
          state.workspace = undefined;
          tracker = new ProjectionTracker();
          emit();
        }
      });
    };
    const detach = async () => {
      await this.api.transport.detach();
    };
    const poll = async (capabilities = false) => {
      if (!current() || !attached || reading || blocked) return;
      reading = true;
      state.actions = false;
      let succeeded = false;
      emit();
      lastPoll = Date.now();
      const signal = abort.signal;
      try {
        // Capability observations reuse the exact attachment, never allocation,
        // a new grant or mutation replay. Another client can change owner choice.
        const refreshCapabilities = async () => {
          const session = await this.api.client.session(signal);
          if (!current() || signal.aborted) return false;
          if (session.kind === "error") {
            state.actions = false;
            state.error = session.error.code;
            if (revoked(session.error.code)) revoke();
            return false;
          }
          installCapabilities(session.value);
          return true;
        };
        if (capabilities && !(await refreshCapabilities())) return;
        if (!scope) state.transportStatus = "current";
        // Safety roster is independent of selected history/workspace proof progress.
        // Inconclusive history must not make active work undiscoverable for Cancel.
        const active = await this.api.client.activeRuns(signal);
        if (!current() || signal.aborted) return;
        if (active.kind === "ok") state.activeRuns = active.value;
        else if (revoked(active.error.code)) {
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
        if (
          !capabilities &&
          canonicalJson(state.workspace?.models ?? []) !==
            canonicalJson(workspace.value.models) &&
          !(await refreshCapabilities())
        )
          return;
        state.workspace = workspace.value;
        if (scope) {
          const ticket = tracker.beginSnapshot();
          const reply = await this.api.client.snapshot(scope, signal);
          if (!current() || signal.aborted) return;
          if (reply.kind === "error") {
            state.error = reply.error.code;
            if (revoked(reply.error.code)) revoke();
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
        if (current()) {
          state.error = "Observation unavailable.";
          state.actions = false;
          state.transportStatus = "stale";
        }
      } finally {
        reading = false;
        state.actions = succeeded && actionCapability;
        emit();
        clearTimeout(reread);
        if (succeeded) failures = 0;
        else if (current() && attached && !blocked) {
          const delay = Math.min(30000, 2000 * 2 ** failures++);
          reread = setTimeout(() => void poll(), delay);
        }
      }
    };
    const revoke = () => {
      blocked = true;
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
    const installCapabilities = (
      session: import("../types").SessionBootstrap,
    ) => {
      const build = localBuild
        ? { kind: "browser" as const, ...localBuild }
        : null;
      state.compatible = compatibleBuild(session.build, build);
      state.cancelCompatible = compatibleBuild(session.build, build, true);
      actionCapability = session.capabilities.actions && state.compatible;
    };
    const acquire = async () => {
      attached = false;
      await detach();
      if (!current() || blocked) return;
      const session = await this.api.client.session();
      if (!current() || blocked) {
        await detach();
        return;
      }
      if (session.kind === "error") {
        blocked = true; // Unknown allocation/auth: never loop creating unused grants.
        state.error = `${session.error.code}; explicit re-entry required.`;
        state.workspace = undefined;
        tracker = new ProjectionTracker();
        state.actions = false;
        emit();
        return;
      }
      attached = true;
      abort = new AbortController();
      tracker = new ProjectionTracker();
      state = {
        actions: session.value.capabilities.actions,
        transportStatus: "closed",
        attachmentVersion: state.attachmentVersion + 1,
      };
      installCapabilities(session.value);
      emit();
      await poll();
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
            attached = false;
            state.actions = false;
            state.attachmentVersion++;
            abort.abort();
            socketVersion++;
            // The server revoked this socket's attachment. Acquire observation only;
            // dialogs/grants are invalidated, never silently renewed.
            retry = setTimeout(() => enqueue(acquire), 1000);
          }
          emit();
        },
      );
    };
    enqueue(acquire);
    this.pollCurrent = (capabilities) => {
      void poll(capabilities);
    };
    timer = setInterval(() => {
      if (!current() || blocked) return;
      tracker.tick(Date.now());
      emit();
      if (
        Date.now() - lastPoll >= 30000 ||
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
