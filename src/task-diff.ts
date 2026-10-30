import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { gitArguments, gitEnvironment, readBounded } from "./task-store.ts";
import type { ChangeView } from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

const admin = (path: string) =>
  path === ".cadence/assistant/tasks" ||
  path.startsWith(".cadence/assistant/tasks/");
/** Raw output of one Git command hashed whole into the change identity; display text is bounded separately. */
const GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
/** Observes working-copy dirt; never changes the index and never attributes existing dirt to Cadence. */
export function captureChanges(
  root: string,
  outputBytes = GIT_OUTPUT_BYTES,
): ChangeView {
  const deadline = Date.now() + 3000;
  const hash = createHash("sha256");
  const parts: string[] = [];
  let complete = true;
  const limits: string[] = [];
  let fileCount = 0;
  let fileBytes = 0;
  const add = (label: string, data: string | Buffer) => {
    hash.update(label).update("\0").update(data).update("\0");
  };
  // A killed command's partial stdout depends on pipe timing: hashing it gave
  // one unchanged tree a new identity on every observation (every preflight
  // stale). A limited command contributes only its fixed outcome.
  const git = (args: string[]) => {
    let outcome: string;
    if (Date.now() >= deadline) outcome = "time budget exhausted";
    else {
      const result = spawnSync(
        "git",
        gitArguments(["-c", "core.quotepath=true", ...args]),
        {
          cwd: root,
          encoding: "buffer",
          timeout: Math.max(1, deadline - Date.now()),
          maxBuffer: outputBytes,
          windowsHide: true,
          env: gitEnvironment(),
        },
      );
      if (!result.error && result.status === 0)
        return { stdout: result.stdout, limited: false };
      outcome = result.error
        ? ((result.error as NodeJS.ErrnoException).code ?? "error")
        : result.signal
          ? `signal ${result.signal}`
          : `exit ${result.status}`;
    }
    complete = false;
    limits.push(`Unavailable/limited Git observation: ${args[0]} (${outcome})`);
    return { stdout: Buffer.from(`[limited: ${outcome}]`), limited: true };
  };
  const inventory = (name: string) => {
    if (admin(name)) return;
    if (++fileCount > 2000 || Date.now() >= deadline) {
      complete = false;
      return;
    }
    try {
      const path = join(root, name);
      const st = lstatSync(path);
      add(name, `${st.mode}:${st.size}`);
      if (st.isSymbolicLink()) {
        add(name, readlinkSync(path));
        limits.push(`Link target not inspected: ${name}`);
        complete = false;
        return;
      }
      if (
        !st.isFile() ||
        st.size > 1024 * 1024 ||
        fileBytes + st.size > 8 * 1024 * 1024
      ) {
        limits.push(`Not inspected: ${name}`);
        complete = false;
        return;
      }
      const data = readBounded(path, 1024 * 1024);
      if (!data) throw new Error("Disappeared");
      fileBytes += data.length;
      add(name, data);
      const binary = data.includes(0);
      parts.push(
        `${name} (${binary ? "binary" : "text"}, ${data.length} bytes, sha256 ${createHash("sha256").update(data).digest("hex")})`,
      );
    } catch {
      complete = false;
      limits.push(`Unreadable/changing: ${name}`);
    }
  };
  const probe = spawnSync(
    "git",
    gitArguments(["rev-parse", "--is-inside-work-tree"]),
    {
      cwd: root,
      env: gitEnvironment(),
      timeout: 3000,
      maxBuffer: 8192,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const isGit = probe.status === 0 && probe.stdout.trim() === "true";
  if (isGit) {
    const pathspec = [
      "--",
      ".",
      ":(exclude).cadence/assistant/tasks",
      ":(exclude).cadence/assistant/tasks/**",
    ];
    const head = git(["rev-parse", "--verify", "HEAD"]);
    // An unborn repository is visibly incomplete rather than silently inventing a base.
    add("HEAD", head.stdout);
    for (const [label, args] of [
      [
        "Status (includes pre-existing dirt)",
        [
          "status",
          "--porcelain=v1",
          "-uall",
          "--ignore-submodules=none",
          ...pathspec,
        ],
      ],
      [
        "Staged",
        [
          "diff",
          "--cached",
          "--ignore-submodules=none",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          ...pathspec,
        ],
      ],
      [
        "Unstaged",
        [
          "diff",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          "--ignore-submodules=none",
          ...pathspec,
        ],
      ],
    ] as const) {
      const data = git([...args]).stdout;
      add(label, data);
      parts.push(`## ${label}\n${data.toString("utf8")}`);
    }
    // A gitlink describes a commit, not the nested working-copy bytes. Do not
    // present a dirty submodule marker as complete freshness coverage.
    const index = git(["ls-files", "--stage", "-z", ...pathspec]);
    add("Index entries", index.stdout);
    for (const entry of index.stdout.toString("utf8").split("\0")) {
      if (!entry.startsWith("160000 ")) continue;
      complete = false;
      limits.push(
        `Submodule content not inspected: ${entry.slice(entry.indexOf("\t") + 1)}`,
      );
    }
    const untracked = git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      ...pathspec,
    ]);
    parts.push(
      "## Untracked identities (content not automatically sent to model)",
    );
    if (untracked.limited) add("Untracked", untracked.stdout);
    else
      for (const name of untracked.stdout
        .toString("utf8")
        .split("\0")
        .filter(Boolean))
        inventory(name);
    // A wholly ignored directory is one entry: its contents are never
    // inspected, and per-file names (node_modules, .venv) overflowed the bound.
    const ignored = git([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "--no-empty-directory",
      "-z",
      ...pathspec,
    ]);
    if (ignored.stdout.length) {
      complete = false;
      if (!ignored.limited)
        limits.push(
          "Ignored files exist and are not inspected; review coverage is incomplete.",
        );
      add("ignored paths", ignored.stdout);
    }
    parts.push(
      "Administrative .cadence/assistant/tasks records are excluded from business freshness; configuration is not excluded.",
    );
  } else {
    parts.push(
      "Non-Git bounded regular-file inventory; no staged/unstaged distinction. Excludes .git and Cadence task records. Content identities, not a transactional snapshot.",
    );
    if (
      probe.error ||
      (probe.status !== 0 && !probe.stderr?.includes("not a git repository"))
    ) {
      complete = false;
      limits.push(
        "Git availability/lookup uncertain; using bounded inventory.",
      );
    }
    const walk = (dir: string, depth: number) => {
      if (depth > 16 || fileCount > 2000 || Date.now() >= deadline) {
        complete = false;
        return;
      }
      let names: string[];
      try {
        names = readdirSync(dir).sort();
      } catch {
        complete = false;
        return;
      }
      for (const name of names) {
        const path = join(dir, name);
        const rel = relative(root, path).split("\\").join("/");
        if (rel === ".git" || admin(rel)) continue;
        if (++fileCount > 2000 || Date.now() >= deadline) {
          complete = false;
          break;
        }
        try {
          const st = lstatSync(path);
          if (st.isDirectory()) walk(path, depth + 1);
          else inventory(rel);
        } catch {
          complete = false;
          limits.push(`Unreadable: ${rel}`);
        }
      }
    };
    walk(root, 0);
  }
  if (!complete)
    limits.push(
      "Coverage incomplete: bounds, ignored files, links, or unavailable observations. Human review cannot certify unobserved files.",
    );
  parts.push(
    "Display strips terminal controls and redacts secret-like values; fingerprints use raw observed bytes. Not a literal complete patch or a sandbox snapshot.",
  );
  const raw = [...parts, ...limits].join("\n");
  const text = diagnosticText(raw, 128 * 1024);
  if (Buffer.byteLength(raw) > 128 * 1024) complete = false;
  add("coverage", String(complete));
  return { fingerprint: hash.digest("hex"), text, complete, git: isGit };
}
