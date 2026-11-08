import type { CaptureEvent, ModelRetry } from "./worker-public.mjs";
export declare const WORKER_MODEL_SETTINGS: Readonly<{
  compaction: { enabled: false };
  retry: {
    enabled: true;
    maxRetries: 6;
    baseDelayMs: 5000;
    maxAgentDelayMs: 120000;
    provider: { maxRetries: 0 };
  };
  httpIdleTimeoutMs: 300000;
  cacheWarming: "off";
}>;
export declare class WorkerModelState {
  constructor(emit: (event: CaptureEvent) => unknown, fail: () => void);
  requestPrepared: boolean;
  actualResponseStatus: number | "UNKNOWN";
  retryAttempts: number;
  progress: ModelRetry | null;
  event(event: unknown): void;
  beginRequest(): Promise<void>;
}
