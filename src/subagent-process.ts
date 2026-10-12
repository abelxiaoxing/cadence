import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { CheckDefinition, RunResult, TaskKind } from "./task-types.ts";
import { object } from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

export interface RequestAuth {
  ok: true;
  apiKey?: string;
  headers?: Record<string, string | null>;
  baseUrl?: string;
  env?: Record<string, string>;
}
export interface WorkerRequest {
  cwd: string;
  model: Record<string, unknown>;
  auth: RequestAuth;
  kind: TaskKind;
  prompt: string;
  instructions: string;
  thinkingLevel?: string;
}
export function safeChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // No ambient provider credentials, NODE_OPTIONS, session/control IDs or SDK discovery configuration.
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PATHEXT",
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return {
    ...env,
    CADENCE_SUBAGENT_CHILD: "1",
    PI_OFFLINE: "1",
    NO_COLOR: "1",
  };
}
export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  input?: string;
  env?: NodeJS.ProcessEnv;
  protocol?: boolean;
  secrets?: string[];
  onProgress?: (text: string) => void;
}
/** One bounded process owner for SDK workers and user-confirmed parent checks. */
export function runProcess(spec: ProcessSpec): Promise<RunResult> {
  const started = Date.now();
  const early = (outcome: RunResult["outcome"], text: string): RunResult => ({
    outcome,
    closed: true,
    exitCode: null,
    signal: null,
    durationMs: Date.now() - started,
    text,
    output: "",
    truncated: false,
  });
  if (spec.signal.aborted)
    return Promise.resolve(early("canceled", "Canceled before launch"));
  if (spec.input && Buffer.byteLength(spec.input) > 128 * 1024)
    return Promise.resolve(early("failed", "Worker input exceeds bound"));
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? safeChildEnv(),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let stopping: RunResult["outcome"] | undefined;
    let byteCount = 0;
    let truncated = false;
    let output = "";
    let pending = "";
    let final: string | undefined;
    let ready = false;
    let events = 0;
    const stdoutDecoder = new StringDecoder("utf8");
    const protocolDecoder = new TextDecoder("utf-8", { fatal: true });
    const stderrDecoder = new StringDecoder("utf8");
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let unknownTimer: ReturnType<typeof setTimeout> | undefined;
    const clean = (text: string, max = 65536) =>
      diagnosticText(text, max, spec.secrets);
    const finish = (
      closed: boolean,
      exitCode: number | null,
      signal: string | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(unknownTimer);
      spec.signal.removeEventListener("abort", abort);
      let outcome: RunResult["outcome"] = closed
        ? (stopping ?? (exitCode === 0 ? "completed" : "failed"))
        : "unknown";
      if (
        spec.protocol &&
        (!ready || final === undefined || pending.trim()) &&
        outcome === "completed"
      )
        outcome = "failed";
      resolve({
        outcome,
        closed,
        exitCode,
        signal,
        durationMs: Date.now() - started,
        text: clean(
          outcome === "completed" && spec.protocol
            ? (final ?? "")
            : `${outcome}${closed ? " (direct child closed; escaped descendants not proven stopped)" : ": stop unconfirmed; coordination lock retained"}`,
          16384,
        ),
        output: clean(output),
        truncated,
      });
      if (!closed) {
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
      }
    };
    const signalChild = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Wait for close; signal failure is never completion. */
      }
    };
    const stop = (outcome: RunResult["outcome"]) => {
      if (settled || stopping) return;
      stopping = outcome;
      signalChild("SIGTERM");
      killTimer = setTimeout(() => signalChild("SIGKILL"), 1000);
      unknownTimer = setTimeout(() => finish(false, null, null), 3000);
    };
    const abort = () => stop("canceled");
    const timeout = setTimeout(() => stop("timeout"), spec.timeoutMs);
    spec.signal.addEventListener("abort", abort, { once: true });
    if (spec.signal.aborted) abort();
    const frame = (line: string) => {
      try {
        const value: unknown = JSON.parse(line);
        if (!object(value) || ++events > 4096 || final !== undefined)
          throw new Error("Invalid frame");
        if (value.type === "ready" && !ready && events === 1) {
          ready = true;
          spec.onProgress?.("Agent ready");
        } else if (
          value.type === "tool" &&
          ready &&
          typeof value.name === "string" &&
          /^[a-z_]{1,32}$/.test(value.name)
        )
          spec.onProgress?.(clean(`Tool: ${value.name}`, 128));
        else if (
          value.type === "final" &&
          ready &&
          value.stopReason === "stop" &&
          typeof value.text === "string" &&
          Buffer.byteLength(value.text) <= 16384
        )
          final = value.text;
        else throw new Error("Invalid frame");
      } catch {
        stop("failed");
      }
    };
    const receive = (chunk: Buffer, stdout: boolean) => {
      if (settled || stopping) return;
      byteCount += chunk.length;
      if (byteCount > 256 * 1024) {
        truncated = true;
        stop("failed");
        return;
      }
      let text: string;
      try {
        text =
          stdout && spec.protocol
            ? protocolDecoder.decode(chunk, { stream: true })
            : (stdout ? stdoutDecoder : stderrDecoder).write(chunk);
      } catch {
        stop("failed");
        return;
      }
      // Buffer the bounded complete stream before redacting: split secrets/UTF-8 cannot leak through progress.
      if (!spec.protocol || !stdout) output += text;
      else {
        pending += text;
        if (Buffer.byteLength(pending) > 65536) {
          truncated = true;
          stop("failed");
          return;
        }
        let end = pending.indexOf("\n");
        while (end >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          frame(line);
          end = pending.indexOf("\n");
        }
      }
    };
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, false));
    child.on("error", () => {
      stopping = "failed";
    });
    child.on("close", (code, signal) => {
      if (!spec.protocol) output += stdoutDecoder.end();
      else {
        try {
          pending += protocolDecoder.decode();
        } catch {
          stopping ??= "failed";
        }
      }
      output += stderrDecoder.end();
      finish(true, code, signal);
    });
    child.stdin.on("error", () => stop("failed"));
    child.stdin.end(spec.input ?? "");
  });
}
export function runWorker(
  request: WorkerRequest,
  signal: AbortSignal,
  onProgress?: (text: string) => void,
  timeoutMs = 1_200_000,
): Promise<RunResult> {
  if (
    Object.keys(request.auth.env ?? {}).some((name) =>
      /(?:_FILE|_PATH|_CREDENTIALS)$/.test(name),
    )
  )
    return Promise.resolve({
      outcome: "failed",
      closed: true,
      exitCode: null,
      signal: null,
      durationMs: 0,
      text: "Unsupported ambient-file authentication; no worker launched. Resolve request credentials in the parent first.",
      output: "",
      truncated: false,
    });
  const secrets = [
    request.auth.apiKey ?? "",
    ...Object.values(request.auth.headers ?? {}).filter(
      (value): value is string => typeof value === "string",
    ),
    ...Object.values(request.auth.env ?? {}),
  ];
  return runProcess({
    command: process.execPath,
    args: [fileURLToPath(new URL("./sdk-worker.mjs", import.meta.url))],
    cwd: request.cwd,
    input: JSON.stringify(request),
    protocol: true,
    signal,
    timeoutMs,
    secrets,
    onProgress,
  });
}
export function runCheck(
  check: CheckDefinition,
  cwd: string,
  signal: AbortSignal,
): Promise<RunResult> {
  return runProcess({
    command:
      process.platform === "win32"
        ? (process.env.COMSPEC ?? "cmd.exe")
        : "/bin/sh",
    args:
      process.platform === "win32"
        ? ["/d", "/s", "/c", check.command]
        : ["-c", check.command],
    cwd,
    timeoutMs: check.timeoutMs,
    // Checks are explicitly approved host commands, not SDK workers. Preserve
    // the ordinary project environment; never inject resolved request auth.
    env: { ...process.env, CADENCE_SUBAGENT_CHILD: "1" },
    signal,
  });
}
/** Auth resolution is not cancellable on every host. Late resolution is discarded, never spawned. */
export function awaitWithAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () =>
      finish(new Error("Canceled while resolving request authentication"));
    const timer = setTimeout(
      () => finish(new Error("Authentication resolution timed out")),
      timeoutMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => finish(undefined, value),
      () => finish(new Error("Request authentication unavailable")),
    );
    if (signal.aborted) abort();
  });
}
