import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BoundedLog,
  ISOLATION_RUN_LIMITS,
  type IsolationRunInput,
  type IsolationRunResult,
} from "./isolation-backend.ts";

const SHUTDOWN_MS = 5000;
const invalid = (): never => {
  throw new Error("windows-job-request-invalid");
};
const text = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 16384 &&
  !value.includes("\0") &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );
const absolute = (value: unknown): value is string =>
  text(value) && /^[A-Za-z]:\\/u.test(value) && path.win32.isAbsolute(value);
export function encodeWindowsJobRequest(
  input: IsolationRunInput,
  timeoutMs: number,
): Buffer {
  if (
    !absolute(input.root) ||
    !absolute(input.executable) ||
    !input.executable.toLowerCase().endsWith(".exe") ||
    input.mounts?.length ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 86_400_000
  )
    invalid();
  const args = input.args ?? [];
  if (args.length > 128 || !args.every(text)) invalid();
  const seen = new Set<string>();
  const env = Object.entries(input.environment ?? {});
  for (const [name, value] of env) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
      !text(value) ||
      seen.has(name.toUpperCase())
    )
      invalid();
    seen.add(name.toUpperCase());
  }
  const quote = (value: string) =>
    `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/gu, "$1$1")}"`;
  const command = [input.executable, ...args].map(quote).join(" ");
  if (command.length >= 32767) invalid();
  const environment = `${env
    .sort(([a], [b]) => (a.toUpperCase() < b.toUpperCase() ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\0")}\0\0`;
  const parts = [
    `${input.executable}\0`,
    `${command}\0`,
    `${input.root}\0`,
    environment,
  ].map((s) => Buffer.from(s, "utf16le"));
  const header = Buffer.alloc(36);
  [2, timeoutMs, SHUTDOWN_MS, 0, ...parts.map((p) => p.length), 0].forEach(
    (n, i) => {
      header.writeUInt32LE(n, i * 4);
    },
  );
  const wire = Buffer.concat([header, ...parts]);
  if (wire.length > 65536 || parts.some((p) => p.length > 60000)) invalid();
  return wire;
}

/** A manifest binds a explicitly built native helper to the shipped source. */
export function verifyWindowsJobHelper(helper: string): boolean {
  try {
    if (!path.isAbsolute(helper)) return false;
    const files = [helper, `${helper}.json`];
    if (
      files.some((file) => {
        const s = lstatSync(file);
        return !s.isFile() || s.isSymbolicLink() || s.size > 8 * 1024 * 1024;
      })
    )
      return false;
    const bytes = readFileSync(helper);
    const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
    if (
      bytes.toString("ascii", 0, 2) !== "MZ" ||
      pe < 64 ||
      pe + 6 > bytes.length ||
      bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664
    )
      return false;
    const hash = (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex");
    const manifest = JSON.parse(readFileSync(`${helper}.json`, "utf8"));
    return (
      manifest.version === 2 &&
      manifest.arch === "x64" &&
      manifest.helperSha256 === hash(bytes) &&
      manifest.sourceSha256 ===
        hash(readFileSync(new URL("./windows-job.c", import.meta.url)))
    );
  } catch {
    return false;
  }
}

interface Observation {
  version: 2;
  outcome: "complete" | "failed" | "uncertain";
  reason: string;
  rootExited: boolean;
  managedSettled: boolean;
  exitCode: number | null;
}
function observation(value: unknown): Observation | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Observation;
  if (
    Object.keys(v).sort().join(",") !==
      "exitCode,managedSettled,outcome,reason,rootExited,version" ||
    v.version !== 2 ||
    !["complete", "failed", "uncertain"].includes(v.outcome) ||
    ![
      "exit",
      "timeout",
      "cancelled",
      "launch-failed",
      "termination-unconfirmed",
    ].includes(v.reason) ||
    typeof v.rootExited !== "boolean" ||
    typeof v.managedSettled !== "boolean" ||
    !(
      v.exitCode === null ||
      (Number.isInteger(v.exitCode) &&
        v.exitCode >= 0 &&
        v.exitCode <= 0xffffffff)
    )
  )
    return;
  if (
    v.outcome === "complete" &&
    (v.reason !== "exit" ||
      !v.rootExited ||
      !v.managedSettled ||
      v.exitCode === null)
  )
    return;
  if (
    v.outcome === "failed" &&
    (!v.managedSettled ||
      !["timeout", "cancelled", "launch-failed"].includes(v.reason))
  )
    return;
  return v;
}
const uncertain = (): IsolationRunResult => ({
  ok: false,
  state: "paused",
  code: "isolation-termination-unconfirmed",
});
function classify(
  v: Observation | undefined,
  helperExit: number | null,
  output: BoundedLog,
  cancelled: boolean,
): IsolationRunResult {
  if (!v?.managedSettled || v.outcome === "uncertain" || helperExit !== 0)
    return uncertain();
  if (cancelled || v.reason === "cancelled")
    return { ok: false, state: "cancelled", code: "cancelled" };
  if (v.reason === "timeout")
    return { ok: false, state: "paused", code: "isolation-execution-timeout" };
  if (v.reason === "launch-failed")
    return {
      ok: false,
      state: "paused",
      code: "isolation-backend-launch-failed",
    };
  if (v.outcome !== "complete" || v.exitCode === null) return uncertain();
  return {
    ok: true,
    state: "completed",
    exitCode: v.exitCode,
    stdout: output.text(),
    stderr: "",
    outputWitnessMatched: output.witnessMatched,
    logs: { stdout: output.metadata(), stderr: { bytes: 0, truncated: false } },
  };
}

/** Host files/network are trusted; the Job owns process lifetime, not a security sandbox. */
interface WindowsJobOptions {
  helperPath: string;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  arch?: string;
  probe?: (helper: string) => boolean;
  spawnProcess?: typeof spawn;
  maxOutputBytes?: number;
}
export class WindowsJobBackend {
  readonly #options: WindowsJobOptions;
  constructor(options: WindowsJobOptions) {
    for (const [value, maximum] of [
      [options.timeoutMs ?? ISOLATION_RUN_LIMITS.timeoutMs, 86_400_000],
      [
        options.maxOutputBytes ?? ISOLATION_RUN_LIMITS.maxOutputBytes,
        1024 * 1024,
      ],
    ])
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error("isolation-run-limits-invalid");
    this.#options = options;
  }
  available(): boolean {
    return (
      (this.#options.platform ?? process.platform) === "win32" &&
      (this.#options.arch ?? process.arch) === "x64" &&
      (this.#options.probe ?? verifyWindowsJobHelper)(this.#options.helperPath)
    );
  }
  async run(input: IsolationRunInput): Promise<IsolationRunResult> {
    if (!this.available())
      return {
        ok: false,
        state: "paused",
        code: "isolation-backend-unavailable",
      };
    if (input.signal?.aborted)
      return { ok: false, state: "cancelled", code: "cancelled" };
    if (
      input.outputWitness !== undefined &&
      (!text(input.outputWitness) ||
        input.outputWitness.length < 1 ||
        input.outputWitness.length > 512)
    )
      return {
        ok: false,
        state: "paused",
        code: "isolation-backend-launch-failed",
      };
    const timeoutMs = this.#options.timeoutMs ?? ISOLATION_RUN_LIMITS.timeoutMs;
    let wire: Buffer;
    try {
      wire = encodeWindowsJobRequest(input, timeoutMs);
    } catch {
      return {
        ok: false,
        state: "paused",
        code: "isolation-backend-launch-failed",
      };
    }
    const output = new BoundedLog(
      this.#options.maxOutputBytes ?? ISOLATION_RUN_LIMITS.maxOutputBytes,
      input.outputWitness,
    );
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      let line = "",
        final: Observation | undefined,
        bad = false,
        closed = false,
        launchFailed = false;
      let timer: ReturnType<typeof setTimeout>;
      let stopping = false;
      const armDeadline = (duration: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          bad = true;
          child.kill();
          finish(uncertain());
        }, duration);
        timer.unref?.();
      };
      const cancel = () => {
        if (stopping || closed) return;
        stopping = true;
        child.stdin?.end();
        armDeadline(SHUTDOWN_MS + 5000);
      };
      const finish = (result: IsolationRunResult) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", cancel);
        resolve(result);
      };
      try {
        child = (this.#options.spawnProcess ?? spawn)(
          this.#options.helperPath,
          [],
          {
            cwd: input.root,
            shell: false,
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
      } catch {
        finish({
          ok: false,
          state: "paused",
          code: "isolation-backend-launch-failed",
        });
        return;
      }
      const malformed = () => {
        bad = true;
        cancel();
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        if (closed || bad) return;
        line += chunk.toString("utf8");
        // Helper lines are ASCII and <= 2200 bytes. Drain incrementally.
        while (line.includes("\n")) {
          const end = line.indexOf("\n");
          const row = line.slice(0, end);
          line = line.slice(end + 1);
          if (row.length > 4096 || final) {
            malformed();
            return;
          }
          try {
            const value = JSON.parse(row);
            if (
              Object.keys(value).length === 1 &&
              typeof value.outputHex === "string" &&
              /^(?:[a-f0-9]{2}){1,1024}$/u.test(value.outputHex)
            )
              output.append(Buffer.from(value.outputHex, "hex"));
            else {
              final = observation(value);
              if (!final) {
                malformed();
                return;
              }
            }
          } catch {
            malformed();
            return;
          }
        }
        if (line.length > 4096) malformed();
      });
      child.stderr?.on("data", () => {
        /* helper diagnostics are never product output */
      });
      child.stdin?.on("error", () => {
        bad = true;
      });
      child.once("error", () => {
        bad = true;
        launchFailed = child.pid === undefined;
      });
      child.once("close", (code) =>
        finish(
          launchFailed
            ? {
                ok: false,
                state: "paused",
                code: "isolation-backend-launch-failed",
              }
            : bad || line.length
              ? uncertain()
              : classify(final, code, output, input.signal?.aborted === true),
        ),
      );
      // Kill-on-close is containment; only a receipt establishes settlement.
      armDeadline(timeoutMs + SHUTDOWN_MS + 10_000);
      input.signal?.addEventListener("abort", cancel, { once: true });
      child.stdin?.write(wire);
      if (input.signal?.aborted) cancel();
    });
  }
}

export function probeWindowsJob(helper: string): boolean {
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    !verifyWindowsJobHelper(helper)
  )
    return false;
  const wire = encodeWindowsJobRequest(
    {
      root: process.cwd(),
      executable: process.execPath,
      args: ["-e", "process.exit(0)"],
      environment: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
    },
    5000,
  );
  // EOF means cancel, so doctor uses the helper's explicit probe path instead.
  const result = spawnSync(helper, ["--probe"], {
    input: wire,
    shell: false,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 65536,
  });
  try {
    const v = observation(JSON.parse(result.stdout.trim()));
    return (
      !result.error &&
      result.status === 0 &&
      v?.outcome === "complete" &&
      v.exitCode === 0
    );
  } catch {
    return false;
  }
}
