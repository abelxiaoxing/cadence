import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnection } from "../src/native-client.ts";
import { effectiveWorkspace, stateHomeInside } from "../src/task-store.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  // A just-stopped Windows service can still hold its directory briefly.
  for (const root of roots.splice(0))
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
});

/** A home directory whose default private state home (~/.local/state) is
 * inside it, exactly like %USERPROFILE% with %LOCALAPPDATA% on Windows. */
function fakeHome() {
  const dir = mkdtempSync(join(tmpdir(), "cadence-landing-"));
  roots.push(dir);
  const home = join(dir, "home");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  for (const d of [dir, home, join(home, ".pi"), agent]) chmodSync(d, 0o700);
  writeFileSync(join(agent, "auth.json"), "{}", { mode: 0o600 });
  mkdirSync(join(dir, "tmp"), { mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH,
    TMPDIR: join(dir, "tmp"),
    TEMP: join(dir, "tmp"),
    TMP: join(dir, "tmp"),
    NO_COLOR: "1",
  };
  Object.assign(env, windowsSystemEnvironment());
  return { dir, home, env, landing: join(home, "cadence") };
}
function run(
  f: ReturnType<typeof fakeHome>,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: f.home,
      env: f.env,
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
  });
}

it("keeps project directories and redirects only the home directory and its ancestors", () => {
  const f = fakeHome();
  const state = join(f.home, ".local", "state");
  const project = join(f.home, "projects", "app");
  mkdirSync(project, { recursive: true });
  expect(stateHomeInside(f.home, state)).toBe(true);
  expect(effectiveWorkspace(f.home, state, f.home)).toEqual({
    workspace: f.landing,
    redirected: true,
  });
  expect(effectiveWorkspace(f.dir, state, f.home).redirected).toBe(true);
  expect(effectiveWorkspace(project, state, f.home)).toEqual({
    workspace: project,
    redirected: false,
  });
  // A state home moved outside the home directory leaves home usable as given.
  const outside = join(f.dir, "state");
  expect(effectiveWorkspace(f.home, outside, f.home)).toEqual({
    workspace: f.home,
    redirected: false,
  });
  // Observation never creates the landing.
  expect(existsSync(f.landing)).toBe(false);
});

it("start from the home directory lands on ~/cadence; status, explicit --workspace, native attach and stop reach the same owner", async () => {
  const f = fakeHome();
  const before = await run(f, ["status"]);
  expect(before.code).toBe(0);
  expect(JSON.parse(before.stdout)).toEqual({
    status: "absent",
    workspace: f.landing,
  });
  expect(existsSync(f.landing)).toBe(false);
  let started = false;
  try {
    const start = await run(f, ["start", "--port", "0"]);
    expect(start.stderr).toBe("");
    expect(start.code, start.stdout).toBe(0);
    const alive = JSON.parse(start.stdout);
    started = true;
    expect(alive).toMatchObject({ status: "alive", workspace: f.landing });
    expect(existsSync(f.landing)).toBe(true);

    // An explicit home directory is redirected too, with one informational line.
    const explicit = await run(f, ["status", "--workspace", f.home]);
    expect(explicit.code).toBe(0);
    expect(explicit.stderr).toBe(
      `Cadence workspace: ${f.landing} (${f.home} contains Cadence's private state)\n`,
    );
    expect(JSON.parse(explicit.stdout)).toMatchObject({
      status: "alive",
      epoch: alive.epoch,
      workspace: f.landing,
    });

    // Pi started in the home directory attaches to the same landing owner.
    // os.homedir() reads HOME on POSIX and USERPROFILE on Windows; the default
    // state home is XDG_STATE_HOME or LOCALAPPDATA, both inside this home.
    vi.stubEnv("HOME", f.home);
    vi.stubEnv("USERPROFILE", f.home);
    vi.stubEnv("XDG_STATE_HOME", undefined);
    vi.stubEnv("LOCALAPPDATA", undefined);
    const connection = new NativeConnection();
    try {
      await connection.attach(f.home);
      expect(connection.session?.authority).toBe("local");
      expect(connection.session?.epoch).toBe(alive.epoch);
    } finally {
      await connection.detach();
    }

    // A real project keeps its own identity: nothing there is redirected.
    const project = join(f.home, "projects", "app");
    mkdirSync(project, { recursive: true });
    const projectStatus = await run(f, ["status", "--workspace", project]);
    expect(JSON.parse(projectStatus.stdout)).toEqual({ status: "absent" });
  } finally {
    if (started) {
      const stop = await run(f, ["stop"]);
      expect(JSON.parse(stop.stdout)).toMatchObject({
        status: "stopped",
        workspace: f.landing,
      });
    }
  }
}, 30000);
