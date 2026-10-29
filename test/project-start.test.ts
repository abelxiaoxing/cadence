import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { captureChanges } from "../src/task-diff.ts";
import {
  gitEnvironment,
  privateWorkspace,
  resolveWorkspace,
  TaskStore,
} from "../src/task-store.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => {
        stdout += b;
      });
      child.stderr.on("data", (b) => {
        stderr += b;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

it("never creates a project in the reserved private namespace, even with --create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "project-private-")),
    state = join(dir, "state");
  const path = join(state, "cadence-assistant-v1", "do-not-create");
  expect(privateWorkspace(path, state)).toBe(true);
  const result = await run(
    ["project", "open", path, "--create", "--state-home", state],
    dir,
    {
      ...windowsSystemEnvironment(),
      PATH: process.env.PATH,
      HOME: dir,
      USERPROFILE: dir,
    },
  );
  expect(result.code).toBe(1);
  expect(existsSync(state)).toBe(false);
  mkdirSync(path, { recursive: true });
  expect(() => new TaskStore(path, state)).toThrow(
    "Private state cannot be a workspace",
  );
});

it.skipIf(process.platform === "win32")(
  "root observes its owned repository with fsmonitor disabled and without rewriting Git configuration",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "root-git-owned-")),
      root = join(dir, "project"),
      nested = join(root, "nested");
    mkdirSync(nested, { recursive: true });
    expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
    const marker = join(dir, "fsmonitor-must-not-run");
    const script = join(dir, "fsmonitor.sh");
    writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    const path = join(root, ".git", "config");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\n[core]\n\tfsmonitor = ${script}\n`,
    );
    const config = readFileSync(path);
    vi.spyOn(process, "getuid").mockReturnValue(0);
    expect(resolveWorkspace(nested)).toEqual({ root, cwd: nested });
    expect(captureChanges(root).git).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(path)).toEqual(config);
  },
);

it.skipIf(process.platform === "win32").each(["clean", "process"])(
  "root never implicitly trusts a foreign repository that can execute a %s filter",
  (filter) => {
    const dir = mkdtempSync(join(tmpdir(), "root-git-foreign-")),
      root = join(dir, "project"),
      nested = join(root, "nested"),
      bin = join(dir, "bin");
    mkdirSync(nested, { recursive: true });
    mkdirSync(bin);
    const git = spawnSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).stdout.trim();
    expect(git.startsWith("/")).toBe(true);
    expect(spawnSync(git, ["init", "-q"], { cwd: root }).status).toBe(0);
    writeFileSync(join(root, "file.txt"), "original\n");
    writeFileSync(join(root, ".gitattributes"), "file.txt filter=fixture\n");
    expect(spawnSync(git, ["add", "."], { cwd: root }).status).toBe(0);
    const marker = join(dir, "filter-must-not-run"),
      script = join(dir, "filter.sh"),
      path = join(root, ".git", "config");
    writeFileSync(
      script,
      `#!/bin/sh\ntouch '${marker}'\n${filter === "clean" ? "cat" : "exit 1"}\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\n[filter "fixture"]\n\t${filter} = ${script}\n`,
    );
    writeFileSync(join(root, "file.txt"), "changed content\n");
    const config = readFileSync(path);
    // Real Git's seam simulates a foreign checkout without chown or sudo.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nGIT_TEST_ASSUME_DIFFERENT_OWNER=1 exec '${git}' "$@"\n`,
      { mode: 0o700 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("HOME", dir);
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    const uid = vi.spyOn(process, "getuid");
    for (const account of [1000, 0]) {
      uid.mockReturnValue(account);
      expect(() => resolveWorkspace(nested)).toThrow(
        "Git workspace lookup refused",
      );
      expect(captureChanges(root)).toMatchObject({
        git: false,
        complete: false,
      });
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(path)).toEqual(config);
    }
    // Even an ambient wildcard is not a grant to run another account's filters
    // during root observation. Leave the user's configuration bytes untouched.
    const global = join(dir, ".gitconfig");
    writeFileSync(global, "[safe]\n\tdirectory = *\n");
    uid.mockReturnValue(0);
    expect(() => resolveWorkspace(nested)).toThrow(
      "Git workspace lookup refused",
    );
    expect(captureChanges(root)).toMatchObject({ git: false, complete: false });
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(global, "utf8")).toBe("[safe]\n\tdirectory = *\n");
  },
);

it.skipIf(process.platform === "win32")(
  "root Git observations never inherit sudo's alternate ownership trust",
  () => {
    vi.stubEnv("SUDO_UID", "1234");
    vi.spyOn(process, "getuid").mockReturnValue(0);
    expect(gitEnvironment()).not.toHaveProperty("SUDO_UID");
  },
);
