import { execFile } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const PACKAGE_NAME = "@fission-ai/openspec";
export const OPENSPEC_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxBuffer: 4 * 1024 * 1024,
});

type Command = "resolve" | "status" | "validate";
type Phase = "resolution" | "spawn" | "execution" | "protocol";
type Reason =
  | "installation-not-found"
  | "installation-invalid"
  | "runtime-unavailable"
  | "cwd-unavailable"
  | "terminated"
  | "unsafe-installation"
  | "launch-failed"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "exit-nonzero"
  | "json-invalid"
  | "schema-invalid"
  | "change-invalid";

/** Only code-owned, non-secret fields may cross the Design failure boundary. */
export interface OpenSpecDiagnostic {
  code: "design-openspec-unavailable";
  command: Command;
  phase: Phase;
  reason: Reason;
  systemCode?: string;
  exitCode?: string;
}

export class OpenSpecCliError extends Error {
  readonly diagnostic: Readonly<OpenSpecDiagnostic>;

  constructor(
    command: Command,
    phase: Phase,
    reason: Reason,
    detail: { systemCode?: string; exitCode?: number } = {},
  ) {
    super("design-openspec-unavailable");
    this.name = "OpenSpecCliError";
    this.diagnostic = Object.freeze({
      code: "design-openspec-unavailable",
      command,
      phase,
      reason,
      ...(["ENOENT", "EINVAL", "EACCES", "EPERM", "ENOEXEC", "E2BIG"].includes(
        detail.systemCode ?? "",
      )
        ? { systemCode: detail.systemCode }
        : {}),
      ...(Number.isSafeInteger(detail.exitCode) && (detail.exitCode ?? -1) >= 0
        ? { exitCode: String(detail.exitCode) }
        : {}),
    });
  }
}

export interface OpenSpecCliOptions {
  /** Trusted operator configuration, never a Worker-supplied command string. */
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface OpenSpecInvocation {
  executable: string;
  entry: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function envValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  // Match Node's lexicographic, case-insensitive environment selection on Windows.
  const key = Object.keys(environment)
    .sort()
    .find((candidate) =>
      process.platform === "win32"
        ? candidate.toUpperCase() === name.toUpperCase()
        : candidate === name,
    );
  return key === undefined ? undefined : environment[key];
}

function packageEntry(root: string): string {
  const canonicalRoot = realpathSync(root);
  const manifestPath = realpathSync(path.join(canonicalRoot, "package.json"));
  const manifestStat = lstatSync(manifestPath);
  if (
    !inside(canonicalRoot, manifestPath) ||
    !manifestStat.isFile() ||
    manifestStat.size > 1024 * 1024
  )
    throw new Error("manifest-limit");
  const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")));
  const bin =
    typeof manifest?.bin === "string"
      ? manifest.bin
      : record(manifest?.bin)?.openspec;
  if (
    manifest?.name !== PACKAGE_NAME ||
    typeof bin !== "string" ||
    path.isAbsolute(bin)
  )
    throw new Error("manifest-invalid");
  const entry = realpathSync(path.resolve(canonicalRoot, bin));
  if (
    !inside(canonicalRoot, entry) ||
    !/\.(?:cjs|mjs|js)$/iu.test(entry) ||
    !lstatSync(entry).isFile()
  )
    throw new Error("entry-invalid");
  return entry;
}

function canonicalConsumerRoot(consumerRoot: string): string {
  try {
    const root = realpathSync(consumerRoot);
    if (!lstatSync(root).isDirectory()) throw new Error("cwd-invalid");
    return root;
  } catch (error) {
    throw new OpenSpecCliError("resolve", "resolution", "cwd-unavailable", {
      systemCode: (error as NodeJS.ErrnoException).code,
    });
  }
}

function commandIn(directory: string): string | undefined {
  const names =
    process.platform === "win32"
      ? ["openspec.exe", "openspec.cmd", "openspec"]
      : ["openspec"];
  // Windows filesystems are usually case-insensitive; reject ambiguous names.
  const entries = process.platform === "win32" ? readdirSync(directory) : names;
  for (const name of names) {
    const matches = entries.filter((entry) => entry.toLowerCase() === name);
    if (matches.length > 1) throw new Error("ambiguous-command");
    if (matches.length === 1) {
      const candidate = path.join(directory, matches[0]);
      if (lstatSync(candidate, { throwIfNoEntry: false })) return candidate;
    }
  }
  return undefined;
}

/** Resolve once per inspection. Never execute or parse a shell shim. */
export function resolveOpenSpecInvocation(
  consumerRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): OpenSpecInvocation {
  const configuredRoot = envValue(environment, "ABEL_OPENSPEC_PACKAGE_ROOT");
  const configuredNode = envValue(environment, "ABEL_OPENSPEC_NODE");
  const node =
    configuredNode ??
    (process.release.name === "node" && !process.versions.bun
      ? process.execPath
      : undefined);
  let executable: string;
  try {
    if (!node || !path.isAbsolute(node) || /\.(?:cmd|bat|ps1)$/iu.test(node)) {
      throw new Error("runtime-invalid");
    }
    executable = realpathSync(node);
    if (!lstatSync(executable).isFile()) throw new Error("runtime-invalid");
  } catch {
    throw new OpenSpecCliError("resolve", "resolution", "runtime-unavailable");
  }
  if (configuredRoot !== undefined) {
    try {
      if (!path.isAbsolute(configuredRoot)) throw new Error("root-invalid");
      return { executable, entry: packageEntry(configuredRoot) };
    } catch {
      throw new OpenSpecCliError(
        "resolve",
        "resolution",
        "installation-invalid",
      );
    }
  }

  const consumer = canonicalConsumerRoot(consumerRoot);
  const directories = (envValue(environment, "PATH") ?? "").split(
    path.delimiter,
  );
  for (const directory of directories) {
    // Do not introduce implicit cwd search or automatically trust repository CLIs.
    if (!path.isAbsolute(directory)) continue;
    let command: string | undefined;
    let canonicalDirectory: string;
    try {
      canonicalDirectory = realpathSync(directory);
      if (inside(consumer, canonicalDirectory)) continue;
      command = commandIn(canonicalDirectory);
    } catch {
      continue;
    }
    if (!command) continue;
    try {
      const target = realpathSync(command);
      if (inside(consumer, target)) {
        throw new OpenSpecCliError(
          "resolve",
          "resolution",
          "unsafe-installation",
        );
      }
      // npm Windows/custom prefix and Unix global layouts. Symlinked npm/Bun
      // entries are also discovered by walking their real target's ancestors.
      const layoutRoots = [
        path.join(canonicalDirectory, "node_modules", PACKAGE_NAME),
        path.resolve(canonicalDirectory, "../lib/node_modules", PACKAGE_NAME),
      ];
      const roots: string[] = [];
      let ancestor = path.dirname(target);
      for (let depth = 0; depth < 8; depth++) {
        roots.push(ancestor);
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      // A real symlink target identifies the selected version more precisely
      // than an adjacent global installation.
      const linked = lstatSync(command).isSymbolicLink();
      const candidates = linked ? roots : layoutRoots;
      for (const root of candidates) {
        let entry: string;
        try {
          entry = packageEntry(root);
          if (linked && entry !== target) continue;
        } catch {
          continue;
        }
        if (inside(consumer, entry)) {
          throw new OpenSpecCliError(
            "resolve",
            "resolution",
            "unsafe-installation",
          );
        }
        return { executable, entry };
      }
    } catch (error) {
      if (error instanceof OpenSpecCliError) throw error;
    }
    // A broken/shadowing installation must not silently select another version.
    throw new OpenSpecCliError("resolve", "resolution", "installation-invalid");
  }
  throw new OpenSpecCliError("resolve", "resolution", "installation-not-found");
}

interface CommandResult {
  stdout: string;
  exitCode: number;
}

function execute(
  invocation: OpenSpecInvocation,
  command: "status" | "validate",
  args: string[],
  consumerRoot: string,
  options: OpenSpecCliOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile> | undefined;
    const abort = () => child?.kill("SIGKILL");
    const failLaunch = (error: unknown) => {
      const code = (error as NodeJS.ErrnoException)?.code;
      reject(
        new OpenSpecCliError(command, "spawn", "launch-failed", {
          systemCode: typeof code === "string" ? code : undefined,
        }),
      );
    };
    try {
      child = execFile(
        invocation.executable,
        [invocation.entry, ...args],
        {
          cwd: consumerRoot,
          env: {
            ...(options.environment ?? process.env),
            OPENSPEC_TELEMETRY: "0",
          },
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          timeout: options.timeoutMs ?? OPENSPEC_LIMITS.timeoutMs,
          maxBuffer: options.maxBuffer ?? OPENSPEC_LIMITS.maxBuffer,
          // This adapter launches a single Node CLI, not a shell/process tree.
          killSignal: "SIGKILL",
        },
        (error, stdout) => {
          options.signal?.removeEventListener("abort", abort);
          if (options.signal?.aborted) {
            return reject(
              new OpenSpecCliError(command, "execution", "cancelled"),
            );
          }
          if (!error) return resolve({ stdout, exitCode: 0 });
          const code = error.code;
          if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            return reject(
              new OpenSpecCliError(command, "execution", "output-limit"),
            );
          }
          if (error.killed) {
            return reject(
              new OpenSpecCliError(command, "execution", "timeout"),
            );
          }
          if (error.signal) {
            return reject(
              new OpenSpecCliError(command, "execution", "terminated"),
            );
          }
          if (typeof code === "number")
            return resolve({ stdout, exitCode: code });
          reject(
            new OpenSpecCliError(command, "spawn", "launch-failed", {
              systemCode: typeof code === "string" ? code : undefined,
            }),
          );
        },
      );
      child.stdin?.end();
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    } catch (error) {
      options.signal?.removeEventListener("abort", abort);
      failLaunch(error);
    }
  });
}

function parseJson(result: CommandResult, command: "status" | "validate") {
  if (
    result.exitCode !== 0 &&
    !(command === "validate" && result.exitCode === 1)
  ) {
    throw new OpenSpecCliError(command, "execution", "exit-nonzero", result);
  }
  try {
    const parsed = record(JSON.parse(result.stdout));
    if (!parsed) throw new Error("not-object");
    return parsed;
  } catch {
    throw new OpenSpecCliError(command, "protocol", "json-invalid", result);
  }
}

export interface OpenSpecDeliveryInspection {
  change: string;
  schema: string;
  planningComplete: boolean;
  strictValid: boolean;
  artifactPaths: string[];
}

export async function inspectOpenSpecDelivery(
  consumerRoot: string,
  change: string,
  options: OpenSpecCliOptions = {},
): Promise<OpenSpecDeliveryInspection> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(change)) {
    throw new OpenSpecCliError("resolve", "resolution", "change-invalid");
  }
  for (const limit of [options.timeoutMs, options.maxBuffer]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new Error("openspec-limit-invalid");
    }
  }
  if (options.signal?.aborted) {
    throw new OpenSpecCliError("resolve", "execution", "cancelled");
  }
  consumerRoot = canonicalConsumerRoot(consumerRoot);
  options = {
    ...options,
    environment: { ...(options.environment ?? process.env) },
  };
  const invocation = resolveOpenSpecInvocation(
    consumerRoot,
    options.environment,
  );
  // allSettled ensures neither child outlives a failed inspection. Both have
  // bounded time/output; deterministic status-first diagnostics avoid races.
  const results = await Promise.allSettled([
    execute(
      invocation,
      "status",
      ["status", "--change", change, "--json"],
      consumerRoot,
      options,
    ),
    execute(
      invocation,
      "validate",
      ["validate", change, "--strict", "--json", "--no-interactive"],
      consumerRoot,
      options,
    ),
  ]);
  const executions = results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const status = parseJson(executions[0], "status");
  const validation = parseJson(executions[1], "validate");
  const changeRoot = path.resolve(consumerRoot, "openspec", "changes", change);
  const paths = record(status.artifactPaths);
  const artifactPaths: string[] = [];
  let invalidPaths = !paths;
  for (const entry of Object.values(paths ?? {})) {
    const outputs = record(entry)?.existingOutputPaths;
    if (!Array.isArray(outputs)) {
      invalidPaths = true;
      continue;
    }
    for (const candidate of outputs) {
      if (typeof candidate !== "string" || candidate.includes("\0")) {
        invalidPaths = true;
        continue;
      }
      // Relative CLI output is relative to its cwd, not the extension process.
      const resolved = path.resolve(consumerRoot, candidate);
      const relative = path.relative(changeRoot, resolved);
      if (!relative || !inside(changeRoot, resolved)) {
        invalidPaths = true;
        continue;
      }
      artifactPaths.push(relative.split(path.sep).join("/"));
    }
  }
  if (
    status.changeName !== change ||
    typeof status.schemaName !== "string" ||
    !status.schemaName ||
    ("isPlanningComplete" in status &&
      typeof status.isPlanningComplete !== "boolean") ||
    typeof status.isComplete !== "boolean" ||
    invalidPaths ||
    artifactPaths.length === 0
  )
    throw new OpenSpecCliError("status", "protocol", "schema-invalid");
  const items = Array.isArray(validation.items) ? validation.items : [];
  const item = record(items[0]);
  if (
    items.length !== 1 ||
    item?.id !== change ||
    typeof item.valid !== "boolean" ||
    (executions[1].exitCode !== 0 && item.valid)
  ) {
    throw new OpenSpecCliError(
      "validate",
      "protocol",
      "schema-invalid",
      executions[1],
    );
  }
  return {
    change,
    schema: status.schemaName,
    // OpenSpec 1.5.0 reports artifact completion only as isComplete.
    // When a separate planning flag is present, both flags must be true.
    planningComplete: status.isComplete && status.isPlanningComplete !== false,
    strictValid: item.valid,
    artifactPaths: [...new Set(artifactPaths)].sort(),
  };
}
