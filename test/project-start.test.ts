import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { stopService } from "../src/service/cli.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceClient } from "../src/service-client.ts";
import type { Action, Reply } from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { captureChanges } from "../src/task-diff.ts";
import {
  gitEnvironment,
  privateWorkspace,
  resolveWorkspace,
  TaskStore,
} from "../src/task-store.ts";
import { confirm, prepare } from "../web/src/client/actions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { nativeBuild } from "./helpers/source-build.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function ok<T>(reply: Reply<T>): T {
  expect(reply.kind, JSON.stringify(reply)).toBe("ok");
  if (reply.kind !== "ok") throw Error("fixture refusal");
  return reply.value;
}
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
it("opens independent directory owners on selected free ports while the first SDK run continues; new code tasks bind the new cwd", async () => {
  const f = await acceptingFixture("generated");
  const state = join(f.dir, "state"),
    project = join(f.dir, "another project 漢");
  const env = {
    ...windowsSystemEnvironment(),
    PATH: process.env.PATH,
    HOME: join(f.dir, "home"),
    USERPROFILE: join(f.dir, "home"),
    TMPDIR: join(f.dir, "tmp"),
    TEMP: join(f.dir, "tmp"),
    TMP: join(f.dir, "tmp"),
  };
  let other: ServiceCoordination | undefined,
    transport: HttpServiceTransport | undefined;
  const choose = async (client: ServiceClient) => {
    const catalog = ok(await client.models());
    ok(
      await client.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
  };
  const submit = async (
    client: ServiceClient,
    storeId: string,
    action: Action,
  ) => {
    const view = ok(
      await client.current({
        storeId,
        taskId: action.kind === "create" ? null : action.taskId,
      }),
    );
    if (view.context.status !== "available") throw Error("fixture context");
    const receipt = ok(
      await confirm(
        client,
        ok(await prepare(client, view.context.version, action)),
      ),
    );
    await expect
      .poll(
        async () => {
          const lookup = await client.receipt(receipt.commandId);
          return (
            lookup.status === "found" &&
            (action.kind === "start" ||
              lookup.receipt.publication === "published")
          );
        },
        { timeout: 15000, interval: 50 },
      )
      .toBe(true);
    return receipt;
  };
  try {
    const a = ok(await f.client.session());
    await choose(f.client);
    const created = await submit(f.client, a.storeId, {
      kind: "create",
      taskKind: "research",
      goal: "Keep this original readonly episode running",
    });
    if (!created.created) throw Error("fixture task");
    f.mode("pending");
    const active = await submit(f.client, a.storeId, {
      kind: "start",
      taskId: created.created.taskId,
    });
    await expect.poll(f.contacts, { timeout: 15000, interval: 50 }).toBe(1);
    const args = [
      "project",
      "open",
      project,
      "--agent-dir",
      join(f.dir, "agent"),
      "--state-home",
      state,
    ];
    const missing = await run(args, f.root, env);
    expect(missing.code).toBe(1);
    expect(existsSync(project)).toBe(false);
    const opened = await run([...args, "--create"], f.root, env);
    expect(opened.code, opened.stderr).toBe(0);
    const first = JSON.parse(opened.stdout);
    expect(first).toMatchObject({
      status: "alive",
      actions: false,
      workspace: project,
      cwd: project,
    });
    expect(first.endpoint).not.toBe(f.endpoint);
    expect(first.endpoint).not.toContain(":0");
    expect(opened.stderr).toContain("Private WebUI link:");
    expect(opened.stdout).not.toContain("token=");
    expect(existsSync(join(project, ".cadence", "assistant", "tasks"))).toBe(
      false,
    );
    other = new ServiceCoordination(project, state);
    const access = other.localAccess();
    transport = new HttpServiceTransport({
      origin: access.endpoint,
      localCapability: access.capability,
      build: nativeBuild,
    });
    const client = new ServiceClient(transport),
      b = ok(await client.session());
    expect(b.storeId).not.toBe(a.storeId);
    await choose(client);
    const code = await submit(client, b.storeId, {
      kind: "create",
      taskKind: "code",
      goal: "New engineering task in the selected folder",
    });
    if (!code.created) throw Error("fixture code task");
    const summary = JSON.parse(
      readFileSync(
        join(
          project,
          ".cadence",
          "assistant",
          "tasks",
          code.created.taskId,
          "task.json",
        ),
        "utf8",
      ),
    );
    expect(summary.cwd).toBe(project);
    expect(summary.phase).toBe("planning");
    const reopened = await run(args, f.root, env);
    expect(reopened.code, reopened.stderr).toBe(0);
    expect(JSON.parse(reopened.stdout)).toMatchObject({
      epoch: first.epoch,
      endpoint: first.endpoint,
      cwd: project,
    });
    const roster = ok(await f.client.activeRuns());
    expect(
      roster.status === "complete" &&
        roster.runs.some((r) => r.runId === active.runId),
    ).toBe(true);
    expect(f.contacts()).toBe(1); // Opening/reopening/creating a task never prompts a model.
    const overlap = await run(
      [
        "project",
        "open",
        join(project, "nested"),
        "--create",
        "--agent-dir",
        join(f.dir, "agent"),
        "--state-home",
        state,
      ],
      f.root,
      env,
    );
    expect(overlap.code).toBe(1);
    expect(other.localAccess().epoch).toBe(first.epoch);
    if (!active.runId) throw Error("fixture run");
    ok(
      await f.client.cancel({
        commandId: randomUUID(),
        epoch: a.epoch,
        runId: active.runId,
      }),
    );
    await expect
      .poll(
        async () => {
          const lookup = await f.client.receipt(active.commandId);
          const remaining = ok(await f.client.activeRuns());
          return (
            lookup.status === "found" &&
            lookup.receipt.execution === "canceled" &&
            remaining.status === "complete" &&
            !remaining.runs.some((r) => r.runId === active.runId)
          );
        },
        { timeout: 15000, interval: 50 },
      )
      .toBe(true);
  } finally {
    await transport?.detach();
    if (other) expect((await stopService(other)).status).toBe("stopped");
    await f.close();
  }
}, 60000);

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
