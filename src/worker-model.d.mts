import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CaptureEvent, ModelRetry } from "./worker-public.mjs";
export declare const WORKER_POLICY: Readonly<{
  retry: { provider: { maxRetries: 0 } };
  cacheWarming: "off";
  httpIdleTimeoutMs: 0;
}>;
export declare const WORKER_SETTINGS_BYTES: 32768;
export interface WorkerRuntime {
  projectTrusted: boolean;
  tools: { edit: string[]; readonly: string[] };
  settings: {
    compaction: ReturnType<SettingsManager["getCompactionSettings"]>;
    retry: ReturnType<SettingsManager["getRetrySettings"]> & {
      provider: { maxRetries: 0; maxRetryDelayMs: number; timeoutMs?: number };
    };
    httpIdleTimeoutMs: number;
    websocketConnectTimeoutMs?: number;
    transport: ReturnType<SettingsManager["getTransport"]>;
    thinkingBudgets?: ReturnType<SettingsManager["getThinkingBudgets"]>;
    images: { autoResize: boolean; blockImages: boolean };
    shellPath?: string;
    shellCommandPrefix?: string;
    cacheWarming: "off";
  };
}
export declare function defaultWorkerTools(
  pi: Pick<
    typeof import("@earendil-works/pi-coding-agent"),
    "createCodingTools" | "createReadOnlyTools" | "createPowerShellTool"
  >,
  cwd: string,
): { edit: string[]; readonly: string[]; available: string[] };
export declare function resolveWorkerRuntime(
  manager: SettingsManager,
  model: { provider: string; id: string },
  defaults: { edit: string[]; readonly: string[]; available: string[] },
): WorkerRuntime;
export declare function decodeWorkerRuntime(value: unknown): WorkerRuntime;
export declare function describeWorkerRuntime(runtime: WorkerRuntime): string;
export declare class WorkerModelState {
  constructor(emit: (event: CaptureEvent) => unknown, fail: () => void);
  requestPrepared: boolean;
  actualResponseStatus: number | "UNKNOWN";
  retryAttempts: number;
  progress: ModelRetry | null;
  event(event: unknown): void;
  beginRequest(): Promise<void>;
}
