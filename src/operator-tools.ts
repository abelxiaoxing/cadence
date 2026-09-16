import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executionProfile } from "./execution-profile.ts";
import { resolveOpenSpecInvocation } from "./openspec-cli.ts";
import { resolveStateRoot } from "./state-root.ts";
import { requestBounds } from "./transport-budget.ts";
import { validateVerificationAdapterCapability } from "./verification-capability.ts";
import { probeWindowsJob } from "./windows-job-backend.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  nextStep?: string;
}
const PACKAGE_LOCKS = {
  bun: ["bun.lock", "bun.lockb"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
} as const;
type PackageManager = keyof typeof PACKAGE_LOCKS;

function packageManagerSelection(root: string, declaration: unknown) {
  const managers = Object.keys(PACKAGE_LOCKS) as PackageManager[];
  const lockfiles = managers.flatMap((manager) =>
    PACKAGE_LOCKS[manager].filter((file) =>
      lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile(),
    ),
  );
  const inferred = managers.filter((manager) =>
    PACKAGE_LOCKS[manager].some((file) => lockfiles.includes(file)),
  );
  const declared =
    typeof declaration === "string"
      ? managers.find((manager) =>
          new RegExp(
            `^${manager}@[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][a-z0-9._+-]+)?$`,
            "iu",
          ).test(declaration),
        )
      : undefined;
  const selectedPackageManager =
    declaration !== undefined
      ? (declared ?? null)
      : inferred.length === 1
        ? (inferred[0] ?? null)
        : inferred.length > 1
          ? null
          : "npm";
  const selectionSource =
    declaration !== undefined
      ? declared
        ? "package.json"
        : "invalid-declaration"
      : inferred.length === 1
        ? "lockfile"
        : inferred.length > 1
          ? "ambiguous"
          : "default";
  return {
    selectedPackageManager,
    selectionSource,
    lockfiles,
    ambiguousLockfiles: inferred.length > 1,
  };
}

export function inspectConsumer(root: string) {
  root = realpathSync(root);
  const checks: DoctorCheck[] = [];
  const check = (name: string, action: () => string, nextStep: string) => {
    try {
      checks.push({ name, ok: true, detail: action() });
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : "unavailable",
        nextStep,
      });
    }
  };
  check(
    "node",
    () => {
      if (
        Number(process.versions.node.split(".")[0]) < 22 ||
        (Number(process.versions.node.split(".")[0]) === 22 &&
          Number(process.versions.node.split(".")[1]) < 13)
      )
        throw new Error("Node 22.13+ required");
      return process.versions.node;
    },
    "Install Node >=22.13.",
  );
  check(
    "git",
    () => {
      const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
      });
      if (result.status !== 0) throw new Error("git-repository-unavailable");
      return result.stdout.trim();
    },
    "Install Git and initialize the consumer repository.",
  );
  check(
    "openspec",
    () => {
      resolveOpenSpecInvocation(root);
      return "resolved (protocol not executed)";
    },
    "Install @fission-ai/openspec@1.5.0, or configure ABEL_OPENSPEC_PACKAGE_ROOT / ABEL_OPENSPEC_NODE before launching the host.",
  );
  check(
    "execution",
    () => {
      const profile = executionProfile();
      if (profile.mode === "host-trusted") {
        if (!probeWindowsJob(profile.windowsHelperPath ?? ""))
          throw new Error("windows-job-backend-unavailable");
        return "host-trusted: Windows x64 Job probe passed; host files/network accessible";
      }
      if (process.platform !== "linux")
        throw new Error("linux-pid-isolation-required");

      const result = spawnSync(
        profile.bwrapPath,
        [
          "--ro-bind",
          "/",
          "/",
          profile.mode === "local-trusted" ? "--unshare-pid" : "--unshare-all",
          "--",
          "/bin/true",
        ],
        { timeout: 5000, encoding: "utf8", maxBuffer: 65536 },
      );
      if (result.status !== 0) throw new Error("bubblewrap-probe-failed");
      return `${profile.mode}: Bubblewrap PID namespace probe passed`;
    },
    "On Linux install/enable Bubblewrap; set ABEL_BWRAP_PATH for a custom install. Trusted Linux projects may explicitly set ABEL_EXECUTION_MODE=local-trusted; Windows x64 trusted projects may explicitly select ABEL_EXECUTION_MODE=host-trusted and install the matching native Job helper (ABEL_WINDOWS_JOB_HELPER).",
  );
  check(
    "request-budgets",
    () => JSON.stringify(requestBounds()),
    "Set ABEL_FIRST_PROGRESS_MS and ABEL_STREAM_IDLE_MS to positive milliseconds <=1200000.",
  );
  check(
    "state-root",
    () =>
      resolveStateRoot({
        consumerRoot: root,
        xdgStateHome: process.env.XDG_STATE_HOME,
      }).rootDir,
    "Use an absolute repository-external XDG_STATE_HOME.",
  );
  check(
    "workspace-dependencies",
    () => {
      const dependencies = path.join(root, "node_modules");
      if (!lstatSync(dependencies, { throwIfNoEntry: false }))
        return "no node_modules; prepare dependencies before verification";
      const names = readdirSync(dependencies).flatMap((name) =>
        name.startsWith("@") &&
        lstatSync(path.join(dependencies, name)).isDirectory()
          ? readdirSync(path.join(dependencies, name)).map(
              (child) => `${name}/${child}`,
            )
          : [name],
      );
      if (names.length > 20_000) throw new Error("dependency-view-too-large");
      let links = 0;
      for (const name of names) {
        const file = path.join(dependencies, name);
        if (!lstatSync(file).isSymbolicLink()) continue;
        const resolved = realpathSync(file);
        const relative = path.relative(root, resolved);
        if (
          relative === ".." ||
          relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)
        )
          throw new Error("dependency-link-outside-consumer");
        if (!resolved.startsWith(`${dependencies}${path.sep}`)) links++;
      }
      return `${links} repository workspace link(s); their targets must be included in the candidate baseline`;
    },
    "Repair dangling/external workspace links and ensure local package sources are tracked or admitted in the candidate.",
  );
  const manifest = path.join(root, "package.json");
  let selection = packageManagerSelection(root, undefined);
  if (lstatSync(manifest, { throwIfNoEntry: false })?.isFile()) {
    check(
      "manifest",
      () => {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"));
        if (!parsed || typeof parsed !== "object")
          throw new Error("manifest-invalid");
        return (
          Object.keys(parsed.scripts ?? {}).join(", ") || "no package scripts"
        );
      },
      "Repair package.json.",
    );
    const parsed = (() => {
      try {
        const value = JSON.parse(readFileSync(manifest, "utf8"));
        return value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      } catch {
        return {};
      }
    })();
    selection = packageManagerSelection(root, parsed.packageManager);
    check(
      "package-manager",
      () => {
        if (!selection.selectedPackageManager)
          throw new Error(`package-manager-${selection.selectionSource}`);
        return `${selection.selectedPackageManager} (${selection.selectionSource})`;
      },
      "Declare the intended packageManager in package.json; doctor does not read private plans, install runners or remove lockfiles.",
    );
    for (const script of ["test", "check", "build"].filter(
      (name) => typeof parsed.scripts?.[name] === "string",
    )) {
      check(
        `script:${script}`,
        () => {
          const manager = selection.selectedPackageManager;
          if (!manager)
            throw new Error(`package-manager-${selection.selectionSource}`);
          const result = validateVerificationAdapterCapability(root, {
            kind: "package-script",
            id: `doctor-${script}`,
            packageManager: manager,
            script,
            command: parsed.scripts[script],
            args: [],
            classification: "expected-green",
          });
          if (!result.ok)
            throw new Error(`${manager}:${result.diagnostic.code}`);
          return "statically admitted; tests not executed";
        },
        "Check the runner, installed dependencies and execution configuration; this probe does not execute your tests.",
      );
    }
  }
  return { root, ...selection, ok: checks.every((entry) => entry.ok), checks };
}

/** Bounded metadata traversal, no symlink following and no automatic deletion. */
export function storageUsage(root: string, maximum = 100_000) {
  let entries = 0;
  let bytes = 0;
  let truncated = false;
  const visit = (file: string) => {
    if (entries >= maximum) {
      truncated = true;
      return;
    }
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return;
    entries++;
    if (stat.isFile()) bytes += stat.size;
    else if (stat.isDirectory())
      for (const name of readdirSync(file)) {
        visit(path.join(file, name));
        if (truncated) break;
      }
  };
  visit(root);
  return { entries, bytes, truncated };
}

export function inspectRuns(root: string) {
  const state = resolveStateRoot({
    consumerRoot: root,
    xdgStateHome: process.env.XDG_STATE_HOME,
  });
  const usage = storageUsage(state.rootDir);
  if (!lstatSync(state.databasePath, { throwIfNoEntry: false }))
    return { stateRoot: state.rootDir, usage, runs: [], truncated: false };
  const db = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT run_id, stage, change_name, state, sequence FROM runs ORDER BY run_id LIMIT 1001",
      )
      .all();
    return {
      stateRoot: state.rootDir,
      usage,
      runs: rows.slice(0, 1000),
      truncated: rows.length > 1000,
    };
  } finally {
    db.close();
  }
}
