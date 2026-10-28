import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnection } from "../src/native-client.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import { effectiveWorkspace, stateHomeInside } from "../src/task-store.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  // Windows can release an exited owner's handles a moment after its exit.
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
/** Stop confirms before the detached owner process exits, and that process
 * runs in the landing: Windows cannot remove a live process's directory. */
async function ownerExit(pid: number): Promise<void> {
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it("keeps explicit projects but refuses private-state ancestors without redirecting or creating a default directory", () => {
  const f = fakeHome();
  const state = join(f.home, ".local", "state");
  const project = join(f.home, "projects", "app");
  mkdirSync(project, { recursive: true });
  expect(stateHomeInside(f.home, state)).toBe(true);
  expect(() => effectiveWorkspace(f.home, state)).toThrow();
  expect(() => effectiveWorkspace(f.dir, state)).toThrow();
  expect(effectiveWorkspace(project, state)).toEqual({
    workspace: project,
    redirected: false,
  });
  expect(effectiveWorkspace(f.home, join(f.dir, "state"))).toEqual({
    workspace: f.home,
    redirected: false,
  });
  expect(existsSync(f.landing)).toBe(false);
});

it("start without a project opens only the workbench; readonly/native/home requests never create ~/cadence", async () => {
  const f = fakeHome();
  expect(JSON.parse((await run(f, ["status"])).stdout)).toEqual({
    status: "absent",
  });
  expect(existsSync(f.landing)).toBe(false);
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const port = address.port;
  await new Promise<void>((r) => server.close(() => r()));
  const config = join(f.home, ".pi/agent/cadence/.env");
  mkdirSync(join(config, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(
    config,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=${"isolated-workbench-".repeat(3)}\n`,
    { mode: 0o600 },
  );
  const state = join(
    f.home,
    process.platform === "win32" ? "AppData/Local" : ".local/state",
  );
  let started = false,
    pid = 0;
  try {
    const start = await run(f, ["start"]);
    expect(start.code, start.stdout + start.stderr).toBe(0);
    expect(JSON.parse(start.stdout).status).toBe("alive");
    started = true;
    const store = new GatewayStore(config, state);
    pid = store.read()?.pid ?? 0;
    expect(store.projects()).toEqual([]);
    expect(existsSync(f.landing)).toBe(false);
    expect(start.stderr).toContain(
      "No project or default workspace was created",
    );
    expect((await run(f, ["status", "--workspace", f.home])).code).toBe(1);
    expect((await run(f, ["project", "open", f.home])).code).toBe(1);
    vi.stubEnv("HOME", f.home);
    vi.stubEnv("USERPROFILE", f.home);
    vi.stubEnv("XDG_STATE_HOME", undefined);
    vi.stubEnv("LOCALAPPDATA", undefined);
    const connection = new NativeConnection();
    await expect(connection.attach(f.home)).rejects.toThrow();
    await connection.detach();
    expect(existsSync(f.landing)).toBe(false);
  } finally {
    if (started) {
      expect(JSON.parse((await run(f, ["stop"])).stdout).status).toBe(
        "stopped",
      );
      if (pid && process.platform === "win32") await ownerExit(pid);
    }
  }
}, 30000);
