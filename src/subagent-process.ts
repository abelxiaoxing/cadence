import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { InputImage } from "./image-content.mjs";
import {
  networkSnapshot,
  safeChildEnv,
  sameNetwork,
  scopedNetwork,
  sdkNetworkEnvironment,
} from "./sdk-network.ts";

export { safeChildEnv } from "./sdk-network.ts";

import type { CheckRecording } from "./service/check-recording.ts";
import type { PreparedModelContext } from "./service/model-context.ts";
import type { CaptureReservation, CaptureSink } from "./service/ports.ts";
import type { CheckNativeSettlement } from "./service-contract.ts";
import type { CheckDefinition, RunResult, TaskKind } from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";
import { CaptureState, parseCaptureLine } from "./worker-capture.mjs";
import {
  type CaptureFrame,
  closed,
  decodeCaptureFrame,
  decodeRecordingLink,
  decodeStopCause,
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
  type RecordingLink,
  type StopCause,
  type WorkerCompletion,
  type WorkerPublicRequest,
} from "./worker-public.mjs";
import { WorkerRecording } from "./worker-recording.ts";
import {
  sanitizeData,
  sanitizeText,
  TextSanitizer,
} from "./worker-redaction.mjs";

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
export type ProcessObservation = {
  kind: "spawned" | "stop-requested" | "closed";
  at: number;
  reason?: string;
  stop?: StopCause;
};
export interface ProcessSpec {
  /** Synchronous in-memory observation only. Persistence belongs to the caller's
   * original settlement, never the signal/stop critical path. */
  onLifecycle?: (event: ProcessObservation) => void;
  stopTarget?: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  signal: AbortSignal;
  input?: string;
  /** Private fd 3 payload, never part of the bounded public stdin envelope. */
  imageInput?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  /** Service lease ownership, rechecked for EVERY TERM/KILL, including recorder failure. */
  maySignal?: () => boolean;
  /** Owner-only native check recording, mutually exclusive with SDK protocol. */
  checkRecording?: CheckRecording;
  onCheckNative?: (native: CheckNativeSettlement) => void;
  protocol?: boolean;
  childRunId?: string;
  expectedRequest?: WorkerPublicRequest;
  recording?: WorkerRecording;
  onNative?: (
    native: NativeSettlement,
    state: CaptureState | undefined,
  ) => void;
  secrets?: string[];
  /** Workflow results retain the existing 256 KiB bounded process output,
   * not the legacy 64 KiB presentation preview. Native output budgets stay fixed. */
  retainOutput?: boolean;
  onProgress?: (text: string) => void;
  /** Ordinary-chat capture, a live preview only; never a task recording receipt. */
  onFrame?: (frame: CaptureFrame) => void;
  onAuth?: () => Promise<RequestAuth>;
  onCoordinator?: (
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Never signalled by this runner: no timeout, cancellation or output-bound
   * stop. For an operation that must not be interrupted mid-update (the
   * fast-forward of a user's checkout); excess output is dropped, not fatal. */
  uninterruptible?: boolean;
}
/** One bounded process owner for SDK workers and user-confirmed parent checks. */
/** Windows has no process groups, and terminating CMD/a worker alone leaves
 * its children holding the stdio pipes, so the direct child never closes.
 * While Node holds the live child's handle its PID cannot be reused; terminate
 * exactly that tree, as the Pi SDK's killProcessTree does. */
function terminateWindowsTree(pid: number, fallback: () => void): void {
  const root = process.env.SystemRoot;
  const taskkill = spawn(
    root ? join(root, "System32", "taskkill.exe") : "taskkill.exe",
    ["/F", "/T", "/PID", String(pid)],
    { stdio: "ignore", windowsHide: true },
  );
  taskkill.once("error", fallback);
  taskkill.once("close", (code) => {
    if (code !== 0) fallback();
  });
}
/** Owner-installed observer of every launched worker/check process, so a
 * successor can find this owner's orphans after a crash. Evidence only. */
export interface ProcessObserver {
  launched(pid: number): void;
  closed(pid: number): void;
}
let processObserver: ProcessObserver | undefined;
export function observeProcesses(observer: ProcessObserver | undefined): void {
  processObserver = observer;
}
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
  if (spec.signal.aborted) {
    spec.onCheckNative?.({
      outcome: "canceled",
      closure: "not-launched",
      exitCode: null,
      signal: null,
      durationMs: 0,
      stdin: "not-required",
    });
    return Promise.resolve(early("canceled", "Canceled before launch"));
  }
  if (
    spec.checkRecording &&
    (spec.protocol ||
      spec.input !== undefined ||
      !spec.maySignal ||
      !spec.onCheckNative)
  )
    throw new Error("Invalid service check context");
  if (spec.input !== undefined && Buffer.byteLength(spec.input) > 128 * 1024)
    return Promise.resolve(early("failed", "Worker input exceeds bound"));
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? safeChildEnv(),
      detached: process.platform !== "win32",
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
      // No payload means EOF, not an empty write to an unused transport.
      // Explicit empty input still requests strict pipe delivery.
      stdio: [
        spec.input === undefined ? "ignore" : "pipe",
        "pipe",
        "pipe",
        // Image bytes use fd 3; coordinator IPC retains fd 4.
        ...(spec.imageInput !== undefined || spec.onCoordinator || spec.onAuth
          ? [
              spec.imageInput !== undefined
                ? ("pipe" as const)
                : ("ignore" as const),
            ]
          : []),
        ...(spec.onCoordinator || spec.onAuth ? ["ipc" as const] : []),
      ],
    }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    let settled = false;
    let nativeClosed = false;
    let launched = false;
    const observeLifecycle = (event: ProcessObservation) => {
      if (settled) return;
      try {
        spec.onLifecycle?.(event);
      } catch {
        stop("failed");
      }
    };
    child.once("spawn", () => {
      launched = true;
      if (child.pid)
        try {
          processObserver?.launched(child.pid);
        } catch {
          /* evidence only */
        }
      observeLifecycle({ kind: "spawned", at: Date.now() });
    });
    const ingressStop = new AbortController();
    let stopping: RunResult["outcome"] | undefined;
    let stopCause: StopCause | undefined;
    let truncated = false;
    let output = "";
    let pending = "";
    let final: string | undefined;
    let ready = false;
    let capture: CaptureState | undefined;
    let inputDelivered = spec.input === undefined;
    let imagesDelivered = spec.imageInput === undefined;
    let stdin: NativeSettlement["stdin"] =
      spec.input === undefined ? "not-required" : "failed";
    const stdoutDecoder = new StringDecoder("utf8");
    const protocolDecoder = new TextDecoder("utf-8", { fatal: true });
    const stderrDecoder = new StringDecoder("utf8");
    const stdoutSanitizer = new TextSanitizer(spec.secrets ?? []);
    const stderrSanitizer = new TextSanitizer(spec.secrets ?? []);
    let outputBytes = 0;
    const appendOutput = (text: string) => {
      const left = 256 * 1024 - outputBytes;
      const size = Buffer.byteLength(text);
      if (size > left) {
        truncated = true;
        text = Buffer.from(text).subarray(0, left).toString("utf8");
        if (text.endsWith("\uFFFD")) text = text.slice(0, -1);
      }
      output += text;
      outputBytes += Buffer.byteLength(text);
    };
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
      ingressStop.abort();
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(unknownTimer);
      spec.signal.removeEventListener("abort", abort);
      let outcome: RunResult["outcome"] = closed
        ? (stopping ?? (exitCode === 0 ? "completed" : "failed"))
        : "unknown";
      if (
        spec.protocol &&
        (!ready ||
          final === undefined ||
          pending.length ||
          (spec.input !== undefined && stdin !== "delivered") ||
          !imagesDelivered) &&
        outcome === "completed"
      )
        outcome = "failed";
      if (outcome !== "completed")
        stopCause ??= {
          source: closed
            ? spec.onCoordinator
              ? "coordinator"
              : "worker"
            : "unknown",
          reason: closed
            ? "native-or-protocol-failure"
            : "unconfirmed-settlement",
          target: spec.stopTarget ?? spec.childRunId ?? "process",
        };
      spec.onCheckNative?.({
        ...(stopCause ? { stop: stopCause } : {}),
        outcome,
        closure: closed
          ? launched
            ? "direct-child-closed"
            : "not-launched"
          : "unconfirmed",
        exitCode: launched ? exitCode : null,
        signal: launched ? signal : null,
        durationMs: Date.now() - started,
        stdin: "not-required",
      });
      spec.onNative?.(
        {
          ...(stopCause ? { stop: stopCause } : {}),
          outcome,
          closure: closed ? "direct-child-closed" : "unconfirmed",
          exitCode,
          signal,
          durationMs: Date.now() - started,
          stdin,
          final: capture?.selected ? "valid" : "missing",
          // A nonzero close may be a provider/protocol failure despite clean
          // SDK teardown. Do not invent a particular cleanup failure from it.
          cleanup: closed && exitCode === 0 ? "settled" : "unconfirmed",
          capture: capture?.coverage ?? {
            observed: "incomplete",
            source: "unavailable",
            redacted: false,
            omissions: ["gap"],
          },
        },
        capture,
      );
      // Sanitize complete bounded text before clipping, including secrets that
      // straddle the presentation limit. Flag clipping independently of native
      // failure: exit zero and omitted diagnostic bytes can coexist.
      const safeText = clean(
        outcome === "completed" && spec.protocol
          ? (final ?? "")
          : `${outcome === "timeout" ? `timeout: explicit command deadline ${spec.timeoutMs}ms reached` : outcome}${closed ? "; direct child closed; descendant closure was not verified (not evidence of a surviving process)" : "; stop unconfirmed; coordination lock retained"}`,
        Number.MAX_SAFE_INTEGER,
      );
      const safeOutput = clean(output, Number.MAX_SAFE_INTEGER);
      const outputBytes = spec.retainOutput ? 256 * 1024 : 65536;
      resolve({
        ...(stopCause ? { stop: stopCause } : {}),
        outcome,
        closed,
        exitCode,
        signal,
        durationMs: Date.now() - started,
        text: diagnosticText(safeText, 16384),
        output: diagnosticText(safeOutput, outputBytes),
        truncated:
          truncated ||
          Buffer.byteLength(safeText) > 16384 ||
          Buffer.byteLength(safeOutput) > outputBytes,
      });
      if (!closed) {
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin?.destroy();
        if (child.connected) child.disconnect();
      }
    };
    const signalChild = (signal: NodeJS.Signals) => {
      try {
        if (spec.maySignal && !spec.maySignal()) return;
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else if (
          child.pid &&
          child.exitCode === null &&
          child.signalCode === null
        )
          terminateWindowsTree(child.pid, () => child.kill(signal));
        else child.kill(signal);
      } catch {
        /* Wait for close; signal failure is never completion. */
      }
    };
    const stop = (outcome: RunResult["outcome"]) => {
      // An uninterruptible child is observed to its own close, never signalled.
      if (settled || stopping || spec.uninterruptible) return;
      stopping = outcome;
      if (outcome === "canceled") {
        try {
          stopCause = decodeStopCause(spec.signal.reason);
        } catch {
          /* no inferred user intent */
        }
      }
      stopCause ??= {
        source:
          outcome === "timeout"
            ? "command"
            : outcome === "canceled"
              ? "unknown"
              : spec.onCoordinator
                ? "coordinator"
                : "worker",
        reason:
          outcome === "timeout"
            ? "explicit-timeout"
            : outcome === "canceled"
              ? "unattributed-abort"
              : "capture-or-process-failure",
        target: spec.stopTarget ?? spec.childRunId ?? "process",
      };
      const requestedAt = Date.now();
      // Signal first, including before coordinator interruption/observation.
      // Decoder/recorder waiting after native close is not a live PID.
      if (!nativeClosed) {
        signalChild("SIGTERM");
        killTimer = setTimeout(() => signalChild("SIGKILL"), 1000);
        unknownTimer = setTimeout(() => finish(false, null, null), 3000);
      }
      observeLifecycle({
        kind: "stop-requested",
        at: requestedAt,
        reason: `${stopCause.source}: ${stopCause.reason} (${stopCause.target})`,
        stop: stopCause,
      });
      ingressStop.abort();
    };
    const authOriginals = new Set<Promise<void>>();
    if (spec.onAuth)
      child.on("message", (message) => {
        if (
          !message ||
          typeof message !== "object" ||
          (message as { kind?: string }).kind !== "auth"
        )
          return;
        if (settled || stopping) return;
        let row: { id: number };
        try {
          row = closed(message, ["kind", "id"]) as { id: number };
        } catch {
          stop("failed");
          return;
        }
        if (!Number.isSafeInteger(row.id) || row.id < 1 || authOriginals.size) {
          stop("failed");
          return;
        }
        const original = (async () => {
          try {
            const auth = await spec.onAuth?.();
            if (
              !auth ||
              Buffer.byteLength(JSON.stringify(auth)) >
                LIMITS.workerRequestBytes
            )
              throw new Error("Invalid auth reply");
            for (const value of [
              auth.apiKey,
              ...Object.values(auth.headers ?? {}),
              ...Object.values(auth.env ?? {}),
            ])
              if (
                typeof value === "string" &&
                value &&
                !spec.secrets?.includes(value)
              )
                spec.secrets?.push(value);
            if (!settled && !stopping && child.connected)
              child.send(
                { kind: "auth", id: row.id, ok: true, auth },
                () => {},
              );
          } catch {
            if (!settled && !stopping && child.connected)
              child.send({ kind: "auth", id: row.id, ok: false }, () => {});
          }
        })().catch(() => {
          stop("failed");
        });
        authOriginals.add(original);
        void original.then(() => authOriginals.delete(original));
      });
    let bridgeBusy = false;
    if (spec.onCoordinator)
      child.on("message", (message) => {
        if (
          message &&
          typeof message === "object" &&
          (message as { kind?: string }).kind === "auth"
        )
          return;
        if (settled || stopping) return;
        void (async () => {
          // Only a frame without a usable call ID is a broken channel. Any
          // other refusal answers that one call; the coordinator keeps running.
          let row: Record<string, unknown>;
          try {
            row = closed(message, ["id", "name", "args"]);
            if (
              !Number.isSafeInteger(row.id) ||
              (row.id as number) < 1 ||
              typeof row.name !== "string"
            )
              throw new Error("Invalid coordinator frame");
          } catch {
            stop("failed");
            return;
          }
          const id = row.id as number;
          const refuse = () => {
            if (child.connected && !settled && !stopping)
              child.send({ id, ok: false }, () => {});
          };
          if (
            bridgeBusy ||
            Buffer.byteLength(JSON.stringify(message)) > 65536
          ) {
            refuse();
            return;
          }
          bridgeBusy = true;
          try {
            const secrets = spec.secrets ?? [];
            const name = row.name as string;
            if (sanitizeText(name, secrets) !== name)
              throw new Error("Invalid coordinator call");
            // Credential-looking text is redacted, never forwarded verbatim
            // and never a reason to stop the coordinator.
            const args =
              row.args === undefined
                ? undefined
                : JSON.parse(sanitizeData(row.args, secrets));
            const value = await spec.onCoordinator?.(
              name,
              args,
              ingressStop.signal,
            );
            const text = sanitizeText(JSON.stringify(value), secrets);
            const reply = { id, ok: true, text };
            if (Buffer.byteLength(JSON.stringify(reply)) > 65536)
              throw new Error("Coordinator result exceeds bound");
            if (!settled && !stopping && child.connected)
              child.send(reply, () => {});
          } catch {
            refuse();
          } finally {
            bridgeBusy = false;
          }
        })();
      });
    const abort = () => stop("canceled");
    const timeout =
      spec.uninterruptible || spec.timeoutMs === undefined
        ? undefined
        : setTimeout(() => stop("timeout"), spec.timeoutMs);
    if (!spec.uninterruptible) {
      spec.signal.addEventListener("abort", abort, { once: true });
      if (spec.signal.aborted) abort();
    }
    const frame = (line: string) => {
      let lease: CaptureReservation | undefined;
      try {
        lease = spec.recording?.reserveRaw(Buffer.byteLength(line));
        const value = parseCaptureLine(line);
        if (!capture)
          capture = new CaptureState(
            spec.childRunId ?? decodeCaptureFrame(value).childRunId,
            spec.expectedRequest,
          );
        const decoded = capture.accept(value, Buffer.byteLength(line) + 1);
        spec.onFrame?.(decoded);
        if (decoded.event.kind === "ready") {
          ready = true;
          spec.onProgress?.("Agent ready");
        }
        if (decoded.event.kind === "tool-start")
          spec.onProgress?.(clean(`Tool: ${decoded.event.name}`, 128));
        if (decoded.event.kind === "final") final = capture.preview;
        if (lease) {
          spec.recording?.accept(decoded, lease);
          lease = undefined;
        }
      } catch {
        lease?.release();
        stop("failed");
      }
    };
    const receive = async (chunk: Buffer, stdout: boolean) => {
      if (settled || stopping) return;
      if (spec.checkRecording) {
        await spec.checkRecording.receive(chunk, stdout ? "stdout" : "stderr");
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
      if (!spec.protocol || !stdout) {
        appendOutput((stdout ? stdoutSanitizer : stderrSanitizer).write(text));
      } else {
        pending += text;
        let end = pending.indexOf("\n");
        while (end >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (Buffer.byteLength(line) >= LIMITS.frameBytes) {
            truncated = true;
            stop("failed");
            break;
          }
          if (spec.recording) await spec.recording.writable(ingressStop.signal);
          if (settled || stopping) break;
          frame(line);
          if (settled || stopping) break;
          end = pending.indexOf("\n");
        }
        if (Buffer.byteLength(pending) > LIMITS.frameBytes) {
          truncated = true;
          stop("failed");
        }
      }
    };
    let stdoutWork = Promise.resolve();
    let stderrWork = Promise.resolve();
    let stdoutEnded = false,
      stderrEnded = false;
    if (spec.checkRecording) {
      child.stdout.once("end", () => {
        stdoutEnded = true;
      });
      child.stderr.once("end", () => {
        stderrEnded = true;
      });
      child.stdout.on("error", () => stop("failed"));
      child.stderr.on("error", () => stop("failed"));
    }
    child.stdout.on("data", (chunk: Buffer) => {
      if (!spec.recording && !spec.checkRecording) {
        void receive(chunk, true).catch(() => stop("failed"));
        return;
      }
      // One bounded native read at a time. pause() leaves further bytes in the
      // pipe/Readable rather than copying an uncharged promise queue.
      child.stdout.pause();
      const original = receive(chunk, true)
        .catch(() => stop("failed"))
        .finally(() => {
          if (!settled && stdoutWork === original) child.stdout.resume();
        });
      stdoutWork = original;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!spec.checkRecording) {
        void receive(chunk, false).catch(() => stop("failed"));
        return;
      }
      child.stderr.pause();
      const original = receive(chunk, false)
        .catch(() => stop("failed"))
        .finally(() => {
          if (!settled && stderrWork === original) child.stderr.resume();
        });
      stderrWork = original;
    });
    child.on("error", () => {
      stopping = "failed";
    });
    child.on("close", (code, signal) => {
      nativeClosed = true;
      if (launched && child.pid)
        try {
          processObserver?.closed(child.pid);
        } catch {
          /* evidence only */
        }
      if (launched) observeLifecycle({ kind: "closed", at: Date.now() });
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(unknownTimer);
      // Native close can race the final paused read's continuation. Never use
      // exit/EOF or a still-pending decoder as a substitute for either fact.
      const close = () => {
        if (!spec.protocol) {
          appendOutput(stdoutSanitizer.write(stdoutDecoder.end()));
          appendOutput(stdoutSanitizer.end());
        } else {
          try {
            pending += protocolDecoder.decode();
          } catch {
            stopping ??= "failed";
          }
        }
        appendOutput(stderrSanitizer.write(stderrDecoder.end()));
        appendOutput(stderrSanitizer.end());
        finish(true, code, signal);
      };
      if (spec.checkRecording) {
        void Promise.all([stdoutWork, stderrWork]).then(async () => {
          // Both original stream continuations and final prefix flushing precede
          // native completion. Capture failure never erases the actual exit code.
          try {
            await spec.checkRecording?.end(
              !settled && !stopping && stdoutEnded && stderrEnded,
            );
          } catch {
            /* Recording disposition is separate from native exit/close. */
          }
          close();
        });
      } else if (spec.recording || authOriginals.size)
        void Promise.all([stdoutWork, ...authOriginals]).then(close);
      else close();
    });
    if (spec.imageInput !== undefined) {
      const pipe = child.stdio[3] as Writable;
      pipe.on("error", () => {
        stdin = "failed";
        stop("failed");
      });
      pipe.once("finish", () => {
        imagesDelivered = true;
        if (inputDelivered) stdin = "delivered";
      });
      pipe.end(spec.imageInput);
    }
    if (child.stdin) {
      child.stdin.on("error", () => {
        stdin = "failed";
        stop("failed");
      });
      child.stdin.once("finish", () => {
        inputDelivered = true;
        if (imagesDelivered) stdin = "delivered";
      });
      try {
        child.stdin.end(spec.input);
      } catch {
        stdin = "failed";
        stop("failed");
      }
    }
  });
}
/** Temporary W5 compatibility: bounded presentation ONLY, over the same v2
 * runner. These synthetic routing IDs are not durable service/history IDs. */
export function legacyWorkerEnvelope(request: WorkerRequest) {
  const purpose = request.kind === "code" ? "edit" : request.kind;
  const publicRequest = decodeWorkerPublicRequest({
    protocol: 2,
    taskId: randomUUID(),
    taskKind: request.kind,
    runId: randomUUID(),
    childRunId: randomUUID(),
    assignmentId: "legacy",
    purpose,
    model: {
      sourceSelectionId: randomUUID(),
      provider: request.model.provider,
      model: request.model.id,
      api: request.model.api,
      thinking: request.thinkingLevel ?? "off",
    },
    role: {
      role:
        purpose === "edit"
          ? "implementation-worker"
          : purpose === "diagnosis"
            ? "diagnosis-worker"
            : "design-explorer",
      sha256: createHash("sha256").update(request.instructions).digest("hex"),
    },
    context: "",
    instructions: request.instructions,
    prompt: request.prompt,
    handoff: { graphRevision: 1, inputs: [] },
  });
  // Private model shape is selected/validated by the existing native SDK route;
  // no public history DTO or credential cast is introduced here.
  return {
    request: publicRequest,
    cwd: request.cwd,
    model: request.model,
    auth: request.auth,
  };
}
type Envelope = ReturnType<typeof legacyWorkerEnvelope>;
class AmbientFileAuth extends Error {}
function encodeEnvelope(
  material: Envelope & { ownerAuth?: true },
  captured?: {
    ambient: ReturnType<typeof networkSnapshot>;
    scoped: ReturnType<typeof scopedNetwork>;
  },
  roots: string[] = [material.cwd],
) {
  const ambient = captured?.ambient ?? networkSnapshot(process.env);
  const scoped = captured?.scoped ?? scopedNetwork(material);
  if (
    Object.keys(material.auth.env ?? {}).some((name) =>
      /(?:_FILE|_PATH|_CREDENTIALS)$/.test(name),
    )
  )
    throw new AmbientFileAuth();
  const selected = sdkNetworkEnvironment(ambient, scoped);
  const literals = (source: object) =>
    Object.values(Object.getOwnPropertyDescriptors(source)).flatMap(
      (descriptor) =>
        "value" in descriptor && typeof descriptor.value === "string"
          ? [descriptor.value]
          : [],
    );
  const secrets = [
    material.auth.apiKey ?? "",
    ...literals(material.auth.headers ?? {}),
    ...literals(material.auth.env ?? {}),
    ...selected.redactionLiterals,
  ];
  const investigation = { roots };
  const input = JSON.stringify({ ...material, investigation });
  if (!sameNetwork(scoped, scopedNetwork(JSON.parse(input)), false))
    throw new Error("network");
  return { material, investigation, ambient, scoped, selected, secrets, input };
}
function launchEncoded(
  encoded: ReturnType<typeof encodeEnvelope>,
  signal: AbortSignal,
  extra: Pick<
    ProcessSpec,
    | "onLifecycle"
    | "onProgress"
    | "recording"
    | "onNative"
    | "maySignal"
    | "onFrame"
    | "onCoordinator"
    | "onAuth"
    | "imageInput"
    | "secrets"
  > = {},
): Promise<RunResult> {
  if (
    !sameNetwork(encoded.ambient, networkSnapshot(process.env)) ||
    !sameNetwork(encoded.scoped, scopedNetwork(encoded.material))
  )
    throw new Error("network");
  // One native launcher, no intervening await/recapture after freshness.
  return runProcess({
    command: process.execPath,
    args: [fileURLToPath(new URL("./sdk-worker.mjs", import.meta.url))],
    cwd: encoded.material.cwd,
    input: encoded.input,
    env: encoded.selected.env,
    protocol: true,
    childRunId: encoded.material.request.childRunId,
    expectedRequest: encoded.material.request,
    signal,
    secrets: encoded.secrets,
    ...extra,
  });
}
export function runWorker(
  request: WorkerRequest,
  signal: AbortSignal,
  onProgress?: (text: string) => void,
): Promise<RunResult> {
  const noSpawn = (outcome: RunResult["outcome"], text: string) =>
    Promise.resolve<RunResult>({
      outcome,
      closed: true,
      exitCode: null,
      signal: null,
      durationMs: 0,
      text,
      output: "",
      truncated: false,
    });
  if (signal.aborted) return noSpawn("canceled", "Canceled before launch");
  try {
    const ambient = networkSnapshot(process.env);
    const scoped = scopedNetwork(request);
    const encoded = encodeEnvelope(legacyWorkerEnvelope(request), {
      ambient,
      scoped,
    });
    if (!sameNetwork(scoped, scopedNetwork(request)))
      throw new Error("network");
    return launchEncoded(encoded, signal, { onProgress });
  } catch (error) {
    return noSpawn(
      "failed",
      error instanceof AmbientFileAuth
        ? "Unsupported ambient-file authentication; no worker launched. Resolve request credentials in the parent first."
        : "unsupportedNetwork: SDK proxy configuration or runtime capability is unsupported; no worker launched.",
    );
  }
}
/** W1 opaque one-use consumption + W3 mandatory sink. W4 must durably account
 * launch intent BEFORE calling this and original completion AFTER it resolves.
 * No accepting default sink, fabricated ContentRef or own settlement wait. */
export function preparedWorker(
  prepared: PreparedModelContext,
  request: WorkerPublicRequest,
  link: RecordingLink,
  ownerSecrets: readonly string[],
  maySignal?: () => boolean,
) {
  const expected = decodeWorkerPublicRequest(request);
  link = decodeRecordingLink(link);
  if (
    expected.childRunId !== link.childRunId ||
    expected.runId !== link.runId ||
    expected.taskId !== link.taskId
  )
    throw new Error("Invalid recording identity");
  return {
    request: expected,
    async launch(
      signal: AbortSignal,
      sink: CaptureSink,
    ): Promise<WorkerCompletion> {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      let native: NativeSettlement = {
        outcome: signal.aborted ? "canceled" : "failed",
        closure: "not-launched",
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdin: "not-required",
        final: "missing",
        cleanup: "settled",
        capture: {
          observed: "incomplete",
          source: "unavailable",
          redacted: false,
          omissions: ["gap"],
        },
      };
      let state: CaptureState | undefined;
      let recorder: WorkerRecording | undefined;
      try {
        if (!sink || typeof sink.reserve !== "function")
          throw new Error("Recording required");
        if (!controller.signal.aborted) {
          let encoded: ReturnType<typeof encodeEnvelope> | undefined;
          await prepared.consume(
            (material) => {
              if (JSON.stringify(material.request) !== JSON.stringify(expected))
                throw new Error("Prepared request changed");
              encoded = encodeEnvelope({
                ...material,
                ownerAuth: true,
                model: { ...material.model },
              });
              // All sink callbacks/reservations precede W1's final source,
              // size and cancellation recheck. The use callback only launches.
              recorder = new WorkerRecording(
                link,
                sink,
                [...ownerSecrets, ...encoded.secrets],
                abort,
              );
              return encoded.input;
            },
            (input) => {
              if (
                !encoded ||
                encoded.input !== input ||
                controller.signal.aborted
              )
                throw new Error("Prepared request unavailable");
              return launchEncoded(encoded, controller.signal, {
                recording: recorder,
                onAuth: () => prepared.refreshAuth(),
                maySignal,
                onNative: (facts, observed) => {
                  native = facts;
                  state = observed;
                },
              });
            },
          );
        }
        await recorder?.drain();
      } catch {
        /* Fixed no-launch/recording uncertainty, never raw auth errors. */
      } finally {
        recorder?.closeIngress();
        signal.removeEventListener("abort", abort);
      }
      const selected = state?.selected ?? null;
      return {
        childRunId: expected.childRunId,
        native,
        selected,
        recording: (native.closure !== "not-launched"
          ? recorder?.result(selected)
          : undefined) ?? {
          status: "refused",
          selected,
          error: { code: "unavailable", effect: "none", recovery: "operator" },
        },
      };
    },
  };
}
/** The Pi session a browser turn continues: `file` is null until Pi has
 * written it, and `head` is the entry the message follows (null: a new root). */
export interface ConversationSession {
  id: string;
  dir: string;
  file: string | null;
  head: string | null;
}
/** Same isolated native launcher, auth projection and closure rules as tasks.
 * The caller durably accepts a chat turn before this one-use launch. The
 * worker's Pi session writes the turn; nothing returns through a side channel. */
export function launchConversation(
  prepared: PreparedModelContext,
  conversation: {
    session: ConversationSession;
    agentDir: string;
    coordinator?: true;
  },
  signal: AbortSignal,
  options: {
    maySignal(): boolean;
    onNative(native: NativeSettlement): void;
    onFrame(frame: CaptureFrame, secrets: readonly string[]): void;
    images?: InputImage[];
    ownerSecrets(): readonly string[];
    onCoordinator?: ProcessSpec["onCoordinator"];
  },
): Promise<RunResult> {
  let encoded: ReturnType<typeof encodeEnvelope> | undefined;
  const imageInput = options.images?.length
    ? JSON.stringify(options.images)
    : undefined;
  const imageDescriptor =
    imageInput === undefined
      ? undefined
      : {
          bytes: Buffer.byteLength(imageInput),
          sha256: createHash("sha256").update(imageInput).digest("hex"),
        };
  return prepared.consume(
    (material) => {
      encoded = encodeEnvelope({
        ...material,
        ownerAuth: true,
        model: { ...material.model },
      });
      encoded.input = JSON.stringify({
        ...encoded.material,
        investigation: encoded.investigation,
        conversation: {
          ...conversation,
          ...(imageDescriptor ? { images: imageDescriptor } : {}),
        },
      });
      return encoded.input;
    },
    (input) => {
      if (!encoded || encoded.input !== input)
        throw new Error("Invalid chat launch");
      const secrets = encoded.secrets;
      return launchEncoded(encoded, signal, {
        onAuth: () => prepared.refreshAuth(),
        maySignal: options.maySignal,
        onNative: options.onNative,
        onCoordinator: options.onCoordinator,
        imageInput,
        onFrame: (frame) => options.onFrame(frame, secrets),
      });
    },
  );
}

/** One existing Pi session and the name to record in it. */
export interface SessionRename {
  id: string;
  dir: string;
  file: string;
  /** The session's own directory, from its header. */
  cwd: string;
  name: string;
}
/** How long a rename child may take: it loads the SDK, lets Pi read the whole
 * session and appends one line. */
export const SESSION_RENAME_MS = 60_000;
/** A fixed-purpose child that appends one `session_info` entry through Pi's
 * `SessionManager`, as the terminal's `/name` does: no model, credentials,
 * tools or capture protocol. The caller holds the owner lease and confirms the
 * name by reading the session back; exit zero alone is not that evidence. */
export function renameSession(
  target: SessionRename,
  signal: AbortSignal,
  maySignal: () => boolean,
): Promise<RunResult> {
  return runProcess({
    command: process.execPath,
    args: [fileURLToPath(new URL("./session-rename.mjs", import.meta.url))],
    cwd: target.dir,
    // Exactly the five fields the child accepts.
    input: JSON.stringify({
      id: target.id,
      dir: target.dir,
      file: target.file,
      cwd: target.cwd,
      name: target.name,
    }),
    timeoutMs: SESSION_RENAME_MS,
    signal,
    maySignal,
  });
}

/** Owner-admitted workflow worker. The owner validates/retains the selected
 * worktree and journals launch before calling; model/auth still come from W1. */
export function launchWorkflowWorker(
  prepared: PreparedModelContext,
  cwd: string,
  signal: AbortSignal,
  options: {
    roots?: string[];
    onLifecycle?: ProcessSpec["onLifecycle"];
    ownerSecrets: readonly string[];
    maySignal(): boolean;
    onNative(native: NativeSettlement, selectedMessageId?: string): void;
    onFrame(frame: CaptureFrame, secrets: readonly string[]): void;
  },
): Promise<RunResult> {
  let encoded: ReturnType<typeof encodeEnvelope> | undefined;
  return prepared.consume(
    (material) => {
      encoded = encodeEnvelope(
        {
          ...material,
          ownerAuth: true,
          cwd,
          model: { ...material.model },
        },
        undefined,
        options.roots ?? [cwd],
      );
      return encoded.input;
    },
    (input) => {
      if (!encoded || encoded.input !== input)
        throw new Error("Invalid workflow launch");
      const secrets = [...encoded.secrets, ...options.ownerSecrets];
      return launchEncoded(encoded, signal, {
        secrets,
        onAuth: () => prepared.refreshAuth(),
        maySignal: options.maySignal,
        onLifecycle: options.onLifecycle,
        onNative: (native, capture) =>
          options.onNative(native, capture?.selected?.messageId),
        onFrame: (frame) => options.onFrame(frame, secrets),
      });
    },
  );
}

export interface ServiceCheckContext {
  environment: Readonly<NodeJS.ProcessEnv>;
  recording: CheckRecording;
  maySignal(): boolean;
  onNative(native: CheckNativeSettlement): void;
}
export function runCheck(
  check: CheckDefinition,
  cwd: string,
  signal: AbortSignal,
  service?: ServiceCheckContext,
): Promise<RunResult> {
  return runProcess({
    command:
      process.platform === "win32"
        ? ((service?.environment ?? process.env).COMSPEC ?? "cmd.exe")
        : "/bin/sh",
    args:
      process.platform === "win32"
        ? // Match Node's CMD shell construction: CMD strips the outer quotes;
          // CRT argument escaping would otherwise corrupt quoted executables.
          ["/d", "/s", "/c", `"${check.command}"`]
        : ["-c", check.command],
    windowsVerbatimArguments: process.platform === "win32" ? true : undefined,
    cwd,
    timeoutMs: check.timeoutMs,
    // Checks are explicitly approved host commands, not SDK workers. Preserve
    // the ordinary project environment; never inject resolved request auth.
    env: {
      ...(service?.environment ?? process.env),
      CADENCE_SUBAGENT_CHILD: "1",
    },
    ...(service
      ? {
          checkRecording: service.recording,
          maySignal: service.maySignal,
          onCheckNative: service.onNative,
        }
      : {}),
    signal,
  });
}
