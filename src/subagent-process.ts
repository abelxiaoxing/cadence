import { type ChildProcessByStdio, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import {
  CONTEXT_BYTES,
  conversationMessages,
} from "./conversation-context.mjs";
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
  decodeWorkerPublicRequest,
  LIMITS,
  type NativeSettlement,
  parseWireJson,
  type RecordingLink,
  type WorkerCompletion,
  type WorkerPublicRequest,
} from "./worker-public.mjs";
import { WorkerRecording } from "./worker-recording.ts";
import { sanitizeText } from "./worker-redaction.mjs";

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
export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  input?: string;
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
  onProgress?: (text: string) => void;
  /** Ordinary-chat capture, separately persisted; never a task recording receipt. */
  onFrame?: (frame: CaptureFrame) => void;
  /** Bounded anonymous checkpoint pipe, never a raw spill file. */
  onContext?: (source: string) => void;
  onCoordinator?: (
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
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
        ...(spec.onContext || spec.onCoordinator
          ? [spec.onContext ? ("pipe" as const) : ("ignore" as const)]
          : []),
        ...(spec.onCoordinator ? ["ipc" as const] : []),
      ],
    }) as ChildProcessByStdio<Writable | null, Readable, Readable>;
    const contextStream = spec.onContext
      ? (child.stdio[3] as Readable | null)
      : null;
    let contextEnded = false,
      contextBytes = 0;
    const contextChunks: Buffer[] = [];
    let settled = false;
    let nativeClosed = false;
    let launched = false;
    child.once("spawn", () => {
      launched = true;
    });
    const ingressStop = new AbortController();
    let stopping: RunResult["outcome"] | undefined;
    let byteCount = 0;
    let truncated = false;
    let output = "";
    let pending = "";
    let final: string | undefined;
    let ready = false;
    let capture: CaptureState | undefined;
    let stdin: NativeSettlement["stdin"] =
      spec.input === undefined ? "not-required" : "failed";
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
          (spec.input !== undefined && stdin !== "delivered")) &&
        outcome === "completed"
      )
        outcome = "failed";
      spec.onCheckNative?.({
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
        child.stdin?.destroy();
        contextStream?.destroy();
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
      if (settled || stopping) return;
      stopping = outcome;
      ingressStop.abort();
      if (nativeClosed) return; // Decoder/recorder waiting is not a live PID.
      signalChild("SIGTERM");
      killTimer = setTimeout(() => signalChild("SIGKILL"), 1000);
      unknownTimer = setTimeout(() => finish(false, null, null), 3000);
    };
    let bridgeCalls = 0;
    let bridgeBusy = false;
    if (spec.onCoordinator)
      child.on("message", (message) => {
        if (settled || stopping) return;
        void (async () => {
          let id: number | undefined;
          try {
            const body = JSON.stringify(message);
            if (
              ++bridgeCalls > 16 ||
              bridgeBusy ||
              Buffer.byteLength(body) > 65536 ||
              sanitizeText(body, spec.secrets ?? []) !== body
            )
              throw new Error("Invalid coordinator frame");
            const row = closed(message, ["id", "name", "args"]);
            if (
              !Number.isSafeInteger(row.id) ||
              (row.id as number) < 1 ||
              typeof row.name !== "string"
            )
              throw new Error("Invalid coordinator frame");
            id = row.id as number;
            bridgeBusy = true;
            const value = await spec.onCoordinator?.(
              row.name,
              row.args,
              ingressStop.signal,
            );
            const text = sanitizeText(
              JSON.stringify(value),
              spec.secrets ?? [],
            );
            const reply = { id, ok: true, text };
            if (Buffer.byteLength(JSON.stringify(reply)) > 65536)
              throw new Error("Coordinator result exceeds bound");
            if (!settled && !stopping && child.connected)
              child.send(reply, () => {});
          } catch {
            if (id !== undefined && child.connected && !settled && !stopping)
              child.send({ id, ok: false }, () => {});
            else stop("failed");
          } finally {
            bridgeBusy = false;
          }
        })();
      });
    const abort = () => stop("canceled");
    const timeout = setTimeout(() => stop("timeout"), spec.timeoutMs);
    spec.signal.addEventListener("abort", abort, { once: true });
    if (spec.signal.aborted) abort();
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
      byteCount += chunk.length;
      if (
        byteCount > (spec.protocol ? LIMITS.childProtocolBytes : 256 * 1024)
      ) {
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
      if (!spec.protocol || !stdout) {
        output += text;
        if (Buffer.byteLength(output) > 256 * 1024) {
          truncated = true;
          stop("failed");
        }
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
    contextStream?.on("data", (chunk: Buffer) => {
      if (settled || stopping) return;
      contextBytes += chunk.length;
      if (contextBytes > CONTEXT_BYTES) {
        stop("failed");
        return;
      }
      contextChunks.push(chunk);
    });
    contextStream?.once("end", () => {
      contextEnded = true;
    });
    contextStream?.on("error", () => stop("failed"));
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
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(unknownTimer);
      // Native close can race the final paused read's continuation. Never use
      // exit/EOF or a still-pending decoder as a substitute for either fact.
      const close = () => {
        if (spec.onContext && !stopping && code === 0) {
          try {
            if (!contextEnded) throw new Error("Context EOF missing");
            spec.onContext(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(contextChunks),
              ),
            );
          } catch {
            stopping = "failed";
          }
        }
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
      } else if (spec.recording) void stdoutWork.then(close);
      else close();
    });
    if (child.stdin) {
      child.stdin.on("error", () => {
        stdin = "failed";
        stop("failed");
      });
      child.stdin.once("finish", () => {
        stdin = "delivered";
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
  material: Envelope,
  captured?: {
    ambient: ReturnType<typeof networkSnapshot>;
    scoped: ReturnType<typeof scopedNetwork>;
  },
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
  const input = JSON.stringify(material);
  if (!sameNetwork(scoped, scopedNetwork(JSON.parse(input)), false))
    throw new Error("network");
  return { material, ambient, scoped, selected, secrets, input };
}
function launchEncoded(
  encoded: ReturnType<typeof encodeEnvelope>,
  signal: AbortSignal,
  timeoutMs: number,
  extra: Pick<
    ProcessSpec,
    | "onProgress"
    | "recording"
    | "onNative"
    | "maySignal"
    | "onFrame"
    | "onContext"
    | "onCoordinator"
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
    timeoutMs,
    secrets: encoded.secrets,
    ...extra,
  });
}
export function runWorker(
  request: WorkerRequest,
  signal: AbortSignal,
  onProgress?: (text: string) => void,
  timeoutMs: number = LIMITS.workerMs,
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
    return launchEncoded(encoded, signal, timeoutMs, { onProgress });
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
  timeoutMs: number = LIMITS.workerMs,
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
      const abort = () => controller.abort();
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
              return launchEncoded(encoded, controller.signal, timeoutMs, {
                recording: recorder,
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
/** Same isolated native launcher, auth projection and closure rules as tasks.
 * The caller durably accepts a chat turn before this one-use launch. */
export function launchConversation(
  prepared: PreparedModelContext,
  conversation: {
    previous: string | null;
    agentDir: string;
    coordinator?: true;
  },
  signal: AbortSignal,
  options: {
    timeoutMs: number;
    maySignal(): boolean;
    onNative(native: NativeSettlement): void;
    onFrame(frame: CaptureFrame, secrets: readonly string[]): void;
    ownerSecrets(): readonly string[];
    onContext(messages: unknown[]): void;
    onCoordinator?: ProcessSpec["onCoordinator"];
  },
): Promise<RunResult> {
  let encoded: ReturnType<typeof encodeEnvelope> | undefined;
  return prepared.consume(
    (material) => {
      encoded = encodeEnvelope({ ...material, model: { ...material.model } });
      encoded.input = JSON.stringify({ ...encoded.material, conversation });
      return encoded.input;
    },
    (input) => {
      if (!encoded || encoded.input !== input)
        throw new Error("Invalid chat launch");
      const secrets = encoded.secrets;
      return launchEncoded(encoded, signal, options.timeoutMs, {
        maySignal: options.maySignal,
        onNative: options.onNative,
        onCoordinator: options.onCoordinator,
        onFrame: (frame) => options.onFrame(frame, secrets),
        onContext: (source) => {
          const value = closed(parseWireJson(source, CONTEXT_BYTES), [
            "schema",
            "messages",
          ]);
          if (value.schema !== "cadence-conversation-context/1")
            throw new Error("Invalid checkpoint");
          options.onContext(
            conversationMessages(value.messages, [
              ...options.ownerSecrets(),
              ...secrets,
            ]),
          );
        },
      });
    },
  );
}

/** Owner-admitted workflow worker. The owner validates/retains the selected
 * worktree and journals launch before calling; model/auth still come from W1. */
export function launchWorkflowWorker(
  prepared: PreparedModelContext,
  cwd: string,
  signal: AbortSignal,
  options: {
    timeoutMs: number;
    ownerSecrets: readonly string[];
    maySignal(): boolean;
    onNative(native: NativeSettlement, selectedMessageId?: string): void;
    onFrame(frame: CaptureFrame, secrets: readonly string[]): void;
  },
): Promise<RunResult> {
  let encoded: ReturnType<typeof encodeEnvelope> | undefined;
  return prepared.consume(
    (material) => {
      encoded = encodeEnvelope({
        ...material,
        cwd,
        model: { ...material.model },
      });
      return encoded.input;
    },
    (input) => {
      if (!encoded || encoded.input !== input)
        throw new Error("Invalid workflow launch");
      const secrets = [...encoded.secrets, ...options.ownerSecrets];
      return launchEncoded(encoded, signal, options.timeoutMs, {
        secrets,
        maySignal: options.maySignal,
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
