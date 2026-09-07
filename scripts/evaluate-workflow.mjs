import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEvaluationMetrics,
  evaluationScenarios,
} from "./workflow-evaluation.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const scenarioId = option("--scenario", "small-fix");
const scenario = evaluationScenarios.find((item) => item.id === scenarioId);
if (!scenario) throw new Error("evaluation-scenario-invalid");
const timeoutMs = Number(option("--timeout-ms", "600000"));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000)
  throw new Error("evaluation-timeout-invalid");
const live = args.includes("--live");
const root = mkdtempSync(path.join(tmpdir(), "cadence-evaluation-"));
const consumer = path.join(root, "consumer");
const started = Date.now();
const metrics = createEvaluationMetrics();
let child;
let stop;
let settled;
let wake;
let reason = "preflight-only";
let sessions = 0;
let accumulatedTokens = 0;
let accumulatedCost = 0;
const controller = new AbortController();
let oracle;
let evaluation;
let closingHost;
const pending = new Map();
let commandId = 0;

function send(type, rest = {}) {
  const host = child;
  if (
    !host ||
    host.exitCode !== null ||
    host.stdin.destroyed ||
    host.stdin.writableEnded
  )
    return Promise.reject(new Error("evaluation-host-stopped"));
  const id = String(++commandId);
  return new Promise((resolve, reject) => {
    const settle = (callback, value) => {
      if (!pending.has(id)) return;
      pending.delete(id);
      clearTimeout(timer);
      callback(value);
    };
    const request = {
      host,
      resolve: (response) => settle(resolve, response),
      reject: (error) => settle(reject, error),
    };
    const timer = setTimeout(
      () => request.reject(new Error("evaluation-rpc-timeout")),
      15000,
    );
    pending.set(id, request);
    host.stdin.write(`${JSON.stringify({ id, type, ...rest })}\n`, (error) => {
      if (error) request.reject(new Error("evaluation-host-stopped"));
    });
  });
}
async function closeHost() {
  if (closingHost) return closingHost;
  if (!child) return;
  const current = child;
  const stopped = stop;
  closingHost = (async () => {
    try {
      await send("abort");
    } catch {
      /* Still terminate and join on protocol failure. */
    }
    try {
      // Collect each host once, including completed calls before a deadline.
      await statistics();
    } catch {
      /* A stopped host cannot report additional usage. */
    }
    current.stdin.end();
    const terminate = (signal) => {
      try {
        if (process.platform === "win32") current.kill(signal);
        else process.kill(-current.pid, signal);
      } catch {
        current.kill(signal);
      }
    };
    terminate("SIGTERM");
    const force = setTimeout(() => terminate("SIGKILL"), 1500);
    await stopped;
    clearTimeout(force);
    terminate("SIGKILL");
    child = undefined;
  })();
  try {
    await closingHost;
  } finally {
    closingHost = undefined;
  }
}
async function openHost() {
  controller.signal.throwIfAborted();
  sessions++;
  const model = option("--model");
  child = spawn(
    option("--pi", "pi"),
    [
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--approve",
      "--no-extensions",
      "--extension",
      path.join(packageRoot, "src/index.ts"),
      "--no-skills",
      "--no-themes",
      "--no-context-files",
      "--tools",
      "read,bash,edit,write,grep,find,ls,abel_dispatch",
      ...(model ? ["--model", model] : []),
    ],
    {
      cwd: consumer,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        XDG_STATE_HOME: path.join(root, "state"),
        PI_TELEMETRY: "0",
        OPENSPEC_TELEMETRY: "0",
      },
    },
  );
  stop = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });
  const host = child;
  const rejectRequests = () => {
    for (const request of pending.values())
      if (request.host === host)
        request.reject(new Error("evaluation-host-stopped"));
  };
  host.stdin.on("error", rejectRequests);
  host.once("close", rejectRequests);
  host.once("error", rejectRequests);
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
      reason = "rpc-output-limit";
      child.kill("SIGTERM");
      return;
    }
    for (;;) {
      const offset = buffer.indexOf("\n");
      if (offset < 0) break;
      const line = buffer.slice(0, offset);
      buffer = buffer.slice(offset + 1);
      try {
        const event = JSON.parse(line);
        metrics.observe(event);
        if (event.type === "response" && pending.has(event.id)) {
          pending.get(event.id).resolve(event);
        }
        if (event.type === "agent_settled") wake?.();
      } catch {
        /* Non-protocol startup diagnostics never enter the report. */
      }
    }
  });
  const commands = await send("get_commands");
  controller.signal.throwIfAborted();
  if (
    !commands.success ||
    !commands.data?.commands?.some(
      (item) =>
        item.name === "abel-design" &&
        item.sourceInfo?.origin === "package" &&
        item.sourceInfo?.baseDir === packageRoot,
    )
  )
    throw new Error("evaluation-package-activation-unavailable");
}
async function prompt(message) {
  controller.signal.throwIfAborted();
  settled = new Promise((resolve) => {
    wake = resolve;
  });
  const result = await send("prompt", { message });
  if (!result.success) throw new Error("evaluation-model-unavailable");
  await Promise.race([
    settled,
    stop.then(() => {
      throw new Error("evaluation-host-stopped");
    }),
  ]);
  controller.signal.throwIfAborted();
}
async function statistics() {
  const stats = await send("get_session_stats");
  if (stats.success) {
    accumulatedTokens += metrics.result.tokens;
    accumulatedCost += metrics.result.cost;
  }
}

try {
  mkdirSync(path.join(consumer, ".pi"), { recursive: true });
  mkdirSync(path.join(consumer, "src"));
  mkdirSync(path.join(consumer, "test"));
  mkdirSync(path.join(consumer, "openspec/specs"), { recursive: true });
  mkdirSync(path.join(consumer, "openspec/changes"), { recursive: true });
  writeFileSync(
    path.join(consumer, ".pi/settings.json"),
    JSON.stringify({ packages: [packageRoot] }),
  );
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({
      name: "cadence-eval-consumer",
      private: true,
      type: "module",
      scripts: { test: "node --test test/*.test.mjs" },
    }),
  );
  writeFileSync(
    path.join(consumer, "openspec/config.yaml"),
    "schema: spec-driven\n",
  );
  writeFileSync(
    path.join(consumer, "src/math.mjs"),
    "export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a + b;\n",
  );
  writeFileSync(
    path.join(consumer, "test/math.test.mjs"),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {add} from '../src/math.mjs'; test('existing zero identity',()=>assert.equal(add(0,0),0));\n",
  );
  for (const argv of [
    ["init", "--quiet"],
    ["add", "."],
    [
      "-c",
      "user.name=Cadence Evaluation",
      "-c",
      "user.email=evaluation@localhost",
      "commit",
      "--quiet",
      "-m",
      "evaluation fixture",
    ],
  ])
    execFileSync("git", argv, { cwd: consumer, stdio: "ignore" });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort(new Error("evaluation-deadline"));
      reject(controller.signal.reason);
    }, timeoutMs);
    timer.unref();
  });
  evaluation = (async () => {
    await openHost();
    if (!live) return;
    await prompt(
      `/abel-design ${scenario.requirement} Use change name eval-${scenario.id}. The requirement is approved: choose reasonable implementation defaults, record a structured ChangeContract, preserve these acceptance criteria, and compile the delivery. Use the existing Node runner without installing dependencies. You may edit src/ and test/ and change artifacts in this disposable fixture.`,
    );
    if (!metrics.result.designCompleted) {
      reason = metrics.result.modelErrors
        ? "evaluation-model-unavailable"
        : scenario.expected === "blocked"
          ? "capability-or-design-blocked"
          : "design-stalled";
      if (!metrics.result.modelErrors) metrics.result.userInterventions++;
      return;
    }
    if (scenario.restart) {
      await closeHost();
      await openHost();
    }
    const priorModelErrors = metrics.result.modelErrors;
    await prompt(`/abel-implement eval-${scenario.id}`);
    if (!metrics.result.completed) {
      const modelUnavailable = metrics.result.modelErrors > priorModelErrors;
      reason = modelUnavailable
        ? "evaluation-model-unavailable"
        : "implementation-stalled";
      if (!modelUnavailable) metrics.result.userInterventions++;
      return;
    }
    const assertion =
      scenario.id === "multiple-tasks"
        ? "if(add(2,3)!==5||multiply(2,3)!==6)process.exit(1)"
        : "if(add(2,3)!==5)process.exit(1)";
    oracle = (async () => {
      const { BubblewrapIsolationBackend } = await import(
        "../src/isolation-backend.ts"
      );
      const { prepareVerificationEnvironment } = await import(
        "../src/verification-environment.ts"
      );
      const { resolveVerificationRunner } = await import(
        "../src/verification-capability.ts"
      );
      const runner = resolveVerificationRunner("node");
      if (!runner) throw new Error("evaluation-oracle-unavailable");
      const environment = prepareVerificationEnvironment(consumer, consumer, [
        runner,
      ]);
      try {
        const result = await new BubblewrapIsolationBackend({
          timeoutMs: 5000,
        }).run({
          root: consumer,
          executable: environment.bindings[0].executablePath,
          args: [
            "--input-type=module",
            "-e",
            `import {add,multiply} from './src/math.mjs';${assertion}`,
          ],
          mounts: environment.mounts,
          environment: environment.environment,
          signal: controller.signal,
        });
        if (!result.ok || result.exitCode !== 0)
          throw new Error("evaluation-oracle-rejected");
      } finally {
        environment.cleanup();
      }
    })();
    await oracle;
    reason = "verified-completion";
  })();
  await Promise.race([evaluation, timeout]);
} catch (error) {
  reason = [
    "evaluation-deadline",
    "evaluation-package-activation-unavailable",
    "evaluation-rpc-timeout",
    "evaluation-model-unavailable",
    "evaluation-host-stopped",
  ].includes(error?.message)
    ? error.message
    : "evaluation-failed";
} finally {
  controller.abort();
  await closeHost();
  if (evaluation) await evaluation.catch(() => {});
  if (oracle) await oracle.catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
const report = {
  scenario: scenario.id,
  mode: live ? "live-model" : "preflight",
  reason,
  success: live && reason === "verified-completion",
  elapsedMs: Date.now() - started,
  sessions,
  ...metrics.result,
  tokens: accumulatedTokens,
  cost: accumulatedCost,
};
const output = option("--output");
if (output)
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (live ? !report.success : reason !== "preflight-only") process.exitCode = 1;
