import { Worker } from "node:worker_threads";

export interface WorkspaceIoMetrics {
  operation: "captureBaseline" | "materialize" | "verificationIdentity";
  elapsedMs: number;
  files: number;
  bytes: number;
}

/** Trusted local I/O worker; it has no model, tools, or workflow authority. */
export async function runWorkspaceIo<T>(input: {
  root: string;
  artifactRoot: string;
  operation: WorkspaceIoMetrics["operation"];
  args: unknown[];
  signal?: AbortSignal;
  onMetrics?: (metrics: WorkspaceIoMetrics) => void;
}): Promise<T> {
  input.signal?.throwIfAborted();
  const cancelled = new SharedArrayBuffer(4);
  const flag = new Int32Array(cancelled);
  const started = performance.now();
  const worker = new Worker(
    new URL("./workspace-io-worker.mjs", import.meta.url),
    {
      workerData: {
        root: input.root,
        artifactRoot: input.artifactRoot,
        operation: input.operation,
        args: input.args,
        cancelled,
      },
      // The shipped worker is pure JavaScript, including when installed under node_modules.
      execArgv: [],
    },
  );
  const abort = () => {
    Atomics.store(flag, 0, 1);
    worker.postMessage("cancel");
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  try {
    return await new Promise<T>((resolve, reject) => {
      let message:
        | {
            ok: boolean;
            result?: T;
            error?: string;
            files: number;
            bytes: number;
          }
        | undefined;
      let failure: Error | undefined;
      worker.once("message", (value) => {
        message = value;
      });
      worker.once("error", (error) => {
        failure = error;
      });
      // Wait for exit so no mutation or Git process survives command settlement.
      worker.once("exit", (code) => {
        try {
          input.onMetrics?.({
            operation: input.operation,
            elapsedMs: performance.now() - started,
            files: message?.files ?? 0,
            bytes: message?.bytes ?? 0,
          });
        } catch {
          /* Metrics cannot change workflow facts. */
        }
        if (input.signal?.aborted) reject(input.signal.reason);
        else if (failure || code !== 0 || !message)
          reject(new Error("workspace-io-unavailable"));
        else if (!message.ok)
          reject(new Error(message.error ?? "workspace-io-failed"));
        else resolve(message.result as T);
      });
    });
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
