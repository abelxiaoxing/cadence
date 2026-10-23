// Actual production CLI + OS PTY + synthetic loopback SDK. No physical-human/provider claim.
import nodeAssert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { beforeAll, expect, it, vi } from "vitest";
import { auditPackage } from "../scripts/package-audit.mjs";
import { nativeBuild } from "../src/native-build.ts";
import { nativeCall } from "../src/service/cli.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceClient } from "../src/service-client.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { diagnosticText } from "../src/verification-diagnostics.ts";
import { WINDOWS_SYSTEM_KEYS } from "./helpers/windows-environment.ts";

const repo = path.resolve(import.meta.dirname, "..");
const cli = path.join(
  repo,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
const windows = process.platform === "win32";
const transport = windows ? "windows-conpty" : "posix-pty";
const pendingEvent = {
  event: "cancellation-http-pending",
  requestOrdinal: 4,
  editingOrdinal: 3,
};
const eventLine = `${JSON.stringify(pendingEvent)}\n`;
const safeText = (value, maximum = 256) =>
  diagnosticText(String(value), maximum, ["fabricated-terminal-key"]);

const fixtureNames = windows
  ? ["task-shell-conpty.ps1", "task-shell-conpty.cs"]
  : ["task-shell-pty.py"];
const unavailableIdentity = () => ({
  transport,
  stage: "diagnostic-projection-unavailable",
  projectionUnavailable: true,
  fixtureHashes: fixtureNames.map((name) => ({ name, sha256: null })),
  requestCount: null,
  editingCount: null,
  driver: {
    started: null,
    status: null,
    stderrBytes: null,
    receiptPresent: null,
  },
  physicalHuman: false,
  paidProvider: false,
  managerInstall: false,
});

function saveIdentity(root, project) {
  // The WHOLE projection, including helper reads/hashes, is inside the boundary.
  // Fixed null fields preserve unavailable facts, never arbitrary exceptions.
  let identity;
  try {
    identity = project();
  } catch {
    identity = unavailableIdentity();
    console.error("terminal identity unavailable");
  }
  try {
    const json = JSON.stringify(identity, null, 2);
    if (Buffer.byteLength(json) > 16 * 1024)
      throw new Error("Identity diagnostic bound");
    writeFileSync(path.join(root, "identity.json"), json, { mode: 0o600 });
  } catch {
    // Diagnostic I/O must never replace the original assertion/setup failure.
    console.error("terminal identity unavailable");
  }
}

function terminalEnvironment(
  root,
  nativeWindows = windows,
  system = process.env,
) {
  const env = {
    PATH: system.PATH,
    HOME: path.join(root, "home"),
    XDG_STATE_HOME: path.join(root, "state"),
    PI_CODING_AGENT_DIR: path.join(root, "agent"),
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    JITI_FS_CACHE: "0",
    NODE_DISABLE_COMPILE_CACHE: "1",
    TERM: "xterm-256color",
    TMPDIR: root,
    TEMP: root,
    TMP: root,
  };
  if (nativeWindows) {
    for (const key of WINDOWS_SYSTEM_KEYS)
      if (system[key] !== undefined) env[key] = system[key];
    Object.assign(env, {
      USERPROFILE: env.HOME,
      LOCALAPPDATA: path.join(root, "state"),
      APPDATA: path.join(root, "appdata"),
      TMP: path.join(root, "temp"),
      TEMP: path.join(root, "temp"),
      TMPDIR: path.join(root, "temp"),
    });
  }
  return env;
}

// A fresh Windows runner's first pwsh/.NET compiler load once took ~30s instead
// of 4-8s, inside the first scenario's own PTY budget. Warm the same in-memory
// compile once, untimed; the wrapper, its per-launch compile and every
// scenario/interaction budget are unchanged. Best-effort: the scenarios still
// report their own setup failure.
beforeAll(async () => {
  if (!windows) return;
  const started = performance.now();
  const source = path.join(repo, "test/helpers/task-shell-conpty.cs");
  const status = await new Promise((resolve) => {
    const child = spawn(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -LiteralPath '${source.replaceAll("'", "''")}' -ErrorAction Stop`,
      ],
      { stdio: "ignore", timeout: 150000 },
    );
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  console.log(
    JSON.stringify({
      conptyWarmup: status,
      ms: Math.round(performance.now() - started),
    }),
  );
}, 180000);

function startDriver(config) {
  const child = spawn(
    windows ? "pwsh" : "python3",
    windows
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(repo, "test/helpers/task-shell-conpty.ps1"),
          config,
        ]
      : [path.join(repo, "test/helpers/task-shell-pty.py"), config],
    windows
      ? {
          stdio: ["pipe", "pipe", "pipe"],
          env: JSON.parse(readFileSync(config, "utf8")).env,
        }
      : { stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const control = windows ? child.stdin : child.stdio[3];
  const result = { child, control, status: null, errors: "", stderrBytes: 0 };
  control.on("error", () => {
    result.controlError = "control-pipe-error";
  });
  // Fixed excluded-helper signals; no production output/readiness substitution.
  let signalBytes = "";
  let smokeReady, lateParked;
  result.smokeReady = new Promise((resolve) => {
    smokeReady = resolve;
  });
  result.lateParked = new Promise((resolve) => {
    lateParked = resolve;
  });
  child.stdout.on("data", (bytes) => {
    signalBytes = (signalBytes + bytes).slice(-1024);
    if (/conpty-smoke-prerequisite\r?\n/.test(signalBytes)) smokeReady();
    if (/conpty-control-parked\r?\n/.test(signalBytes)) lateParked();
  });
  child.stderr.on("data", (bytes) => {
    result.stderrBytes += bytes.length;
    result.errors = (result.errors + bytes).slice(0, 4096);
  });
  result.closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      result.status = status;
      control.destroy();
      resolve(status);
    });
  });
  return result;
}

const down = "\x1b[B",
  enter = "\r",
  esc = "\x1b";
const settledParent = (kind, outcome) => {
  const id = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
  // Full redraw OR a later diff of the SAME parent's drain row. A child drain,
  // earlier drain, or settled heading alone cannot advance the input script.
  // Shared syntax is supported by the Python and .NET driver regex engines.
  return `Parent ${kind}: settled / ${outcome} / published\\s*Owner (?:drained • ID ${id}|active/draining • ID (${id})[\\s\\S]*?Owner drained • ID \\1)`;
};

it("settled-parent matcher binds incremental fullscreen drain to the exact parent ID", () => {
  const parent = "0e3e069f-b456-4a73-a209-76232b9608e9",
    child = "10c607ab-ef8a-4f4f-b99a-70d1e8b029f8";
  // Actual Pi fullscreen output may update only changed rows. These are the
  // ANSI-stripped rows from the reproduced committed199 -> committed201 view,
  // not a full redraw or a substitute for the production PTY scenarios below.
  for (const [kind, outcome] of [
    ["generate-plan", "completed"],
    ["start", "completed"],
    ["check", "completed"],
    ["check", "failed"],
  ]) {
    const heading = `Parent ${kind}: settled / ${outcome} / published`,
      initial = `${heading}\nOwner active/draining • ID ${parent}\nChild task: settled / completed / published\nOwner active/draining • ID ${child}\n`,
      update = `Connection current • committed 201\nOwner drained • ID ${parent}\nOwner drained • ID ${child}`,
      pattern = new RegExp(settledParent(kind, outcome));
    expect(pattern.test(`${heading}\nOwner drained • ID ${parent}`)).toBe(true);
    expect(pattern.test(initial + update)).toBe(true);
    expect(pattern.test(initial)).toBe(false);
    expect(pattern.test(`${initial}Owner drained • ID ${child}`)).toBe(false);
    expect(pattern.test(`Owner drained • ID ${parent}\n${initial}`)).toBe(
      false,
    );
    expect(
      pattern.test(
        (initial + update).replace(
          heading,
          heading.replace(outcome, "unknown"),
        ),
      ),
    ).toBe(false);
  }
});
// Packaging and screen mode are independent: each value runs once, not every pair.
for (const [source, mode] of [
  ["extracted", "regular"],
  ["source", "fullscreen"],
]) {
  it(`${source} ${mode} production ${transport} service plan, SDK edit, real checks, issues review, detach/quit, reattach and explicit cancel`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-terminal-"));
    if (windows) {
      for (const dir of ["appdata", "temp"])
        mkdirSync(path.join(root, dir), { mode: 0o700 });
    }
    console.log(`terminal fixture retained: ${root}`);
    let packageRoot = repo;
    const requests = [];
    let codeRequests = 0;
    let server, driver, owner, ownerClosed, coordination, observerTransport;
    let ownerOutput = "",
      ownerErrors = "";
    const terminalReceipts = [];
    let piVersion = null;
    let serverFailure = null,
      pendingResponse;
    const barrier = {
      published: false,
      delivered: false,
      transportError: null,
    };
    let stage = "setup",
      primaryError;
    try {
      piVersion = JSON.parse(
        readFileSync(
          path.join(
            repo,
            "node_modules/@earendil-works/pi-coding-agent/package.json",
          ),
          "utf8",
        ),
      ).version;
      for (const dir of ["home", "agent", "state", "project"])
        mkdirSync(path.join(root, dir), { mode: 0o700 });
      if (source === "extracted") {
        stage = "pack";
        const pack = path.join(root, "pack");
        mkdirSync(pack);
        const packed = spawnSync("bun", ["pm", "pack", "--destination", pack], {
          cwd: repo,
          encoding: "utf8",
          timeout: 30000,
        });
        expect(packed.status, packed.stderr).toBe(0);
        const archive = path.join(pack, readdirSync(pack)[0]);
        auditPackage(
          archive,
          repo,
          JSON.parse(
            readFileSync(
              path.join(repo, "provenance/package-members.json"),
              "utf8",
            ),
          ),
        );
        expect(
          spawnSync("tar", ["xzf", archive, "-C", root], { timeout: 10000 })
            .status,
        ).toBe(0);
        packageRoot = path.join(
          root,
          "install/node_modules/@abelxiaoxing/cadence",
        );
        mkdirSync(path.dirname(packageRoot), { recursive: true });
        cpSync(path.join(root, "package"), packageRoot, {
          recursive: true,
        });
        auditPackage(
          archive,
          packageRoot,
          JSON.parse(
            readFileSync(
              path.join(repo, "provenance/package-members.json"),
              "utf8",
            ),
          ),
          repo,
        );
        for (const name of ["@earendil-works", "typebox", "undici", "ws"])
          symlinkSync(
            path.join(repo, "node_modules", name),
            path.join(root, "install/node_modules", name),
            windows ? "junction" : "dir",
          );
      }
      stage = "loopback-server";
      server = createServer(async (req, res) => {
        try {
          let raw = "";
          for await (const part of req) {
            raw += part;
            if (Buffer.byteLength(raw) > 128 * 1024)
              throw new Error("Loopback request bound");
          }
          const body = JSON.parse(raw);
          if (
            typeof body.model !== "string" ||
            !Array.isArray(body.tools) ||
            !body.tools.every(
              (tool) => typeof tool?.function?.name === "string",
            )
          )
            throw new Error("Invalid loopback request");
          requests.push({
            model: body.model,
            auth: req.headers.authorization,
            tools: body.tools.map((t) => t.function.name),
          });
          const editing = body.tools.some((t) => t.function.name === "write");
          if (editing && ++codeRequests > 2) {
            // Only actual parsed HTTP #4 / editing #3 can arm cancellation.
            // Publish before returning with this response deliberately pending.
            if (
              requests.length !== 4 ||
              codeRequests !== 3 ||
              body.model !== "exact-model" ||
              barrier.published ||
              !driver
            ) {
              serverFailure = "unexpected-cancellation-request-order";
              return;
            }
            barrier.published = true;
            pendingResponse = res;
            driver.control.write(eventLine, (error) => {
              if (error) barrier.transportError = "control-pipe-write-failed";
              else barrier.delivered = true;
            });
            return; // Explicit cancellation lane: no hidden retry.
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            connection: "close",
          });
          const emit = (delta, finish_reason = null) =>
            res.write(
              `data: ${JSON.stringify({ id: "terminal", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
            );
          if (editing && codeRequests === 1) {
            emit({
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "terminal_write",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({
                      path: "fixture.txt",
                      content: "terminal-sdk-edit\n",
                    }),
                  },
                },
              ],
            });
            emit({}, "tool_calls");
          } else {
            emit({
              role: "assistant",
              content: editing
                ? "EDIT_COMPLETE"
                : Array.from(
                    { length: 40 },
                    (_, i) =>
                      `Plan ${i + 1}: inspect 中文 🧪 and write fixture.txt only; preserve existing dirt.`,
                  ).join("\n"),
            });
            emit({}, "stop");
          }
          res.end("data: [DONE]\n\n");
        } catch {
          // Keep malformed/failed fixture requests in the awaited failure
          // path, not an unhandled rejection that loses identity evidence.
          serverFailure ??= "loopback-request-invalid";
          if (!res.headersSent) res.writeHead(400);
          res.end();
        }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      stage = "fixture-configuration";
      writeFileSync(
        path.join(root, "agent/settings.json"),
        JSON.stringify({
          quietStartup: true,
          cacheWarming: "off",
          compaction: { enabled: false },
          retry: { enabled: false },
          packages: [],
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
          enableInstallTelemetry: false,
          defaultProjectTrust: "always",
        }),
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(root, "agent/models.json"),
        JSON.stringify({
          providers: {
            "terminal-fixture": {
              baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
              api: "openai-completions",
              apiKey: "fabricated-terminal-key",
              models: [
                {
                  id: "exact-model",
                  name: "Terminal fixture",
                  reasoning: false,
                  input: ["text"],
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 8192,
                  maxTokens: 2048,
                  compat: { supportsDeveloperRole: false },
                },
              ],
            },
          },
        }),
        // Selected owner profiles must be private independently of the
        // invoking shell's umask; fixture keys are still fabricated only.
        { mode: 0o600 },
      );
      writeFileSync(
        path.join(root, "agent/auth.json"),
        JSON.stringify({
          "terminal-fixture": {
            type: "api_key",
            key: "fabricated-terminal-key",
          },
        }),
        { mode: 0o600 },
      );
      const cwd = path.join(root, "project");
      mkdirSync(path.join(cwd, ".cadence/assistant"), { recursive: true });
      writeFileSync(
        path.join(cwd, ".cadence/assistant/config.json"),
        JSON.stringify({
          schema: "cadence-assistant-checks/1",
          checks: [
            {
              name: "Pass fixture",
              command: windows ? "exit /b 0" : "true",
              timeoutMs: 1000,
            },
            {
              name: "Fail fixture",
              command: windows ? "exit /b 1" : "false",
              timeoutMs: 1000,
            },
          ],
        }),
      );
      writeFileSync(path.join(cwd, "existing.txt"), "pre-existing user bytes");
      const env = terminalEnvironment(root);
      // The actual independently compiled owner, never a shell-local worker.
      coordination = new ServiceCoordination(cwd, path.join(root, "state"));
      owner = spawn(
        process.execPath,
        [path.join(packageRoot, "src/service-host.mjs")],
        { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
      );
      ownerClosed = new Promise((resolve, reject) => {
        owner.once("close", (code, signal) => resolve({ code, signal }));
        owner.once("error", reject);
      });
      owner.stdout.on("data", (b) => {
        ownerOutput += b;
      });
      owner.stderr.on("data", (b) => {
        ownerErrors += b;
      });
      owner.stdin.end(
        JSON.stringify({
          workspace: cwd,
          stateHome: path.join(root, "state"),
          environmentToken: null,
          config: {
            schema: "cadence-service-host/1",
            cwd,
            agentDir: path.join(root, "agent"),
            tokenSource: "generated",
            tokenFile: null,
            http: {
              schema: "cadence-service-http/1",
              host: "127.0.0.1",
              port: 0,
              proxy: null,
            },
          },
        }),
      );
      const ownerDeadline = Date.now() + 10000;
      while (
        !ownerOutput.includes('"ready"') &&
        owner.exitCode === null &&
        Date.now() < ownerDeadline
      )
        await new Promise((r) => setTimeout(r, 20));
      writeFileSync(
        path.join(root, "startup-receipt.json"),
        JSON.stringify({
          stdout: ownerOutput,
          stderr: ownerErrors,
          pid: owner.pid,
        }),
      );
      expect(ownerOutput, ownerErrors).toContain('"ready"');
      coordination = new ServiceCoordination(cwd, path.join(root, "state"));
      const local = coordination.localAccess();
      observerTransport = new HttpServiceTransport({
        origin: local.endpoint,
        localCapability: local.capability,
        build: nativeBuild,
      });
      const observer = new ServiceClient(observerTransport);
      expect((await observer.session()).kind).toBe("ok");
      const argv = [
        process.execPath,
        cli,
        "--offline",
        "--approve",
        "--no-context-files",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-session",
        "--provider",
        "terminal-fixture",
        "--model",
        "exact-model",
        "--tui-mode",
        mode,
        "--extension",
        path.join(packageRoot, "src/index.ts"),
      ];
      const choose = (n) => [...Array(n).fill(down), enter];
      const taskMenu = "current v1 revision";
      const confirmAction = (kind) => [
        { expect: "Cadence review", send: [enter] },
        { expect: `Confirm ${kind} now`, send: [enter] },
      ];
      const steps = [
        { expect: "Context7", send: ["/cadence PTY 中文 🧪", enter] },
        { expect: "Cadence service", send: choose(2) },
        { expect: "Exact OWNER model", send: [enter] },
        { expect: "Exact thinking level", send: [enter] },
        { expect: "Select exact owner model", send: [enter] },
        { expect: "Cadence review", send: [enter] },
        { expect: "Cadence service", send: [enter] },
        { expect: "Task kind", send: [enter] },
        { expect: "Goal", send: [enter] },
        ...confirmAction("create"),
        { expect: taskMenu, send: [enter] },
        {
          expect: "Readable plan",
          send: ["Inspect 中文 🧪 and write fixture.txt only.", enter],
        },
        { expect: "Finite assignments", send: choose(2) },
        ...confirmAction("save-plan"),
        { expect: taskMenu, send: choose(1) },
        ...confirmAction("generate-plan"),
        { expect: taskMenu, send: choose(3) },
        {
          expect: settledParent("generate-plan", "completed"),
          send: [esc],
        },
        { expect: taskMenu, send: choose(2) },
        {
          expect: "Cadence review",
          resize: [28, 72],
          send: ["\x1b[6~", "\x1b[F", "\x1b[H", enter],
        },
        { expect: "Confirm start now", send: [enter] },
        { expect: taskMenu, send: choose(3) },
        {
          expect: settledParent("start", "completed"),
          send: [esc],
        },
        { expect: taskMenu, send: choose(5) },
        { expect: "Parent checks", send: [enter] },
        ...confirmAction("check"),
        { expect: taskMenu, send: choose(3) },
        {
          expect: settledParent("check", "completed"),
          send: [esc],
        },
        { expect: taskMenu, send: choose(5) },
        { expect: "Parent checks", send: choose(1) },
        ...confirmAction("check"),
        { expect: taskMenu, send: choose(3) },
        {
          expect: settledParent("check", "failed"),
          send: [esc],
        },
        { expect: taskMenu, send: choose(6) },
        {
          expect: "Cadence review",
          resize: [40, 100],
          send: ["\x1b[6~", "\x1b[F", enter],
        },
        { expect: taskMenu, send: choose(7) },
        { expect: "Cadence review", send: [enter] },
        { expect: "Select exact run for HUMAN review", send: [enter] },
        { expect: "Acknowledge unresolved issues", send: [enter] },
        ...confirmAction("review"),
        { expect: taskMenu, send: [esc] },
        { expect: "Cadence service", send: choose(1) },
        { expect: "PTY 中文", send: [enter] },
        { expect: taskMenu, send: choose(2) },
        ...confirmAction("start"),
        { expect: taskMenu, send: choose(3) },
        {
          expect: "Cadence owner observation",
          event: pendingEvent.event,
          send: [esc],
        },
        { expect: taskMenu, send: [esc] },
        { expect: "Cadence service", send: [esc] },
        { expect: "detached locally", send: ["/quit", enter] },
      ];
      const config = path.join(root, "pty.json");
      writeFileSync(
        config,
        JSON.stringify({
          root,
          cwd,
          argv,
          env,
          steps,
          ...(windows ? {} : { controlFd: 3 }),
        }),
      );
      stage = `production-${transport}`;
      driver = startDriver(config);
      driver.control.on("error", () => {
        barrier.transportError = "control-pipe-error";
      });
      const status = await driver.closed;
      // First original Pi has quit while HTTP4 is STILL pending in the owner.
      expect(status, driver.errors).toBe(0);
      const firstReceipt = JSON.parse(
        readFileSync(path.join(root, "pty-receipt.json"), "utf8"),
      );
      terminalReceipts.push(firstReceipt);
      const activeBefore = await observer.activeRuns();
      expect(activeBefore.kind).toBe("ok");
      expect(activeBefore.value.status).toBe("complete");
      expect(activeBefore.value.runs).toHaveLength(1);
      expect(owner.exitCode).toBeNull();
      const surviving = activeBefore.value.runs[0];
      const secondRoot = path.join(root, "reattach");
      mkdirSync(secondRoot, { mode: 0o700 });
      const secondConfig = path.join(secondRoot, "pty.json");
      writeFileSync(
        secondConfig,
        JSON.stringify({
          root: secondRoot,
          cwd,
          argv,
          env,
          steps: [
            { expect: "Context7", send: ["/cadence", enter] },
            { expect: "Cadence service", send: choose(3) },
            {
              expect: surviving.runId,
              event: pendingEvent.event,
              send: [enter],
            },
            { expect: "Cadence review", send: [enter] },
            { expect: "Cadence service", send: [esc] },
            { expect: "detached locally", send: ["/quit", enter] },
          ],
          ...(windows ? {} : { controlFd: 3 }),
        }),
      );
      // Reattach barrier refers to the SAME parsed pending HTTP4, not a
      // prompt/sleep or a newly fabricated provider request.
      expect(pendingResponse.destroyed).toBe(false);
      expect(pendingResponse.writableEnded).toBe(false);
      const secondDriver = startDriver(secondConfig);
      secondDriver.control.write(eventLine);
      expect(await secondDriver.closed, secondDriver.errors).toBe(0);
      const secondReceipt = JSON.parse(
        readFileSync(path.join(secondRoot, "pty-receipt.json"), "utf8"),
      );
      terminalReceipts.push(secondReceipt);
      expect(secondReceipt.exitCode).toBe(0);
      const settled = await observer.snapshot({
        kind: "run",
        id: surviving.runId,
      });
      expect(settled.kind).toBe("ok");
      expect(settled.value.runs.find((r) => !r.childRunId)).toMatchObject({
        runId: surviving.runId,
        outcome: "canceled",
        lifecycle: "settled",
      });
      const originalChild = settled.value.runs.find((r) => r.childRunId);
      expect(originalChild.settlement.native.closure).toBe(
        "direct-child-closed",
      );
      expect(originalChild.settlement.native.outcome).toBe("canceled");
      stage = "assertions";
      const receipt = JSON.parse(
        readFileSync(path.join(root, "pty-receipt.json"), "utf8"),
      );
      expect({
        status,
        failure: receipt.failure,
        errors: driver.errors,
      }).toEqual({
        status: 0,
        failure: null,
        errors: "",
      });
      if (windows) {
        expect(receipt.transport).toBe("windows-conpty");
        expect(receipt).not.toHaveProperty("waitpidReturned");
        expect(receipt.nativeWaitReturned).toBe(true);
        expect(receipt.nativeWaitResult).toBe(0);
        expect(receipt.waitBeforeClose).toBe(true);
        expect(receipt.cleanQuit).toBe(true);
        expect(receipt.forced).toBe(false);
        expect(receipt.closePseudoConsoleReturned).toBe(true);
        expect(receipt.teardownFailure).toBeNull();
        expect(receipt.quitObservedBeforeTeardown).toBe(true);
        expect(receipt.nativeWaitError).toBeNull();
        expect(receipt.exitCodeError).toBeNull();
        expect(receipt.outputEof).toBe(true);
        expect(receipt.resourcesRetained).toBe(false);
        expect(
          receipt.pumps.every(
            (pump) => pump.started && pump.ready && pump.joined,
          ),
        ).toBe(true);
        expect(receipt.controlCutoff).toMatchObject({
          requested: true,
          reached: true,
          available: 0,
          futureInputValidated: false,
        });
        expect(receipt.firstWaitFailure).toBeNull();
        expect(receipt.firstExitFailure).toBeNull();
      } else expect(receipt.waitpidReturned).toBe(true);
      expect(receipt.exitCode).toBe(0);
      expect(serverFailure).toBeNull();
      expect(barrier).toEqual({
        published: true,
        delivered: true,
        transportError: null,
      });
      expect(receipt.barrier.event).toEqual(pendingEvent);
      expect(receipt.barrier.consumed).toBe(true);
      expect(receipt.barrier.escapeAfterReady).toBe(true);
      expect(requests).toHaveLength(4);
      expect(requests[0].tools).toEqual(["read", "grep", "find", "ls"]);
      for (const request of requests) {
        expect(request.auth).toBe("Bearer fabricated-terminal-key");
        expect(request.model).toBe("exact-model");
      }
      expect(readFileSync(path.join(cwd, "fixture.txt"), "utf8")).toBe(
        "terminal-sdk-edit\n",
      );
      expect(readFileSync(path.join(cwd, "existing.txt"), "utf8")).toBe(
        "pre-existing user bytes",
      );
      const tasks = path.join(cwd, ".cadence/assistant/tasks");
      const task = JSON.parse(
        readFileSync(
          path.join(tasks, readdirSync(tasks)[0], "task.json"),
          "utf8",
        ),
      );
      expect(task.phase).toBe("interrupted");
      expect(task.checks.map((c) => c.exitCode)).toEqual([0, 1]);
      expect(task.activity.some((a) => a.text.includes("review"))).toBe(true);
      expect(existsSync(path.join(root, "home/.pi/agent/auth.json"))).toBe(
        false,
      );
      stage = "complete";
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        const detachError = await observerTransport?.detach().then(
          () => null,
          () => "detach-unconfirmed",
        );
        if (coordination && owner?.exitCode === null)
          await nativeCall(coordination, "stop").catch(() => {});
        if (ownerClosed) {
          let timer;
          let settled = await Promise.race([
            ownerClosed,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), 5000);
            }),
          ]);
          clearTimeout(timer);
          const forced = settled === null;
          if (forced) {
            owner.kill("SIGTERM");
            settled = await ownerClosed;
          }

          writeFileSync(
            path.join(root, "owner-receipt.json"),
            JSON.stringify({
              ...settled,
              forced,
              stderr: ownerErrors,
              detachError,
              terminalReceipts,
              physicalHuman: false,
              paidProvider: false,
            }),
          );
          if (server?.listening) {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
          }
          if (!primaryError)
            expect({ ...settled, forced }).toEqual({
              code: 0,
              signal: null,
              forced: false,
            });
        }
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      } finally {
        // Failure-safe whitelist projection: never publish auth, raw HTTP
        // bodies/prompts, CLI configuration or environment snapshots.
        saveIdentity(root, () => {
          const receiptPath = path.join(root, "pty-receipt.json");
          return {
            transport,
            fixtureHashes: fixtureNames.map((name) => ({
              name,
              sha256: createHash("sha256")
                .update(readFileSync(path.join(repo, "test/helpers", name)))
                .digest("hex"),
            })),
            source,
            mode,
            stage,
            node: process.version,
            executable: safeText(process.execPath, 1024),
            pi: piVersion === null ? null : safeText(piVersion, 64),
            platform: process.platform,
            arch: process.arch,
            packageRoot: safeText(packageRoot, 1024),
            requestCount: requests.length,
            editingCount: codeRequests,
            requestOrder: requests.slice(0, 8).map((request, index) => ({
              ordinal: index + 1,
              model: safeText(request.model),
              tools: request.tools
                .slice(0, 8)
                .map((name) => safeText(name, 64)),
            })),
            serverFailure,
            barrier,
            driver: {
              started: Boolean(driver),
              status: driver?.status ?? null,
              stderrBytes: driver?.stderrBytes ?? 0,
              receiptPresent: existsSync(receiptPath),
            },
            physicalHuman: false,
            paidProvider: false,
            managerInstall: false,
          };
        });
      }
    }
  }, 90000);
}

it("identity projection, helper reads, diagnostic I/O and bounds cannot replace the original failure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-identity-"));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const original = new Error("original-fixture-assertion");
  let observed;
  try {
    try {
      try {
        throw original;
      } finally {
        saveIdentity(path.join(root, "absent-parent"), () => ({
          stage: "assertions",
        }));
      }
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(original);
    saveIdentity(root, () => ({ overBound: "x".repeat(17 * 1024) }));
    expect(existsSync(path.join(root, "identity.json"))).toBe(false);
    // A read/hash failure during argument projection used to escape finally.
    try {
      try {
        throw original;
      } finally {
        saveIdentity(root, () => ({
          fixtureHashes: [
            {
              sha256: createHash("sha256")
                .update(readFileSync(path.join(root, "missing-helper.cs")))
                .digest("hex"),
            },
          ],
        }));
      }
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(original);
    expect(
      JSON.parse(readFileSync(path.join(root, "identity.json"), "utf8")),
    ).toEqual(unavailableIdentity());
    try {
      try {
        throw original;
      } finally {
        saveIdentity(root, () => {
          throw new Error("must-not-publish-this-exception");
        });
      }
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(original);
    expect(
      readFileSync(path.join(root, "identity.json"), "utf8"),
    ).not.toContain("must-not-publish");
    expect(errors.mock.calls).toEqual(
      Array.from({ length: 4 }, () => ["terminal identity unavailable"]),
    );
  } finally {
    errors.mockRestore();
  }
});

// Fault injection tests the excluded POSIX driver/pipe, not product execution.
// The four production lanes above alone derive readiness from parsed HTTP.
it.skipIf(process.platform === "win32")(
  "POSIX fixture barrier buffers readiness, rejects faults and closes control fd before exec",
  async () => {
    const cases = [
      { name: "buffered", chunks: [eventLine], failure: null },
      {
        name: "split",
        chunks: [eventLine.slice(0, 20), eventLine.slice(20)],
        failure: null,
      },
      {
        name: "invalid",
        chunks: ["not-json\n"],
        failure: "control-event-invalid",
      },
      {
        name: "unexpected",
        chunks: [`${JSON.stringify({ ...pendingEvent, requestOrdinal: 3 })}\n`],
        failure: "control-event-unexpected",
      },
      {
        name: "duplicate",
        chunks: [eventLine + eventLine],
        failure: "control-event-duplicate",
      },
      {
        name: "overflow",
        chunks: ["x".repeat(513)],
        failure: "control-event-overflow",
      },
      { name: "eof", chunks: [], eof: true, failure: "control-event-eof" },
      {
        name: "partial-eof",
        chunks: [eventLine.slice(0, 20)],
        eof: true,
        failure: "control-event-eof",
      },
      {
        name: "child-exit",
        chunks: [],
        childExit: true,
        failure: "child-exited-before-expected-terminal-or-event",
      },
      { name: "missing", chunks: [], failure: "terminal-event-step-deadline" },
      {
        name: "terminal-missing",
        chunks: [eventLine],
        failure: "terminal-event-step-deadline",
      },
    ];
    for (const control of cases) {
      const root = mkdtempSync(path.join(tmpdir(), "cadence-terminal-"));
      console.log(`terminal barrier ${control.name} fixture retained: ${root}`);
      const program = `
import errno, os, sys, tty
try:
    os.fstat(3)
except OSError as error:
    if error.errno != errno.EBADF: raise
else:
    raise RuntimeError("fixture-control-fd-inherited-by-exec")
tty.setraw(0)
os.write(1, b"CONTROL_FD_CLOSED CHILD_READY\\n")
if ${control.childExit ? "True" : "False"}: sys.exit(0)
while os.read(0, 1) != b"\\r": pass
os.write(1, b"FOREGROUND\\n")
while os.read(0, 1) != b"\\x1b": pass
os.write(1, b"ESC_SEEN\\n")
while os.read(0, 1) != b"\\r": pass
`;
      const config = path.join(root, "pty.json");
      writeFileSync(
        config,
        JSON.stringify({
          root,
          cwd: root,
          controlFd: 3,
          argv: ["/usr/bin/env", "python3", "-c", program],
          env: { PATH: process.env.PATH, TERM: "xterm-256color" },
          steps: [
            { expect: "CONTROL_FD_CLOSED CHILD_READY", send: [enter] },
            {
              expect:
                control.name === "terminal-missing"
                  ? "NEVER_RENDERED"
                  : "FOREGROUND",
              event: pendingEvent.event,
              send: [esc],
            },
            { expect: "ESC_SEEN", send: [enter] },
          ],
        }),
      );
      const driver = startDriver(config);
      for (const chunk of control.chunks) driver.child.stdio[3].write(chunk);
      if (control.eof) driver.child.stdio[3].end();
      const status = await driver.closed;
      const receipt = JSON.parse(
        readFileSync(path.join(root, "pty-receipt.json"), "utf8"),
      );
      expect(receipt.failure, control.name).toBe(control.failure);
      expect(status, control.name).toBe(control.failure ? 1 : 0);
      expect(receipt.waitpidReturned, control.name).toBe(true);
      expect(driver.errors, control.name).toBe("");
      if (!control.failure) {
        expect(receipt.exitCode).toBe(0);
        expect(receipt.barrier.receivedBeforeWait).toBe(true);
        expect(receipt.barrier.event).toEqual(pendingEvent);
        expect(receipt.barrier.consumed).toBe(true);
        expect(receipt.barrier.escapeAfterReady).toBe(true);
      } else {
        expect(receipt.barrier.escapeAfterReady).toBe(false);
      }
    }
  },
  90000,
);

// Portable configuration checks are NOT native Windows execution receipts.
it("Windows terminal environment is an isolated whitelist, not inherited user state", () => {
  const root = path.join(tmpdir(), "owned-conpty-config");
  const system = {
    PATH: "system-path",
    SystemRoot: "system-root",
    WINDIR: "windows-directory",
    COMSPEC: "command-processor",
    PATHEXT: ".EXE;.CMD",
    HOME: "real-home",
    USERPROFILE: "real-profile",
    LOCALAPPDATA: "real-state",
    APPDATA: "real-appdata",
    OPENAI_API_KEY: "must-not-inherit",
    NODE_OPTIONS: "must-not-inherit",
    PI_SESSION_ID: "must-not-inherit",
  };
  const env = terminalEnvironment(root, true, system);
  expect(env.USERPROFILE).toBe(path.join(root, "home"));
  expect(env.LOCALAPPDATA).toBe(path.join(root, "state"));
  expect(env.APPDATA).toBe(path.join(root, "appdata"));
  for (const key of ["TMP", "TEMP", "TMPDIR"])
    expect(env[key]).toBe(path.join(root, "temp"));
  for (const key of ["PATH", ...WINDOWS_SYSTEM_KEYS])
    expect(env[key]).toBe(system[key]);
  expect(env).not.toHaveProperty("OPENAI_API_KEY");
  expect(env).not.toHaveProperty("NODE_OPTIONS");
  expect(env).not.toHaveProperty("PI_SESSION_ID");
});

// Serialized only into the excluded console smoke child. No preload or
// production identity writer: exclusive creation refuses any existing identity.
function runConptySmoke(control) {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const tty = require("node:tty");
  const diagnostic = {
    schema: "conpty-prerequisite-diagnostic/1",
    stage: "bootstrap",
    sequence: 0,
    firstFailedCheck: null,
    errorClass: null,
    checks: {},
    fdTTY: [0, 1, 2].map((fd) => ({ fd, isTTY: null, errorClass: null })),
    streamTTY: { stdin: null, stdout: null, stderr: null },
    stderrInitErrorClass: null,
    columns: null,
    rows: null,
    rawBefore: null,
    rawAfter: null,
    sentinel: {
      called: false,
      returned: null,
      callbackCalled: false,
      callbackSucceeded: null,
      errorClass: null,
    },
  };
  const errorClass = (error) => {
    // No arbitrary name/code/message/stack or body values enter the record.
    if (error instanceof assert.AssertionError) return "AssertionError";
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof RangeError) return "RangeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof Error) return "Error";
    return "unknown";
  };
  let diagnosticFd = null;
  const save = () => {
    if (diagnosticFd === null) return;
    try {
      diagnostic.sequence++;
      const json = JSON.stringify(diagnostic);
      if (Buffer.byteLength(json) > 8 * 1024) return;
      fs.ftruncateSync(diagnosticFd, 0);
      fs.writeSync(diagnosticFd, json, 0, "utf8");
    } catch {
      // Independent diagnostic failure never replaces the actual child error.
    }
  };
  try {
    diagnosticFd = fs.openSync(
      path.join(process.cwd(), "identity.json"),
      "wx",
      0o600,
    );
  } catch {
    // Unavailable is not evidence of a TTY failure or a passing prerequisite.
  }
  save(); // Synchronous bootstrap BEFORE any lazy process stdio access.
  const begin = (id) => {
    diagnostic.stage = id;
    save();
  };
  const check = (id, actual, expected) => {
    diagnostic.checks[id] = actual === expected;
    save();
    assert.equal(actual, expected); // Keep strict failures and default nonzero.
  };
  const fail = (id, error) => {
    if (diagnostic.firstFailedCheck === null) {
      diagnostic.firstFailedCheck = id;
      diagnostic.errorClass = errorClass(error);
    }
    save();
  };
  const boolean = (value) => (typeof value === "boolean" ? value : null);
  for (const fact of diagnostic.fdTTY) {
    try {
      fact.isTTY = tty.isatty(fact.fd);
    } catch (error) {
      fact.errorClass = errorClass(error);
    }
  }
  save();
  try {
    begin("stdin-tty");
    diagnostic.streamTTY.stdin = boolean(process.stdin.isTTY);
    check("stdin-tty", process.stdin.isTTY, true);
    begin("stdout-tty");
    diagnostic.streamTTY.stdout = boolean(process.stdout.isTTY);
    check("stdout-tty", process.stdout.isTTY, true);
    // stderr is diagnostic-only, not a new prerequisite assertion.
    try {
      diagnostic.streamTTY.stderr = boolean(process.stderr.isTTY);
    } catch (error) {
      diagnostic.stderrInitErrorClass = errorClass(error);
    }
    begin("homedir-equality");
    check("homedir-equality", os.homedir(), process.env.USERPROFILE);
    begin("argv-equality");
    check("argv-equality", process.argv[1], process.env.FIXTURE_UNICODE);
    for (const [key, dir] of Object.entries({
      HOME: "home",
      USERPROFILE: "home",
      LOCALAPPDATA: "state",
      APPDATA: "appdata",
      PI_CODING_AGENT_DIR: "agent",
      TMP: "temp",
      TEMP: "temp",
      TMPDIR: "temp",
    })) {
      const id = `env-${key}-equality`;
      begin(id);
      check(id, process.env[key], path.join(process.cwd(), dir));
    }
    begin("columns-equality");
    diagnostic.columns = Number.isFinite(process.stdout.columns)
      ? process.stdout.columns
      : null;
    diagnostic.rows = Number.isFinite(process.stdout.rows)
      ? process.stdout.rows
      : null;
    check("columns-equality", process.stdout.columns, 120);
    begin("rows-equality");
    check("rows-equality", process.stdout.rows, 48);
    begin("raw-mode");
    diagnostic.rawBefore = boolean(process.stdin.isRaw);
    save();
    process.stdin.setRawMode(true);
    diagnostic.rawAfter = boolean(process.stdin.isRaw);
    begin("encoding");
    process.stdin.setEncoding("utf8");
    begin("sentinel-write");
    diagnostic.sentinel.called = true;
    save();
    const returned = process.stdout.write(
      "CONSOLE_READY 中文 🧪\n",
      (error) => {
        diagnostic.sentinel.callbackCalled = true;
        diagnostic.sentinel.callbackSucceeded = !error;
        if (error) {
          diagnostic.sentinel.errorClass = errorClass(error);
          fail("sentinel-write-callback", error);
        } else save();
        // No error listener: normal stream error/default crash remains in force.
      },
    );
    diagnostic.sentinel.returned = boolean(returned); // false is backpressure.
    save();
  } catch (error) {
    if (diagnostic.stage === "sentinel-write")
      diagnostic.sentinel.errorClass = errorClass(error);
    fail(diagnostic.stage, error);
    throw error; // Diagnostic I/O cannot suppress or substitute the original.
  }
  let phase = 0,
    pending = "";
  const keys = ["CONSOLE_PROBE 中文 🧪\r", "\r", "\x1b", "\r"];
  process.stdout.on("resize", () => {
    if (process.stdout.columns === 72 && process.stdout.rows === 28)
      process.stdout.write("RESIZE_OBSERVED 72 28\n");
  });
  process.stdin.on("data", (bytes) => {
    // Actual console input stays the prerequisite; identity is never readiness.
    pending += bytes;
    while (pending.length) {
      const key = keys[phase];
      assert.ok(key, "unexpected-console-input-after-quit");
      assert.ok(
        key.startsWith(pending) || pending.startsWith(key),
        "fixture-control-payload-leaked-to-console",
      );
      if (pending.length < key.length) return;
      pending = pending.slice(key.length);
      phase++;
      if (phase === 1) process.stdout.write("CONSOLE_INPUT_ISOLATED\n");
      else if (phase === 2) {
        if (control.childExit) process.exit(0);
        process.stdout.write("FOREGROUND\n");
      } else if (phase === 3) process.stdout.write("ESC_SEEN\n");
      else {
        assert.equal(pending, "", "trailing-console-input-at-quit");
        process.exit(control.quitCode);
      }
    }
  });
  begin("input-handlers-installed");
}

function conptySmokeProgram(control = {}) {
  return `(${runConptySmoke.toString()})(${JSON.stringify({
    childExit: Boolean(control.childExit),
    quitCode: control.quitCode ?? 0,
  })});`;
}

it("portable ConPTY diagnostic records an actual non-TTY failure without replacing assertions or existing identity", () => {
  const program = conptySmokeProgram();
  for (const existing of [false, true]) {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-conpty-diagnostic-"));
    const identity = path.join(root, "identity.json");
    const original = '{"productionIdentity":"must-remain-unchanged"}';
    if (existing) writeFileSync(identity, original, { mode: 0o600 });
    const child = spawnSync(process.execPath, ["-e", program], {
      cwd: root,
      env: terminalEnvironment(root, windows),
      encoding: "utf8",
      timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    const bytes = readFileSync(identity, "utf8");
    if (existing) expect(bytes).toBe(original);
    else {
      expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(8192);
      expect(JSON.parse(bytes)).toMatchObject({
        schema: "conpty-prerequisite-diagnostic/1",
        stage: "stdin-tty",
        firstFailedCheck: "stdin-tty",
        errorClass: "AssertionError",
        fdTTY: [0, 1, 2].map((fd) => ({ fd, isTTY: false, errorClass: null })),
        streamTTY: { stdin: null, stdout: null, stderr: null },
        checks: { "stdin-tty": false },
        sentinel: { called: false, returned: null, callbackCalled: false },
      });
    }
  }
});

// VM streams/fd results below are explicitly synthetic. They test only the
// serialized smoke diagnostic's ordering/privacy/failure boundary, NOT ConPTY.
it("portable ConPTY diagnostic bootstrap, fixed projection, strict stages and write faults preserve the first error", () => {
  const marker = "private-env-argv-path-message-stack-must-not-be-recorded";
  const simulate = (fault = null, diagnosticFault = null) => {
    const snapshots = [];
    let callback,
      writeCalls = 0;
    const original = new TypeError(marker);
    const root = path.join(tmpdir(), marker);
    const env = Object.fromEntries(
      Object.entries({
        HOME: "home",
        USERPROFILE: "home",
        LOCALAPPDATA: "state",
        APPDATA: "appdata",
        PI_CODING_AGENT_DIR: "agent",
        TMP: "temp",
        TEMP: "temp",
        TMPDIR: "temp",
      }).map(([key, dir]) => [key, path.join(root, dir)]),
    );
    env.FIXTURE_UNICODE = marker;
    if (fault === "env-TMP-equality") env.TMP = "different-private-value";
    const stdin = {
      isTTY: true,
      isRaw: false,
      setRawMode(value) {
        if (fault === "raw-mode") throw original;
        this.isRaw = value;
      },
      setEncoding() {},
      on() {},
    };
    const stdout = {
      isTTY: true,
      columns: fault === "columns-equality" ? Infinity : 120,
      rows: 48,
      write(text, done) {
        expect(text).toBe("CONSOLE_READY 中文 🧪\n");
        if (fault === "sentinel-write") throw original;
        callback = done;
        return false; // Backpressure is a recorded fact, never a new failure.
      },
      on(event) {
        expect(event).toBe("resize");
      },
    };
    const childProcess = {
      cwd: () => root,
      argv: ["node", marker],
      env,
      get stdin() {
        // File bootstrap and fd queries must precede the FIRST lazy getter.
        if (diagnosticFault === null) {
          expect(snapshots[0]).toMatchObject({ stage: "bootstrap" });
          expect(snapshots.at(-1).fdTTY.every((f) => f.isTTY)).toBe(true);
        }
        if (fault === "stdin-tty") throw original;
        return stdin;
      },
      get stdout() {
        if (fault === "stdout-tty") throw original;
        return stdout;
      },
      stderr: { isTTY: true },
    };
    const modules = {
      "node:assert/strict": nodeAssert,
      "node:fs": {
        openSync(file, flags, mode) {
          expect(file).toBe(path.join(root, "identity.json"));
          expect(flags).toBe("wx");
          expect(mode).toBe(0o600);
          if (diagnosticFault === "open") throw original;
          return 99;
        },
        ftruncateSync() {},
        writeSync(fd, json, position, encoding) {
          writeCalls++;
          if (diagnosticFault === "write") throw original;
          expect([fd, position, encoding]).toEqual([99, 0, "utf8"]);
          expect(Buffer.byteLength(json)).toBeLessThanOrEqual(8192);
          expect(json).not.toContain(marker);
          expect(json).not.toContain("different-private-value");
          snapshots.push(JSON.parse(json));
        },
      },
      "node:os": { homedir: () => env.USERPROFILE },
      "node:path": path,
      "node:tty": { isatty: () => true },
    };
    let observed;
    try {
      runInNewContext(conptySmokeProgram(), {
        require: (name) => modules[name],
        process: childProcess,
        Buffer,
        Error,
        TypeError,
        RangeError,
        SyntaxError,
        ...(diagnosticFault === "bound"
          ? { JSON: { stringify: () => "x".repeat(8193) } }
          : {}),
      });
    } catch (error) {
      observed = error;
    }
    return { snapshots, callback, original, observed, writeCalls };
  };
  for (const fault of [
    "stdin-tty",
    "stdout-tty",
    "raw-mode",
    "sentinel-write",
  ]) {
    const result = simulate(fault);
    expect(result.observed).toBe(result.original);
    expect(result.snapshots.at(-1)).toMatchObject({
      firstFailedCheck: fault,
      errorClass: "TypeError",
    });
  }
  for (const fault of ["env-TMP-equality", "columns-equality"]) {
    const result = simulate(fault);
    expect(result.observed).toBeInstanceOf(nodeAssert.AssertionError);
    expect(result.snapshots.at(-1)).toMatchObject({
      firstFailedCheck: fault,
      errorClass: "AssertionError",
    });
    if (fault === "columns-equality")
      expect(result.snapshots.at(-1).columns).toBeNull();
  }
  const success = simulate();
  expect(success.observed).toBeUndefined();
  expect(success.snapshots.at(-1)).toMatchObject({
    stage: "input-handlers-installed",
    firstFailedCheck: null,
    columns: 120,
    rows: 48,
    rawBefore: false,
    rawAfter: true,
    streamTTY: { stdin: true, stdout: true, stderr: true },
    sentinel: { called: true, returned: false, callbackCalled: false },
  });
  expect(
    Object.values(success.snapshots.at(-1).checks).every((v) => v === true),
  ).toBe(true);
  success.callback(null);
  expect(success.snapshots.at(-1).sentinel).toMatchObject({
    callbackCalled: true,
    callbackSucceeded: true,
    errorClass: null,
  });
  const callbackFault = simulate();
  callbackFault.callback(callbackFault.original);
  expect(callbackFault.snapshots.at(-1)).toMatchObject({
    firstFailedCheck: "sentinel-write-callback",
    errorClass: "TypeError",
    sentinel: { callbackSucceeded: false, errorClass: "TypeError" },
  });
  callbackFault.callback(new RangeError(marker));
  expect(callbackFault.snapshots.at(-1)).toMatchObject({
    firstFailedCheck: "sentinel-write-callback",
    errorClass: "TypeError",
  });
  for (const fault of ["open", "write", "bound"]) {
    const result = simulate("stdin-tty", fault);
    expect(result.observed).toBe(result.original);
    expect(result.snapshots).toEqual([]);
    if (fault !== "write") expect(result.writeCalls).toBe(0);
  }
});

// Actual Windows console smoke + redirected HELPER stdin faults, not Pi/human
// evidence. The production lanes above alone publish from parsed HTTP #4.
const conptyControls = [
  { name: "buffered", chunks: [eventLine], early: true, failure: null },
  {
    name: "split",
    early: true,
    chunks: [eventLine.slice(0, 20), eventLine.slice(20)],
    failure: null,
  },
  {
    name: "at-boundary",
    early: true,
    chunks: [" ".repeat(512 - Buffer.byteLength(eventLine)) + eventLine],
    failure: null,
  },
  { name: "invalid", chunks: ["not-json\n"], failure: "control-event-invalid" },
  {
    name: "invalid-utf8",
    chunks: [Buffer.from([0xff, 10])],
    failure: "control-event-invalid",
  },
  { name: "array", chunks: ["[]\n"], failure: "control-event-unexpected" },
  {
    name: "unexpected",
    chunks: [`${JSON.stringify({ ...pendingEvent, requestOrdinal: 3 })}\n`],
    failure: "control-event-unexpected",
  },
  {
    name: "type",
    chunks: [`${JSON.stringify({ ...pendingEvent, requestOrdinal: true })}\n`],
    failure: "control-event-unexpected",
  },
  {
    name: "shape",
    chunks: [`${JSON.stringify({ ...pendingEvent, extra: 1 })}\n`],
    failure: "control-event-unexpected",
  },
  {
    name: "duplicate-key",
    chunks: [
      eventLine.replace(
        '"requestOrdinal":4',
        '"requestOrdinal":4,"requestOrdinal":4',
      ),
    ],
    failure: "control-event-unexpected",
  },
  {
    name: "duplicate",
    chunks: [eventLine + eventLine],
    failure: "control-event-duplicate",
  },
  {
    name: "trailing",
    chunks: [`${eventLine}x`],
    failure: "control-event-trailing-bytes",
  },
  {
    name: "trailing-whitespace",
    chunks: [`${eventLine} `],
    failure: "control-event-trailing-bytes",
  },
  {
    name: "overflow",
    chunks: ["x".repeat(513)],
    failure: "control-event-overflow",
  },
  { name: "eof", chunks: [], eof: true, failure: "control-event-eof" },
  {
    name: "valid-eof",
    chunks: [eventLine],
    eof: true,
    failure: "control-event-eof",
  },
  {
    name: "partial-eof",
    chunks: [eventLine.slice(0, 20)],
    eof: true,
    failure: "control-event-eof",
  },
  {
    name: "child-exit",
    chunks: [],
    childExit: true,
    failure: "child-exited-before-expected-terminal-or-event",
  },
  { name: "missing", chunks: [], failure: "terminal-event-step-deadline" },
  {
    name: "terminal-missing",
    chunks: [eventLine],
    failure: "terminal-event-step-deadline",
  },
  {
    name: "nonzero-quit",
    chunks: [eventLine],
    quitCode: 7,
    failure: "child-quit-nonzero-or-forced",
  },
  {
    name: "late-duplicate-quit",
    chunks: [eventLine],
    early: true,
    late: [eventLine],
    failure: "control-event-duplicate",
  },
  {
    name: "late-trailing-quit",
    chunks: [eventLine],
    early: true,
    late: ["x"],
    failure: "control-event-trailing-bytes",
  },
  {
    name: "late-eof-quit",
    chunks: [eventLine],
    early: true,
    lateEof: true,
    failure: "control-event-eof",
  },
];
it.runIf(windows).each(conptyControls)(
  "ConPTY $name: reached native console/input prerequisites, strict barrier and original wait-before-close",
  async (control) => {
    const arg = '中文 🧪 space % ! "quote" trailing\\';
    const root = mkdtempSync(path.join(tmpdir(), "cadence-terminal-"));
    console.log(
      `terminal ConPTY barrier ${control.name} fixture retained: ${root}`,
    );
    for (const dir of ["home", "agent", "state", "appdata", "temp"])
      mkdirSync(path.join(root, dir), { mode: 0o700 });
    const env = { ...terminalEnvironment(root), FIXTURE_UNICODE: arg };
    const program = conptySmokeProgram(control);
    const config = path.join(root, "conpty.json");
    writeFileSync(
      config,
      JSON.stringify({
        root,
        cwd: root,
        smokePrerequisite: true,
        smokeBufferedControl: Boolean(control.early),
        smokeAwaitControlFault: Boolean(
          control.failure?.startsWith("control-") &&
            !control.late &&
            !control.lateEof,
        ),
        ...(control.late || control.lateEof
          ? { smokeLateControl: control.lateEof ? "eof" : "bytes" }
          : {}),
        ...(control.name === "split" ? { controlReadSize: 20 } : {}),
        argv: [process.execPath, "-e", program, "--", arg],
        env,
        steps: [
          { expect: "CONSOLE_READY 中文 🧪", send: [enter] },
          {
            expect:
              control.name === "terminal-missing"
                ? "NEVER_RENDERED"
                : "FOREGROUND",
            event: pendingEvent.event,
            resize: [28, 72],
          },
          { expect: "RESIZE_OBSERVED 72 28", send: [esc] },
          { expect: "ESC_SEEN", send: [enter] },
        ],
      }),
    );
    const driver = startDriver(config);
    const prerequisite = Promise.race([
      driver.smokeReady,
      driver.closed.then(() => {
        throw new Error("native-smoke-prerequisite-not-reached");
      }),
    ]);
    // Only separately labelled valid early parser payloads queue before
    // nativeReady. Every fault is published AFTER the owned native gate.
    if (!control.early) await prerequisite;
    for (const chunk of control.chunks) driver.control.write(chunk);
    if (control.eof) driver.control.end();
    await prerequisite;
    if (control.late || control.lateEof) {
      await Promise.race([
        driver.lateParked,
        driver.closed.then(() => {
          throw new Error("late-control-park-not-reached");
        }),
      ]);
      for (const chunk of control.late ?? []) driver.control.write(chunk);
      if (control.lateEof) driver.control.end();
    }
    const status = await driver.closed;
    const receipt = JSON.parse(
      readFileSync(path.join(root, "pty-receipt.json"), "utf8"),
    );
    expect(receipt.transport, control.name).toBe("windows-conpty");
    expect(receipt.smokePrerequisiteReached, control.name).toBe(true);
    expect(receipt.createProcessInheritHandles, control.name).toBe(false);
    expect(receipt.handleInheritance, control.name).toHaveLength(5);
    expect(
      receipt.handleInheritance.every(
        (fact) => !fact.inheritable && (fact.flags & 1) === 0,
      ),
      control.name,
    ).toBe(true);
    expect(
      receipt.observations.some(
        (fact) => fact.pattern === "CONSOLE_READY 中文 🧪" && fact.matched,
      ),
      control.name,
    ).toBe(true);
    expect(
      receipt.observations.some(
        (fact) => fact.pattern === "CONSOLE_INPUT_ISOLATED" && fact.matched,
      ),
      control.name,
    ).toBe(true);
    expect(receipt).not.toHaveProperty("waitpidReturned");
    expect(receipt.failure, control.name).toBe(control.failure);
    expect(status, control.name).toBe(control.failure ? 1 : 0);
    expect(receipt.nativeWaitReturned, control.name).toBe(true);
    expect(receipt.nativeWaitResult, control.name).toBe(0);
    expect(receipt.waitBeforeClose, control.name).toBe(true);
    expect(receipt.closePseudoConsoleReturned, control.name).toBe(true);
    expect(receipt.teardownFailure, control.name).toBeNull();
    expect(receipt.outputEof, control.name).toBe(true);
    expect(receipt.resourcesRetained, control.name).toBe(false);
    expect(
      receipt.pumps.every((pump) => pump.joined),
      control.name,
    ).toBe(true);
    expect(receipt.nativeWaitError, control.name).toBeNull();
    expect(receipt.exitCodeError, control.name).toBeNull();
    expect(driver.errors, control.name).toBe("");
    if (control.eof || control.lateEof) {
      const pump = receipt.pumps.find((item) => item.kind === "control");
      expect(pump.firstIoFault).toMatchObject({
        api: "PeekNamedPipe",
        error: 109,
      });
      expect(receipt.firstNativeFault).toMatchObject({
        api: "PeekNamedPipe",
        error: 109,
      });
    }
    expect(receipt.firstWaitFailure).toBeNull();
    expect(receipt.firstExitFailure).toBeNull();
    if (
      !control.failure ||
      control.quitCode ||
      control.late ||
      control.lateEof
    ) {
      expect(receipt.exitCode, control.name).toBe(control.quitCode ?? 0);
      expect(receipt.forced, control.name).toBe(false);
      expect(receipt.cleanQuit, control.name).toBe(!control.failure);
      if (control.early)
        expect(receipt.barrier.receivedBeforeWait, control.name).toBe(true);
      expect(receipt.barrier.event, control.name).toEqual(pendingEvent);
      expect(receipt.barrier.consumed, control.name).toBe(true);
      expect(receipt.barrier.escapeAfterReady, control.name).toBe(true);
      if (control.name === "split") {
        expect(receipt.barrier.readSize).toBe(20);
        expect(receipt.barrier.reads).toBeGreaterThanOrEqual(4);
      }
      if (control.name === "at-boundary")
        expect(receipt.barrier.bytes).toBe(512);
      if (control.late || control.lateEof) {
        expect(receipt.quitObservedBeforeTeardown, control.name).toBe(true);
        expect(receipt.controlCutoff.requested, control.name).toBe(true);
        expect(receipt.controlCutoff.reached, control.name).toBe(false);
        expect(receipt.lateControl.parked, control.name).toBe(true);
        if (control.lateEof) expect(receipt.lateControl.queuedError).toBe(109);
        else {
          expect(receipt.lateControl.queuedAvailable).toBeGreaterThan(0);
          expect(receipt.controlCutoff.reads).toBeGreaterThan(0);
        }
      } else if (!control.failure) {
        expect(receipt.controlCutoff).toMatchObject({
          requested: true,
          reached: true,
          available: 0,
          futureInputValidated: false,
        });
      }
      // Escape is sent only after the event and the foreground AND real resize.
      expect(receipt.resizeCalls, control.name).toEqual([
        { rows: 28, columns: 72, hresult: 0 },
      ]);
      expect(
        receipt.escapeKeys[0].elapsedMs,
        control.name,
      ).toBeGreaterThanOrEqual(100);
    } else {
      expect(receipt.cleanQuit, control.name).toBe(false);
      expect(receipt.barrier.escapeAfterReady, control.name).toBe(false);
    }
  },
  90000,
);

// Scheduling/start refusal injections are NOT reproduced OS Thread.Start faults.
it.runIf(windows).each(["start-input", "ready-input", "late-input"])(
  "ConPTY injected $0 lifecycle: independently bounded teardown of partial startup",
  async (injection) => {
    const root = mkdtempSync(path.join(tmpdir(), "cadence-terminal-"));
    console.log(
      `terminal ConPTY lifecycle ${injection} fixture retained: ${root}`,
    );
    for (const dir of ["home", "agent", "state", "appdata", "temp"])
      mkdirSync(path.join(root, dir), { mode: 0o700 });
    const config = path.join(root, "conpty.json");
    writeFileSync(
      config,
      JSON.stringify({
        root,
        cwd: root,
        env: terminalEnvironment(root),
        argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        smokePumpFault: injection,
        steps: [],
      }),
    );
    const driver = startDriver(config);
    const status = await driver.closed;
    const receipt = JSON.parse(
      readFileSync(path.join(root, "pty-receipt.json"), "utf8"),
    );
    expect(status).toBe(1);
    expect(receipt.smokePumpInjection).toBe(injection);
    expect(receipt.failure).toBe(
      injection === "start-input"
        ? "injected-pump-start-failed"
        : "pump-start-deadline",
    );
    expect(receipt.cleanQuit).toBe(false);
    expect(receipt.nativeWaitReturned).toBe(true);
    expect(receipt.forced).toBe(true);
    expect(receipt.closePseudoConsoleReturned).toBe(true);
    expect(receipt.outputEof).toBe(true);
    expect(receipt.teardownFailure).toBeNull();
    expect(receipt.resourcesRetained).toBe(false);
    const input = receipt.pumps.find((pump) => pump.kind === "input");
    expect(input.startAttempted).toBe(injection !== "start-input");
    expect(input.started).toBe(injection !== "start-input");
    expect(input.joined).toBe(injection !== "start-input");
    expect(input.ready).toBe(false);
    expect(input.handleRetained).toBe(false);
    expect(receipt.pumps.find((pump) => pump.kind === "output").joined).toBe(
      true,
    );
    expect(
      receipt.resourceCloses.some(
        (fact) => fact.resource === "child-process" && fact.returned,
      ),
    ).toBe(true);
    expect(driver.errors).toBe("");
  },
  90000,
);
