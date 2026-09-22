import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Usage } from "@earendil-works/pi-ai";
import { loadAgentDefinitions } from "./agent-registry.ts";

export const SUBAGENT_LIMITS = Object.freeze({
  timeoutMs: 20 * 60_000,
  maxOutputBytes: 256 * 1024,
  terminateGraceMs: 1_000,
  maxPromptBytes: 128 * 1024,
});

export type SubagentRole =
  | "design-explorer"
  | "implementation-worker"
  | "diagnosis-worker";

export interface SubagentCapabilities {
  readonly tools: readonly string[];
  readonly writes: boolean;
}

export const SUBAGENT_CAPABILITIES: Readonly<
  Record<SubagentRole, SubagentCapabilities>
> = Object.freeze({
  "design-explorer": { tools: ["read", "grep", "find", "ls"], writes: false },
  "implementation-worker": {
    tools: ["read", "grep", "find", "ls", "write", "edit", "bash"],
    writes: true,
  },
  "diagnosis-worker": {
    tools: ["read", "grep", "find", "ls"],
    writes: false,
  },
});

export type SubagentTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed-out"
  | "output-limit";

export interface SubagentEvent {
  readonly type: string;
  readonly toolName?: string;
  readonly text?: string;
}

export interface SubagentProcessResult {
  readonly status: SubagentTerminalStatus;
  readonly finalText: string;
  readonly usage?: Usage;
  readonly stderr: string;
  readonly error?: string;
  readonly events: readonly SubagentEvent[];
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
  readonly exitCode: number | null;
}

export interface SubagentProcessInput {
  readonly role: SubagentRole;
  readonly cwd: string;
  readonly prompt: string;
  readonly model?: { provider: string; id: string };
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly piExecutable?: string;
  readonly onEvent?: (event: SubagentEvent) => void;
}

const TRUNCATION_MARKER = "…[truncated]";

function decodeUtf8(value: Buffer): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const maxBoundary = Math.min(3, value.length);
  // A bounded head may end, and a bounded tail may begin, in the middle of
  // one UTF-8 sequence. Try only those small boundary adjustments; valid
  // interior output is never discarded or rendered as U+FFFD.
  for (let start = 0; start <= maxBoundary; start += 1) {
    for (let end = value.length; end >= start; end -= 1) {
      if (value.length - end > 3) break;
      try {
        return decoder.decode(value.subarray(start, end));
      } catch {
        // Try the next possible boundary.
      }
    }
  }
  return value.toString("utf8");
}

function utf8Prefix(value: Buffer, limit: number): string {
  if (limit <= 0) return "";
  let end = Math.min(value.length, limit);
  while (end > 0 && (value[end - 1] & 0xc0) === 0x80) end -= 1;
  if (end < Math.min(value.length, limit) && end > 0) {
    const lead = value[end - 1];
    const expected = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    if (expected <= Math.min(value.length, limit) - (end - 1)) {
      end = Math.min(value.length, limit);
    } else {
      end -= 1;
    }
  }
  return decodeUtf8(value.subarray(0, end));
}

function boundedText(value: string, limit: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= limit) return value;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  if (limit <= markerBytes) return utf8Prefix(bytes, limit);
  return `${utf8Prefix(bytes, limit - markerBytes)}${TRUNCATION_MARKER}`;
}

class BoundedBuffer {
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  #bytes = 0;
  constructor(readonly limit: number) {}
  append(chunk: Buffer): void {
    this.#bytes += chunk.byteLength;
    if (this.limit <= 0) return;
    const headLimit = Math.ceil(this.limit / 2);
    if (this.#head.length < headLimit) {
      const take = Math.min(headLimit - this.#head.length, chunk.length);
      this.#head = Buffer.concat([this.#head, chunk.subarray(0, take)]);
      chunk = chunk.subarray(take);
    }
    const tailLimit = this.limit - headLimit;
    if (chunk.length > tailLimit) chunk = chunk.subarray(-tailLimit);
    if (chunk.length > 0 && tailLimit > 0) {
      this.#tail = Buffer.concat([this.#tail, chunk]).subarray(-tailLimit);
    }
  }
  get bytes(): number {
    return this.#bytes;
  }
  get truncated(): boolean {
    return this.#bytes > this.limit;
  }
  text(): string {
    return `${decodeUtf8(this.#head)}${decodeUtf8(this.#tail)}`;
  }
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const value = part as {
        type?: unknown;
        text?: unknown;
        thinking?: unknown;
      };
      if (value.type === "text" && typeof value.text === "string")
        return value.text;
      if (value.type === "thinking" && typeof value.thinking === "string")
        return value.thinking;
      return "";
    })
    .join("");
}

function usageFromMessage(message: unknown): Usage | undefined {
  if (!message || typeof message !== "object") return undefined;
  const usage = (message as { usage?: unknown }).usage;
  return usage && typeof usage === "object" ? (usage as Usage) : undefined;
}

function executableFromEnvironment(env: NodeJS.ProcessEnv): string {
  const explicit = env.CADENCE_PI_EXECUTABLE ?? env.PI_EXECUTABLE;
  if (explicit) return explicit;
  const current = process.argv[1];
  if (
    current &&
    (path.basename(current) === "pi" ||
      current
        .replaceAll("\\", "/")
        .endsWith("/pi-coding-agent/dist/bundle/cli.js") ||
      current.endsWith("\\\\pi-coding-agent\\dist\\bundle\\cli.js"))
  ) {
    return current;
  }
  return "pi";
}

function modelArgument(model: SubagentProcessInput["model"]): string[] {
  if (!model?.provider || !model.id) return [];
  return ["--model", `${model.provider}/${model.id}`];
}

/** Parse the last JSON object in a fenced result block without trusting it as authority. */
export function parseSubagentJson<T = unknown>(text: string): T | undefined {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try {
      const value: unknown = JSON.parse(matches[index]?.[1]?.trim() ?? "");
      return value as T;
    } catch {
      // A malformed final block is a result failure, not an identity.
    }
  }
  return undefined;
}

export function buildSubagentPrompt(input: {
  role: SubagentRole;
  objective: string;
  context?: string;
  agentContent?: string;
  finalConvention?: string;
}): string {
  const definition =
    input.agentContent ??
    loadAgentDefinitions().find((agent) => agent.role === input.role)?.content;
  if (!definition) throw new Error("subagent-role-unavailable");
  return [
    definition,
    "You are running as an isolated one-shot Pi child. Do not invoke workflow control tools, submit tools, or another agent.",
    `Your allowed tools are: ${SUBAGENT_CAPABILITIES[input.role].tools.join(", ")}.`,
    SUBAGENT_CAPABILITIES[input.role].writes
      ? "You may edit only the disposable workspace supplied as your current working directory. The parent will inspect all changes; never commit or claim verification success."
      : "You are read-only and must not modify files or run commands.",
    input.objective,
    input.context ?? "",
    input.finalConvention ??
      "Finish with a concise summary. If structured evidence is required, put exactly one JSON object in a ```json code fence as the final answer.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function terminateProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process group may already have exited.
        }
      } else if (!child.killed) {
        child.kill("SIGKILL");
      }
      finish();
    }, graceMs);
    timer.unref?.();
    child.once("close", finish);
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else {
      child.kill("SIGTERM");
    }
  });
}

/** Run a fresh Pi CLI. No cwd or tool allowlist is treated as an OS sandbox. */
export async function runSubagentProcess(
  input: SubagentProcessInput,
): Promise<SubagentProcessResult> {
  const timeoutMs = input.timeoutMs ?? SUBAGENT_LIMITS.timeoutMs;
  const maxOutputBytes = input.maxOutputBytes ?? SUBAGENT_LIMITS.maxOutputBytes;
  const promptBytes = Buffer.byteLength(input.prompt, "utf8");
  if (promptBytes > SUBAGENT_LIMITS.maxPromptBytes) {
    return {
      status: "output-limit",
      finalText: "",
      stderr: "",
      events: [],
      outputBytes: promptBytes,
      outputTruncated: true,
      exitCode: null,
      error: "subagent-prompt-limit",
    };
  }
  if (input.signal?.aborted) {
    return {
      status: "cancelled",
      finalText: "",
      stderr: "",
      events: [],
      outputBytes: 0,
      outputTruncated: false,
      exitCode: null,
      error: "cancelled",
    };
  }
  const tools = SUBAGENT_CAPABILITIES[input.role].tools.join(",");
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-context-files",
    "--no-approve",
    "--tools",
    tools,
    ...modelArgument(input.model),
  ];
  const env = { ...process.env, CADENCE_SUBAGENT_CHILD: "1" };
  const output = new BoundedBuffer(maxOutputBytes);
  const stderr = new BoundedBuffer(Math.min(maxOutputBytes, 64 * 1024));
  const events: SubagentEvent[] = [];
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      input.piExecutable ?? executableFromEnvironment(process.env),
      args,
      {
        cwd: input.cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        ...(process.platform === "win32" ? {} : { detached: true }),
      },
    );
  } catch {
    return {
      status: "failed",
      finalText: "",
      stderr: "",
      events,
      outputBytes: 0,
      outputTruncated: false,
      exitCode: null,
      error: "subagent-spawn-failed",
    };
  }
  const decoder = new StringDecoder("utf8");
  let finalText = "";
  let usage: Usage | undefined;
  let parseBuffer = "";
  let terminal: SubagentTerminalStatus | undefined;
  let terminalError: string | undefined;
  const emit = (event: SubagentEvent) => {
    events.push(event);
    try {
      input.onEvent?.(event);
    } catch {
      // Progress observers are presentation-only and cannot fail execution.
    }
  };
  const processLine = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/u, "");
    if (!line || terminal) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const type = typeof event.type === "string" ? event.type : "unknown";
      const message = event.message;
      const text =
        type === "message_end" ? textFromMessage(message) : undefined;
      if (
        text &&
        message &&
        typeof message === "object" &&
        (message as { role?: unknown }).role === "assistant"
      ) {
        finalText = boundedText(text, maxOutputBytes);
        usage = usageFromMessage(message) ?? usage;
      }
      if (
        type === "message_update" &&
        event.usage &&
        typeof event.usage === "object"
      )
        usage = event.usage as Usage;
      emit({
        type,
        ...(typeof event.toolName === "string"
          ? { toolName: event.toolName }
          : {}),
        ...(text ? { text: boundedText(text, 4096) } : {}),
      });
    } catch {
      emit({ type: "malformed-event" });
      terminal = "failed";
      terminalError = "subagent-jsonl-malformed";
      void terminateProcess(child, SUBAGENT_LIMITS.terminateGraceMs);
    }
  };
  const consumeDecoded = (decoded: string): void => {
    if (!decoded || terminal) return;
    if (
      Buffer.byteLength(parseBuffer, "utf8") +
        Buffer.byteLength(decoded, "utf8") >
      maxOutputBytes
    ) {
      parseBuffer = "";
      terminal = "output-limit";
      void terminateProcess(child, SUBAGENT_LIMITS.terminateGraceMs);
      return;
    }
    parseBuffer += decoded;
    for (;;) {
      const newline = parseBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = parseBuffer.slice(0, newline);
      parseBuffer = parseBuffer.slice(newline + 1);
      processLine(line);
      if (terminal) return;
    }
  };
  const consume = (chunk: Buffer) => {
    output.append(chunk);
    consumeDecoded(decoder.write(chunk));
    if (output.truncated && !terminal) {
      terminal = "output-limit";
      void terminateProcess(child, SUBAGENT_LIMITS.terminateGraceMs);
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
  const termination = new Promise<number | null>((resolve) => {
    // A spawn error is followed by close; keep the error listener only to
    // prevent an uncaught event while waiting for the pipes to settle.
    child.once("error", () => undefined);
    child.once("close", (code) => resolve(code));
  });
  const cancel = (status: "cancelled" | "timed-out") => {
    if (!terminal) terminal = status;
    void terminateProcess(child, SUBAGENT_LIMITS.terminateGraceMs);
  };
  const abortHandler = () => cancel("cancelled");
  input.signal?.addEventListener("abort", abortHandler, { once: true });
  const timer = setTimeout(() => cancel("timed-out"), timeoutMs);
  timer.unref?.();
  child.stdin.end(input.prompt);
  const exitCode = await termination;
  if (timer) clearTimeout(timer);
  input.signal?.removeEventListener("abort", abortHandler);
  const trailing = decoder.end();
  consumeDecoded(trailing);
  if (parseBuffer && !terminal) {
    processLine(parseBuffer);
    parseBuffer = "";
  }
  if (!terminal) terminal = exitCode === 0 ? "completed" : "failed";
  return {
    status: terminal,
    finalText,
    usage,
    stderr: boundedText(stderr.text(), 64 * 1024),
    ...(terminal === "failed"
      ? { error: terminalError ?? `subagent-exit-${exitCode ?? "unknown"}` }
      : {}),
    events,
    outputBytes: output.bytes,
    outputTruncated: output.truncated,
    exitCode,
  };
}
