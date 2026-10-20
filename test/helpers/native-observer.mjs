import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Additional real Pi readonly observer; existing four HTTP4 PTYs stay unchanged. */
export async function nativeObserver(fixture, runId) {
  const repo = resolve(import.meta.dirname, "../..");
  const root = join(fixture.dir, "mixed-pi");
  mkdirSync(root, { mode: 0o700 });
  const agent = join(fixture.dir, "agent");
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      quietStartup: true,
      cacheWarming: "off",
      retry: { enabled: false },
      compaction: { enabled: false },
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
      enableInstallTelemetry: false,
      defaultProjectTrust: "always",
    }),
    { flag: "wx", mode: 0o600 },
  );
  const config = join(root, "pty.json");
  const env = {
    PATH: process.env.PATH,
    HOME: join(fixture.dir, "home"),
    USERPROFILE: join(fixture.dir, "home"),
    XDG_STATE_HOME: join(fixture.dir, "state"),
    PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    JITI_FS_CACHE: "0",
    NODE_DISABLE_COMPILE_CACHE: "1",
    TERM: "xterm-256color",
    TMPDIR: root,
    TMP: root,
    TEMP: root,
  };
  writeFileSync(
    config,
    JSON.stringify({
      root,
      cwd: fixture.root,
      controlFd: 3,
      readonlyObserverRun: runId,
      env,
      argv: [
        process.execPath,
        join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--offline",
        "--approve",
        "--no-context-files",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-session",
        "--provider",
        "fixture",
        "--model",
        "fixed",
        "--extension",
        join(process.env.CADENCE_TEST_PACKAGE_ROOT ?? repo, "src/index.ts"),
      ],
      steps: [
        { expect: "Context7", send: ["/cadence", "\r"] },
        {
          expect: "Cadence service",
          send: ["\x1b[B", "\x1b[B", "\x1b[B", "\r"],
        },
        { expect: runId, send: ["\x1b"] },
        { expect: "Cadence service", send: ["\x1b"] },
        { expect: "detached locally", send: ["/quit", "\r"] },
      ],
    }),
    { mode: 0o600 },
  );
  const driver = spawn(
    "python3",
    [join(repo, "test/helpers/task-shell-pty.py"), config],
    { env, stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const original = once(driver, "close");
  driver.stdout.resume();
  let errors = "";
  driver.stderr.on("data", (b) => {
    errors = (errors + b).slice(0, 4096);
  });
  const close = await original;
  driver.stdio[3].destroy();
  const receipt = JSON.parse(
    readFileSync(join(root, "pty-receipt.json"), "utf8"),
  );
  assert.deepEqual(close, [0, null], errors);
  assert.equal(receipt.waitpidReturned, true);
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.failure, null);
  assert(receipt.observations.some((o) => o.pattern === runId && o.matched));
  return {
    runId,
    originalDriverClose: close,
    receipt: join(root, "pty-receipt.json"),
  };
}
