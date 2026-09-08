export interface ExecutionProfile {
  mode: "isolated" | "local-trusted";
  timeoutMs: number;
  bwrapPath: string;
  inheritEnvironment: string[];
}

/** Operator configuration only. Unknown modes never silently disable isolation. */
export function executionProfile(
  env: NodeJS.ProcessEnv = process.env,
): ExecutionProfile {
  const mode = env.ABEL_EXECUTION_MODE ?? "isolated";
  if (mode !== "isolated" && mode !== "local-trusted")
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
  return {
    mode,
    timeoutMs,
    bwrapPath: env.ABEL_BWRAP_PATH ?? "/usr/bin/bwrap",
    inheritEnvironment,
  };
}
