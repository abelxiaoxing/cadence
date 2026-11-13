/** Run-owned scratch space, not model configuration or a second executor.
 * Constructing this helper does nothing. Only an admitted delivery may use it. */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  realpathSync,
  statfsSync,
  statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gitArguments, gitEnvironment } from "../git-environment.mjs";

export const RUN_ENVIRONMENT_POLICY =
  "Service runtime: after approval, Cadence creates private temporary directories outside Git working copies on each execution workspace's disk and supplies TMPDIR, TEMP and TMP to its checks and workers. Each workspace keeps its directory through recovery; parallel workspaces are isolated. Only these owned temporary directories may be removed after successful work and confirmed worker/check closure; the run stays active through cleanup, and cancellation retains remaining roots. No dependency installation, profile or credential copying, service restart or other external writes are authorized by this policy.";

export type TemporaryEnvironment = Readonly<{
  TMPDIR: string;
  TEMP: string;
  TMP: string;
}>;
export function temporaryEnvironment(path: string): TemporaryEnvironment {
  return Object.freeze({ TMPDIR: path, TEMP: path, TMP: path });
}
const within = (root: string, path: string) => {
  const tail = relative(root, path);
  return (
    !tail ||
    (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`))
  );
};
function outsideGit(path: string): void {
  const result = spawnSync(
    "git",
    gitArguments(["rev-parse", "--absolute-git-dir"]),
    {
      cwd: path,
      env: gitEnvironment(),
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4096,
      windowsHide: true,
    },
  );
  if (
    result.error ||
    result.signal ||
    result.status !== 128 ||
    !result.stderr.includes("not a git repository")
  )
    throw new Error(
      "location is inside Git or Git could not establish that it is outside",
    );
}
/** Shared with the repository verification guard. Observes only; never creates,
 * repairs permissions, redirects a caller or adopts an existing directory. */
export function assertTemporaryDirectory(
  root: string,
  path: string,
  privateMode = true,
): void {
  const entry = lstatSync(path);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    realpathSync(path) !== path
  )
    throw new Error("temporary location must be a real canonical directory");
  if (
    privateMode &&
    process.platform !== "win32" &&
    ((entry.mode & 0o777) !== 0o700 || entry.uid !== process.getuid?.())
  )
    throw new Error(
      "temporary directory must be private (0700) and owned by this account",
    );
  if (entry.dev !== statSync(root).dev || statfsSync(path).type === 0x01021994)
    throw new Error(
      "temporary location must be on the workspace's disk, not tmpfs",
    );
  if (within(realpathSync(root), path))
    throw new Error(
      "temporary location must be outside the execution workspace",
    );
  outsideGit(path);
}
interface Directory {
  workspace: string;
  path: string;
  /** Null is a recorded creation intent, never permission to adopt/delete. */
  identity: { dev: number; ino: number; birthtimeMs: number } | null;
  removed: boolean;
}
export class RunEnvironment {
  private readonly directories = new Map<string, Directory>();
  private readonly stateHome: string;
  private readonly checkout: string;
  private readonly record: (directories: readonly Directory[]) => void;
  private readonly assertCurrent: () => void;
  constructor(
    stateHome: string,
    checkout: string,
    record: (directories: readonly Directory[]) => void,
    assertCurrent: () => void,
  ) {
    this.stateHome = stateHome;
    this.checkout = checkout;
    this.record = record;
    this.assertCurrent = assertCurrent;
  }
  private save() {
    this.record([...this.directories.values()].map((d) => ({ ...d })));
  }
  private assertOwned(d: Directory) {
    this.assertCurrent();
    const entry = lstatSync(d.path);
    if (
      !d.identity ||
      d.removed ||
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      realpathSync(d.path) !== d.path ||
      entry.dev !== d.identity.dev ||
      entry.ino !== d.identity.ino ||
      entry.birthtimeMs !== d.identity.birthtimeMs ||
      (process.platform !== "win32" &&
        (entry.uid !== process.getuid?.() || (entry.mode & 0o777) !== 0o700))
    )
      throw new Error(
        "owned temporary directory changed; it was not recreated or adopted",
      );
  }
  /** One directory per execution workspace, not per command or retry. No
   * inherited TMPDIR is adopted. The two candidates are existing directories,
   * not a host scan, and neither may be in the service's private namespace. */
  forWorkspace(workspace: string): TemporaryEnvironment {
    this.assertCurrent();
    const cwd = realpathSync(workspace);
    const previous = this.directories.get(cwd);
    if (previous) {
      this.assertOwned(previous);
      assertTemporaryDirectory(cwd, previous.path);
      return temporaryEnvironment(previous.path);
    }
    const candidates = [...new Set([resolve(this.stateHome), dirname(cwd)])];
    const reasons: string[] = [];
    let parent: string | undefined;
    for (const candidate of candidates) {
      try {
        if (
          within(this.checkout, candidate) ||
          within(join(this.stateHome, "cadence-assistant-v1"), candidate)
        )
          throw new Error(
            "location is in the checkout or private service state",
          );
        assertTemporaryDirectory(cwd, candidate, false);
        accessSync(candidate, constants.W_OK | constants.X_OK);
        parent = candidate;
        break;
      } catch (error) {
        reasons.push(
          `${candidate}: ${error instanceof Error ? error.message : "unavailable"}`,
        );
      }
    }
    if (!parent)
      throw new Error(
        `Execution environment unavailable: no writable, same-disk temporary location outside Git. ${reasons.join("; ")}`,
      );
    const directory: Directory = {
      workspace: cwd,
      path: join(parent, `cadence-run-${randomUUID()}`),
      identity: null,
      removed: false,
    };
    this.directories.set(cwd, directory);
    this.save(); // Durable intent before effects; a failed record creates nothing.
    this.assertCurrent();
    try {
      mkdirSync(directory.path, { mode: 0o700 }); // Exclusive creation, never reuse.
      const entry = lstatSync(directory.path);
      directory.identity = {
        dev: entry.dev,
        ino: entry.ino,
        birthtimeMs: entry.birthtimeMs,
      };
      this.assertOwned(directory);
      assertTemporaryDirectory(cwd, directory.path);
    } catch (error) {
      throw new Error(
        `Execution environment unavailable: could not prepare ${directory.path}; nothing was replayed. ${error instanceof Error ? error.message : "unavailable"}`,
      );
    }
    this.save();
    return temporaryEnvironment(directory.path);
  }
  /** Called only after the run's original workers, checks and recording join.
   * Failed/canceled/unknown runs keep scratch evidence. Never sweep old runs. */
  async finish(remove: boolean): Promise<string[]> {
    for (const directory of this.directories.values()) {
      if (!remove || directory.removed || !directory.identity) continue;
      try {
        this.assertOwned(directory);
        await rm(directory.path, { recursive: true, force: false });
      } catch {
        continue; // Changed/undeletable roots stay visible, never forced/adopted.
      }
      directory.removed = true;
      this.save();
    }
    return [...this.directories.values()]
      .filter((d) => !d.removed)
      .map((d) => d.path);
  }
}
