import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync } from "node:fs";
import path from "node:path";

export interface IsolationMount {
  source: string;
  target: string;
  writable?: boolean;
}

export interface IsolationRunInput {
  root: string;
  executable: string;
  args?: string[];
  mounts?: IsolationMount[];
  environment?: Record<string, string>;
  signal?: AbortSignal;
  outputWitness?: string;
}

export type IsolationRunResult =
  | {
      ok: true;
      state: "completed";
      exitCode: number;
      stdout: string;
      stderr: string;
      outputWitnessMatched?: boolean;
      logs: {
        stdout: { bytes: number; truncated: boolean };
        stderr: { bytes: number; truncated: boolean };
      };
    }
  | {
      ok: false;
      state: "paused";
      code:
        | "isolation-backend-unavailable"
        | "isolation-backend-launch-failed"
        | "isolation-execution-timeout";
    }
  | { ok: false; state: "cancelled"; code: "cancelled" };

export const ISOLATION_RUN_LIMITS = Object.freeze({
  timeoutMs: 10 * 60_000,
  maxOutputBytes: 256 * 1024,
  terminateGraceMs: 1_000,
});

export interface BubblewrapIsolationOptions {
  bwrapPath?: string;
  probe?: (path: string) => boolean | Promise<boolean>;
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
  /** Explicit operator opt-in; never an availability fallback. */
  localTrusted?: boolean;
}

function defaultProbe(executable: string): boolean {
  try {
    accessSync(executable, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function validEnvironmentName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name);
}

/** Retains independent head/tail copies; discarded chunks never stay referenced. */
class BoundedLog {
  bytes = 0;
  #head = Buffer.alloc(0);
  #tail = Buffer.alloc(0);
  readonly limit: number;
  readonly #witness?: Buffer;
  #witnessTail = Buffer.alloc(0);
  witnessMatched = false;
  constructor(limit: number, witness?: string) {
    this.limit = limit;
    if (witness) this.#witness = Buffer.from(witness);
  }
  append(chunk: Buffer | string): void {
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.bytes += input.byteLength;
    if (this.#witness && !this.witnessMatched) {
      const searchable = Buffer.concat([this.#witnessTail, input]);
      this.witnessMatched = searchable.includes(this.#witness);
      this.#witnessTail = this.witnessMatched
        ? Buffer.alloc(0)
        : Buffer.from(
            searchable.subarray(
              Math.max(0, searchable.length - this.#witness.length + 1),
            ),
          );
    }
    const headLimit = Math.ceil(this.limit / 2);
    const take = Math.min(input.length, headLimit - this.#head.length);
    if (take > 0)
      this.#head = Buffer.concat([this.#head, input.subarray(0, take)]);
    const rest = input.subarray(take);
    const tailLimit = this.limit - headLimit;
    if (rest.length && tailLimit) {
      this.#tail =
        rest.length >= tailLimit
          ? Buffer.from(rest.subarray(-tailLimit))
          : Buffer.concat([
              this.#tail.subarray(
                Math.max(0, this.#tail.length + rest.length - tailLimit),
              ),
              rest,
            ]);
    }
  }
  text(): string {
    return Buffer.concat([this.#head, this.#tail]).toString("utf8");
  }
  metadata() {
    return { bytes: this.bytes, truncated: this.bytes > this.limit };
  }
}

/** Linux isolation capability. Lack of Bubblewrap is a pause, never a fallback. */
export class BubblewrapIsolationBackend {
  readonly #localTrusted: boolean;
  readonly #bwrapPath: string;
  readonly #probe: (path: string) => boolean | Promise<boolean>;
  readonly #spawn: typeof spawn;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #terminateGraceMs: number;

  constructor(options: BubblewrapIsolationOptions = {}) {
    this.#localTrusted = options.localTrusted === true;
    this.#bwrapPath = options.bwrapPath ?? "/usr/bin/bwrap";
    this.#probe = options.probe ?? defaultProbe;
    this.#spawn = options.spawnProcess ?? spawn;
    this.#timeoutMs = options.timeoutMs ?? ISOLATION_RUN_LIMITS.timeoutMs;
    this.#maxOutputBytes =
      options.maxOutputBytes ?? ISOLATION_RUN_LIMITS.maxOutputBytes;
    this.#terminateGraceMs =
      options.terminateGraceMs ?? ISOLATION_RUN_LIMITS.terminateGraceMs;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      !Number.isSafeInteger(this.#maxOutputBytes) ||
      this.#maxOutputBytes < 1 ||
      !Number.isSafeInteger(this.#terminateGraceMs) ||
      this.#terminateGraceMs < 1
    ) {
      throw new Error("isolation-run-limits-invalid");
    }
  }

  async available(): Promise<boolean> {
    try {
      if (this.#localTrusted && process.platform !== "linux") return false;
      return Boolean(await this.#probe(this.#bwrapPath));
    } catch {
      return false;
    }
  }

  async run(input: IsolationRunInput): Promise<IsolationRunResult> {
    if (
      input.outputWitness !== undefined &&
      (typeof input.outputWitness !== "string" ||
        input.outputWitness.length < 1 ||
        input.outputWitness.length > 512)
    )
      throw new Error("isolation-output-witness-invalid");
    if (!(await this.available())) {
      return {
        ok: false,
        state: "paused",
        code: "isolation-backend-unavailable",
      };
    }
    if (input.signal?.aborted) {
      return { ok: false, state: "cancelled", code: "cancelled" };
    }
    const root = path.resolve(input.root);
    const rootStat = lstatSync(root, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("isolation-root-invalid");
    }
    // Trusted mode shares host files/network, but still needs a PID namespace:
    // process groups alone cannot contain detached descendants. No fallback.
    const argv = this.#localTrusted
      ? [
          "--die-with-parent",
          "--new-session",
          "--unshare-pid",
          "--bind",
          "/",
          "/",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--chdir",
          root,
          "--clearenv",
        ]
      : [
          "--die-with-parent",
          "--new-session",
          "--unshare-all",
          "--proc",
          "/proc",
          "--dev",
          "/dev",
          "--tmpfs",
          "/tmp",
          "--bind",
          root,
          "/workspace",
          "--chdir",
          "/workspace",
          "--clearenv",
          "--setenv",
          "PATH",
          "/usr/local/bin:/usr/bin:/bin",
        ];
    if (!this.#localTrusted) {
      for (const systemRoot of ["/usr", "/bin", "/lib", "/lib64"]) {
        if (lstatSync(systemRoot, { throwIfNoEntry: false }))
          argv.push("--ro-bind", systemRoot, systemRoot);
      }
      for (const mount of input.mounts ?? []) {
        if (!path.isAbsolute(mount.source) || !path.isAbsolute(mount.target))
          throw new Error("isolation-mount-invalid");
        argv.push(
          mount.writable ? "--bind" : "--ro-bind",
          mount.source,
          mount.target,
        );
      }
    }
    for (const [name, value] of Object.entries(
      input.environment ?? {},
    ).sort()) {
      if (!validEnvironmentName(name) || value.includes("\0"))
        throw new Error("isolation-environment-invalid");
      argv.push("--setenv", name, value);
    }
    argv.push("--", input.executable, ...(input.args ?? []));

    return new Promise((resolve) => {
      let settled = false;
      const stdout = new BoundedLog(this.#maxOutputBytes, input.outputWitness);
      const stderr = new BoundedLog(this.#maxOutputBytes, input.outputWitness);
      let child: ReturnType<typeof spawn>;
      let executionTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let terminationResult: IsolationRunResult | undefined;
      const settle = (result: IsolationRunResult): void => {
        if (settled) return;
        settled = true;
        if (executionTimer) clearTimeout(executionTimer);
        input.signal?.removeEventListener("abort", abort);
        resolve(result);
      };
      const kill = (signal: NodeJS.Signals) => {
        child?.kill(signal);
      };
      const terminate = (result: IsolationRunResult): void => {
        if (settled || terminationResult) return;
        terminationResult = result;
        if (executionTimer) clearTimeout(executionTimer);
        killTimer = setTimeout(() => kill("SIGKILL"), this.#terminateGraceMs);
        killTimer.unref?.();
        kill("SIGTERM");
      };
      const abort = (): void => {
        terminate({ ok: false, state: "cancelled", code: "cancelled" });
      };
      try {
        child = this.#spawn(this.#bwrapPath, argv, {
          cwd: root,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        settle({
          ok: false,
          state: "paused",
          code: "isolation-backend-launch-failed",
        });
        return;
      }
      const capture = (
        destination: BoundedLog,
        chunk: Buffer | string,
      ): void => {
        if (!settled && !terminationResult) destination.append(chunk);
      };
      child.stdout?.on("data", (chunk: Buffer | string) => {
        capture(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        capture(stderr, chunk);
      });
      child.once("error", () => {
        if (terminationResult) return;
        settle({
          ok: false,
          state: "paused",
          code: "isolation-backend-launch-failed",
        });
      });
      child.once("close", (code) => {
        if (killTimer) clearTimeout(killTimer);
        settle(
          terminationResult ?? {
            ok: true,
            state: "completed",
            exitCode: code ?? 1,
            stdout: stdout.text(),
            stderr: stderr.text(),
            logs: { stdout: stdout.metadata(), stderr: stderr.metadata() },
            ...(input.outputWitness
              ? {
                  outputWitnessMatched:
                    stdout.witnessMatched || stderr.witnessMatched,
                }
              : {}),
          },
        );
      });
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) {
        abort();
        return;
      }
      executionTimer = setTimeout(
        () =>
          terminate({
            ok: false,
            state: "paused",
            code: "isolation-execution-timeout",
          }),
        this.#timeoutMs,
      );
      executionTimer.unref?.();
    });
  }
}
