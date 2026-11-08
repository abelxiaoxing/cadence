/** SDK-free process ownership for readonly model discovery. No runtime/result
 * cache: only concurrent identical inputs share an original through native close. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ContractError,
  canonicalJson,
  decodeReply,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import { decodeModelPreview, type ModelPreview } from "./contracts/models.ts";
import { processStart } from "./liveness.ts";
import { captureEnvironment, type LaunchEnvironment } from "./model-config.ts";
import {
  decodeModelPreviewInput,
  type ModelPreviewInput,
  PREVIEW_INPUT_BYTES,
  PREVIEW_PROCESSES,
  PREVIEW_TIMEOUT_MS,
} from "./model-preview-protocol.ts";
import { hostEnvironment } from "./runtime.ts";

export type PreviewSource = Omit<ModelPreviewInput, "kind"> & {
  environment: LaunchEnvironment;
};
interface Job {
  result: Promise<ModelPreview>;
  /** Native close, or an explicit failure to confirm it; not a slot release. */
  settlement: Promise<void>;
  stop(): void;
}
export class ModelPreviewProcesses {
  private jobs = new Map<string, Job>();
  private stopping = false;
  private poisoned = false;
  constructor(
    private readonly options: {
      worker: URL;
      assertCurrent(): void;
      launched(pid: number): void;
      closed(pid: number): void;
      unconfirmed(): void;
    },
  ) {}
  get uncertain(): boolean {
    return this.poisoned;
  }
  read(source: PreviewSource): Promise<ModelPreview> {
    try {
      this.options.assertCurrent();
      if (this.stopping || this.poisoned) throw new ContractError("quarantine");
      const { environment, ...fields } = source;
      const input = decodeModelPreviewInput({
        kind: "cadence-model-preview/1",
        ...fields,
      });
      const body = canonicalJson(input, PREVIEW_INPUT_BYTES);
      // Same sanitized launch facts as the standalone project host. Neither
      // credentials nor SDK loader options are accepted from an HTTP request.
      const env = captureEnvironment(hostEnvironment(environment));
      const key = createHash("sha256")
        .update(body)
        .update(JSON.stringify(env))
        .digest("hex");
      const previous = this.jobs.get(key);
      if (previous) return previous.result;
      if (this.jobs.size >= PREVIEW_PROCESSES)
        throw new ContractError("capacity");
      const job = this.launch(body, env, key, input.home);
      this.jobs.set(key, job);
      return job.result;
    } catch (error) {
      return Promise.reject(error);
    }
  }
  invalidate(): void {
    for (const job of this.jobs.values()) job.stop();
  }
  async close(): Promise<void> {
    this.stopping = true;
    this.invalidate();
    await Promise.all([...this.jobs.values()].map((job) => job.settlement));
    if (this.poisoned) throw new ContractError("quarantine");
  }
  private launch(
    body: string,
    env: LaunchEnvironment,
    key: string,
    cwd: string,
  ): Job {
    let resolveResult!: (value: ModelPreview) => void,
      rejectResult!: (error: Error) => void;
    let resolveSettlement!: () => void,
      rejectSettlement!: (error: Error) => void;
    const result = new Promise<ModelPreview>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const settlement = new Promise<void>((resolve, reject) => {
      resolveSettlement = resolve;
      rejectSettlement = reject;
    });
    // A readonly HTTP subscriber may leave before the original closes.
    void result.catch(() => {});
    void settlement.catch(() => {});
    const child = spawn(
      process.execPath,
      [fileURLToPath(this.options.worker)],
      {
        cwd,
        env,
        windowsHide: true,
        // Own group for exact-identity crash recovery; IPC remains parent-owned.
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore", "ipc"],
      },
    );
    const pid = child.pid,
      started = pid ? processStart(pid) : null;
    let closed = false,
      stopping = false,
      failed: Error | undefined;
    let bytes = 0;
    const chunks: Buffer[] = [];
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let unknownTimer: ReturnType<typeof setTimeout> | undefined;
    const signal = (value: NodeJS.Signals) => {
      if (
        closed ||
        child.exitCode !== null ||
        child.signalCode !== null ||
        !pid
      )
        return;
      // A live native child handle covers platforms without start identities.
      // Where available, never send TERM/KILL to a reused or unidentifiable PID.
      try {
        this.options.assertCurrent();
      } catch {
        return;
      }
      if (started && processStart(pid) !== started) return;
      try {
        child.kill(value);
      } catch {
        /* Closure remains outstanding. */
      }
    };
    const stop = (error = new ContractError("unavailable")) => {
      failed ??= error;
      if (closed || stopping) return;
      stopping = true;
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), LIMITS.terminateGraceMs);
      unknownTimer = setTimeout(() => {
        if (closed) return;
        this.poisoned = true;
        const error = new ContractError("quarantine");
        rejectResult(error);
        rejectSettlement(error);
        // Keep this original charged and its ledger identity until actual close.
        this.options.unconfirmed();
      }, LIMITS.unconfirmedStopMs);
    };
    const deadline = setTimeout(() => stop(), PREVIEW_TIMEOUT_MS);
    child.once("error", () => stop());
    child.stdin?.on("error", () => stop());
    child.stdout?.on("error", () => stop());
    child.stdout?.on("data", (chunk: Buffer) => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > LIMITS.pageBytes) {
        chunks.length = 0;
        stop(new ContractError("oversize"));
      } else chunks.push(chunk);
    });
    child.once("close", (code, nativeSignal) => {
      closed = true;
      clearTimeout(deadline);
      clearTimeout(killTimer);
      clearTimeout(unknownTimer);
      this.jobs.delete(key);
      if (pid) this.options.closed(pid);
      resolveSettlement();
      if (failed || code !== 0 || nativeSignal) {
        rejectResult(failed ?? new ContractError("unavailable"));
        return;
      }
      try {
        this.options.assertCurrent();
        const reply = decodeReply(
          parseWireJson(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
            LIMITS.pageBytes,
          ),
          decodeModelPreview,
        );
        if (reply.kind === "error") throw new ContractError(reply.error.code);
        resolveResult(reply.value);
      } catch (error) {
        rejectResult(
          error instanceof ContractError
            ? error
            : new ContractError("unavailable"),
        );
      }
    });
    try {
      if (pid) this.options.launched(pid);
    } catch {
      stop();
    }
    child.stdin?.end(body);
    return { result, settlement, stop: () => stop() };
  }
}
