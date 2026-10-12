// Actual production CLI + OS PTY + synthetic loopback SDK. No physical-human/provider claim.
import { spawn, spawnSync } from "node:child_process";
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
import { expect, it, vi } from "vitest";
import { auditPackage } from "../scripts/package-audit.mjs";
import { diagnosticText } from "../src/verification-diagnostics.ts";

const repo = path.resolve(import.meta.dirname, "..");
const cli = path.join(
  repo,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
const pendingEvent = {
  event: "cancellation-http-pending",
  requestOrdinal: 4,
  editingOrdinal: 3,
};
const eventLine = `${JSON.stringify(pendingEvent)}\n`;
const safeText = (value, maximum = 256) =>
  diagnosticText(String(value), maximum, ["fabricated-terminal-key"]);

function saveIdentity(root, identity) {
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

function startDriver(config) {
  const child = spawn(
    "python3",
    [path.join(repo, "test/helpers/task-shell-pty.py"), config],
    { stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const result = { child, status: null, errors: "", stderrBytes: 0 };
  child.stdio[3].on("error", () => {
    result.controlError = "control-pipe-error";
  });
  child.stdout.resume();
  child.stderr.on("data", (bytes) => {
    result.stderrBytes += bytes.length;
    result.errors = (result.errors + bytes).slice(0, 4096);
  });
  result.closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => {
      result.status = status;
      child.stdio[3].destroy();
      resolve(status);
    });
  });
  return result;
}

const down = "\x1b[B",
  enter = "\r",
  esc = "\x1b";
for (const source of ["source", "extracted"])
  for (const mode of ["regular", "fullscreen"]) {
    it.skipIf(process.platform === "win32")(
      `${source} ${mode} production PTY plan, SDK edit, real checks, issues review, reopen and waited cancel/quit`,
      async () => {
        const root = mkdtempSync(path.join(tmpdir(), "cadence-terminal-"));
        console.log(`terminal fixture retained: ${root}`);
        let packageRoot = repo;
        const requests = [];
        let codeRequests = 0;
        let server, driver;
        let piVersion = null;
        let serverFailure = null;
        const barrier = {
          published: false,
          delivered: false,
          transportError: null,
        };
        let stage = "setup";
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
            mkdirSync(path.join(root, dir));
          if (source === "extracted") {
            stage = "pack";
            const pack = path.join(root, "pack");
            mkdirSync(pack);
            const packed = spawnSync(
              "bun",
              ["pm", "pack", "--destination", pack],
              { cwd: repo, encoding: "utf8", timeout: 30000 },
            );
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
            for (const name of ["@earendil-works", "typebox"])
              symlinkSync(
                path.join(repo, "node_modules", name),
                path.join(root, "install/node_modules", name),
                "dir",
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
              const editing = body.tools.some(
                (t) => t.function.name === "write",
              );
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
                driver.child.stdio[3].write(eventLine, (error) => {
                  if (error)
                    barrier.transportError = "control-pipe-write-failed";
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
          await new Promise((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
          );
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
          );
          const cwd = path.join(root, "project");
          mkdirSync(path.join(cwd, ".cadence/assistant"), { recursive: true });
          writeFileSync(
            path.join(cwd, ".cadence/assistant/config.json"),
            JSON.stringify({
              schema: "cadence-assistant-checks/1",
              checks: [
                { name: "Pass fixture", command: "true", timeoutMs: 1000 },
                { name: "Fail fixture", command: "false", timeoutMs: 1000 },
              ],
            }),
          );
          writeFileSync(
            path.join(cwd, "existing.txt"),
            "pre-existing user bytes",
          );
          const env = {
            PATH: process.env.PATH,
            HOME: path.join(root, "home"),
            XDG_STATE_HOME: path.join(root, "state"),
            PI_CODING_AGENT_DIR: path.join(root, "agent"),
            PI_OFFLINE: "1",
            PI_SKIP_VERSION_CHECK: "1",
            PI_TELEMETRY: "0",
            JITI_FS_CACHE: "0",
            NODE_DISABLE_COMPILE_CACHE: "1",
            TERM: "xterm-256color",
          };
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
          const steps = [
            { expect: "Context7", send: ["/cadence PTY 中文 🧪", enter] },
            { expect: "legacy history is not imported", send: [enter] },
            { expect: "Task kind", send: [enter] },
            { expect: "Goal \\(saving does not start work\\)", send: [enter] },
            { expect: "planning", send: [enter] },
            {
              expect: "Readable plan",
              send: ["Inspect and write fixture.txt only.", enter],
            },
            { expect: "planning", send: [down, enter] },
            { expect: "Cadence review", send: [enter] },
            { expect: "Generate an advisory plan", send: [enter] },
            { expect: "planning", send: [down, down, enter] },
            {
              expect: "Cadence review",
              resize: [28, 72],
              send: ["\x1b[6~", "\x1b[F", "\x1b[H", enter],
            },
            { expect: "Start one agent now", send: [enter] },
            { expect: "PTY 中文 🧪.*review", send: [down, down, down, enter] },
            { expect: "Parent checks", send: [enter] },
            { expect: "Run this parent check", send: [enter] },
            { expect: "PTY 中文 🧪.*review", send: [down, down, down, enter] },
            { expect: "Parent checks", send: [down, enter] },
            { expect: "Run this parent check", send: [enter] },
            {
              expect: "PTY 中文 🧪.*failed",
              send: [down, down, down, down, enter],
            },
            {
              expect: "Cadence review",
              resize: [40, 100],
              send: ["\x1b[6~", "\x1b[F", enter],
            },
            { expect: "Record human review and close", send: [enter] },
            { expect: "PTY 中文 🧪.*done", send: [esc] },
            { send: ["/cadence", enter] },
            { expect: "legacy history is not imported", send: [down, enter] },
            { expect: "Open context only", send: [enter] },
            { expect: "PTY 中文 🧪.*done", send: [down, down, enter] },
            { expect: "Cadence review", send: [enter] },
            { expect: "Start one agent now", send: [enter] },
            {
              expect: "Cadence foreground work",
              event: pendingEvent.event,
              send: [esc],
            },
            { expect: "PTY 中文 🧪.*interrupted", send: [esc] },
            { send: ["/quit", enter] },
          ];
          const config = path.join(root, "pty.json");
          writeFileSync(
            config,
            JSON.stringify({ root, cwd, argv, env, steps, controlFd: 3 }),
          );
          stage = "production-pty";
          driver = startDriver(config);
          driver.child.stdio[3].on("error", () => {
            barrier.transportError = "control-pipe-error";
          });
          const status = await driver.closed;
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
          expect(receipt.waitpidReturned).toBe(true);
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
          expect(
            task.activity.some(
              (a) => a.text === "Human reviewed-with-issues; not certified",
            ),
          ).toBe(true);
          expect(existsSync(path.join(root, "home/.pi/agent/auth.json"))).toBe(
            false,
          );
          stage = "complete";
        } finally {
          try {
            if (server?.listening) {
              server.closeAllConnections();
              await new Promise((resolve) => server.close(resolve));
            }
          } finally {
            // Failure-safe whitelist projection: never publish auth, raw HTTP
            // bodies/prompts, CLI configuration or environment snapshots.
            const receiptPath = path.join(root, "pty-receipt.json");
            saveIdentity(root, {
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
            });
          }
        }
      },
      90000,
    );
  }

it("identity diagnostic I/O and bounds cannot replace the original failure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-identity-"));
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const original = new Error("original-fixture-assertion");
  let observed;
  try {
    try {
      try {
        throw original;
      } finally {
        saveIdentity(path.join(root, "absent-parent"), { stage: "assertions" });
      }
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(original);
    saveIdentity(root, { overBound: "x".repeat(17 * 1024) });
    expect(existsSync(path.join(root, "identity.json"))).toBe(false);
    expect(errors.mock.calls).toEqual([
      ["terminal identity unavailable"],
      ["terminal identity unavailable"],
    ]);
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
