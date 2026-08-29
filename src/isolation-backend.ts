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
}

export type IsolationRunResult =
  | {
      ok: true;
      state: "completed";
      exitCode: number;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      state: "paused";
      code:
        | "isolation-backend-unavailable"
        | "isolation-backend-launch-failed"
        | "isolation-execution-timeout"
        | "isolation-output-limit-exceeded";
    }
  | { ok: false; state: "cancelled"; code: "cancelled" };

export const ISOLATION_RUN_LIMITS = Object.freeze({
  timeoutMs: 10 * 60_000,
  maxOutputBytes: 1024 * 1024,
  terminateGraceMs: 1_000,
});

export interface BubblewrapIsolationOptions {
  bwrapPath?: string;
  probe?: (path: string) => boolean | Promise<boolean>;
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  maxOutputBytes?: number;
  terminateGraceMs?: number;
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

/** Linux isolation capability. Lack of Bubblewrap is a pause, never a fallback. */
export class BubblewrapIsolationBackend {
  readonly #bwrapPath: string;
  readonly #probe: (path: string) => boolean | Promise<boolean>;
  readonly #spawn: typeof spawn;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;
  readonly #terminateGraceMs: number;

  constructor(options: BubblewrapIsolationOptions = {}) {
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
      return Boolean(await this.#probe(this.#bwrapPath));
    } catch {
      return false;
    }
  }

  async run(input: IsolationRunInput): Promise<IsolationRunResult> {
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
    const argv = [
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
    for (const systemRoot of ["/usr", "/bin", "/lib", "/lib64"]) {
      const stat = lstatSync(systemRoot, { throwIfNoEntry: false });
      if (!stat) continue;
      argv.push("--ro-bind", systemRoot, systemRoot);
    }
    for (const mount of input.mounts ?? []) {
      if (!path.isAbsolute(mount.source) || !path.isAbsolute(mount.target)) {
        throw new Error("isolation-mount-invalid");
      }
      argv.push(
        mount.writable ? "--bind" : "--ro-bind",
        mount.source,
        mount.target,
      );
    }
    for (const [name, value] of Object.entries(
      input.environment ?? {},
    ).sort()) {
      if (!validEnvironmentName(name) || value.includes("\0")) {
        throw new Error("isolation-environment-invalid");
      }
      argv.push("--setenv", name, value);
    }
    argv.push("--", input.executable, ...(input.args ?? []));

    return new Promise((resolve) => {
      let settled = false;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let capturedBytes = 0;
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
      const terminate = (result: IsolationRunResult): void => {
        if (settled || terminationResult) return;
        terminationResult = result;
        if (executionTimer) clearTimeout(executionTimer);
        killTimer = setTimeout(
          () => child?.kill("SIGKILL"),
          this.#terminateGraceMs,
        );
        killTimer.unref?.();
        child?.kill("SIGTERM");
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
      const capture = (destination: Buffer[], chunk: Buffer | string): void => {
        if (settled || terminationResult) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = this.#maxOutputBytes - capturedBytes;
        if (remaining > 0) destination.push(bytes.subarray(0, remaining));
        if (bytes.byteLength > remaining) {
          capturedBytes = this.#maxOutputBytes;
          terminate({
            ok: false,
            state: "paused",
            code: "isolation-output-limit-exceeded",
          });
          return;
        }
        capturedBytes += bytes.byteLength;
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
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
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
