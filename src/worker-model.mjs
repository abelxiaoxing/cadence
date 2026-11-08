import { decodeModelRetry } from "./worker-public.mjs";
import { own } from "./worker-redaction.mjs";

/** One request-recovery policy for every service-owned SDK session. These waits
 * count against the original worker deadline; neither tools nor workers replay.
 * Native Pi owns its own settings. No user profile is loaded or copied here. */
export const WORKER_MODEL_SETTINGS = Object.freeze({
  compaction: { enabled: false },
  retry: {
    enabled: true,
    maxRetries: 6,
    baseDelayMs: 5000,
    maxAgentDelayMs: 120000,
    provider: { maxRetries: 0 },
  },
  httpIdleTimeoutMs: 300000,
  cacheWarming: "off",
});

/** Observation only: AgentSession owns classification, backoff and continuation.
 * Session listeners are synchronous. CaptureEmitter reserves/enqueues before
 * returning its promise; every rejection is handled without leaking SDK text. */
export class WorkerModelState {
  requestPrepared = false;
  actualResponseStatus = "UNKNOWN";
  retryAttempts = 0;
  progress = null;
  constructor(emit, fail) {
    this.emit = emit;
    this.fail = fail;
  }
  publish(progress) {
    this.progress = progress;
    try {
      return Promise.resolve(this.emit({ kind: "model-retry", progress }));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  event(event) {
    try {
      const type = own(event, "type");
      let pending;
      if (type === "auto_retry_start") {
        const progress = decodeModelRetry({
          phase: "waiting",
          attempt: own(event, "attempt"),
          maxAttempts: own(event, "maxAttempts"),
          delayMs: own(event, "delayMs"),
        });
        this.retryAttempts = progress.attempt;
        pending = this.publish(progress);
      } else if (type === "auto_retry_end" && this.progress) {
        // This event is not proof of success, native closure or task completion.
        pending = this.publish(null);
      }
      pending?.catch(() => this.fail());
    } catch {
      this.fail();
    }
  }
  async beginRequest() {
    // Each attempt owns its observations, including one that gets no response.
    this.requestPrepared = false;
    this.actualResponseStatus = "UNKNOWN";
    if (!this.progress) {
      this.retryAttempts = 0;
      return;
    }
    try {
      await this.publish({ ...this.progress, phase: "requesting", delayMs: 0 });
    } catch (error) {
      this.fail();
      throw error;
    }
  }
}
