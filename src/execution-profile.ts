import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ExecutionProfile {
  mode: "isolated" | "local-trusted" | "host-trusted";
  timeoutMs: number;
  bwrapPath: string;
  inheritEnvironment: string[];
  windowsHelperPath?: string;
}

/** Operator configuration only. Unknown modes never silently disable isolation. */
export function executionProfile(
  env: NodeJS.ProcessEnv = process.env,
): ExecutionProfile {
  const mode = env.ABEL_EXECUTION_MODE ?? "isolated";
  if (
    mode !== "isolated" &&
    mode !== "local-trusted" &&
    mode !== "host-trusted"
  )
    throw new Error("execution-mode-invalid");
  const timeoutMs = Number(env.ABEL_VERIFICATION_TIMEOUT_MS ?? 600_000);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 86_400_000
  )
    throw new Error("verification-timeout-invalid");
  const inheritEnvironment = (env.ABEL_VERIFICATION_ENV ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (
    inheritEnvironment.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
  )
    throw new Error("verification-environment-names-invalid");
  if (mode === "isolated" && inheritEnvironment.length)
    throw new Error("verification-environment-requires-trusted-mode");
  if (
    mode === "host-trusted" &&
    env.ABEL_WINDOWS_JOB_HELPER !== undefined &&
    (!env.ABEL_WINDOWS_JOB_HELPER ||
      env.ABEL_WINDOWS_JOB_HELPER.includes("\0") ||
      !(
        path.isAbsolute(env.ABEL_WINDOWS_JOB_HELPER) ||
        path.win32.isAbsolute(env.ABEL_WINDOWS_JOB_HELPER)
      ))
  )
    throw new Error("windows-job-helper-path-invalid");
  return {
    mode,
    timeoutMs,
    bwrapPath: env.ABEL_BWRAP_PATH ?? "/usr/bin/bwrap",
    inheritEnvironment,
    ...(mode === "host-trusted"
      ? {
          windowsHelperPath:
            env.ABEL_WINDOWS_JOB_HELPER ??
            fileURLToPath(new URL("./windows-job.exe", import.meta.url)),
        }
      : {}),
  };
}
