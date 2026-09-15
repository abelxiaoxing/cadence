import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { arch, release, tmpdir, version } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, verifyHelper } from "./build.mjs";
import {
  encodeWindowsRequest,
  validateObservation,
  validateRequest,
} from "./protocol.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export function planCases(platform) {
  if (!["win32", "darwin"].includes(platform))
    throw new Error("native platform unavailable");
  return [
    ...(platform === "win32" ? ["assignment-failure"] : []),
    "root-exit",
    "stream",
    "output-limit",
    "cancel",
    "timeout",
    "parent-loss",
    "helper-failure",
    "unicode-environment",
  ];
}
export function validateCase(name, observation, evidence) {
  validateObservation(observation);
  if (
    evidence?.witness !== true ||
    !observation.managedSettled ||
    !observation.descendantsReaped ||
    observation.outcome === "uncertain"
  )
    throw new Error("missing evidence or unconfirmed termination");
  const expected = {
    "assignment-failure": "launch-failed",
    "root-exit": "timeout",
    "output-limit": "output-limit",
    cancel: "cancelled",
    timeout: "timeout",
    "parent-loss": "cancelled",
    "helper-failure": "helper-failed",
    stream: "exit",
    "unicode-environment": "exit",
  }[name];
  if (
    !expected ||
    observation.reason !== expected ||
    observation.outcome !== (expected === "exit" ? "complete" : "failed")
  )
    throw new Error("unexpected lifecycle result");
  if (name !== "assignment-failure" && !observation.rootExited)
    throw new Error("root not settled");
  return true;
}
export function validateResults(platform, results) {
  const cases = planCases(platform);
  if (
    !Array.isArray(results) ||
    results.length !== cases.length ||
    new Set(results.map((r) => r.name)).size !== cases.length
  )
    throw new Error("incomplete native cases");
  for (const name of cases) {
    const result = results.find((r) => r.name === name);
    if (!result) throw new Error("missing native case");
    validateCase(name, result.observation, result.evidence);
  }
  // Pure validation does not confer native provenance or write a report.
  return true;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
function pids(root) {
  return readdirSync(root)
    .filter((file) => file.endsWith(".pid"))
    .map((file) => {
      const pid = JSON.parse(readFileSync(join(root, file), "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 1)
        throw new Error("invalid fixture pid");
      return pid;
    });
}
async function until(predicate, timeout) {
  const end = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() >= end) throw new Error("bounded case timeout");
    await pause(20);
  }
}
function environment() {
  // Explicit allowlist, never print values. No inherited credential variables.
  const result = {};
  const keys =
    process.platform === "win32"
      ? ["SystemRoot", "WINDIR", "ComSpec", "PATH", "TEMP", "TMP"]
      : ["PATH", "TMPDIR", "LANG"];
  for (const key of keys) {
    const actual = Object.keys(process.env).find((name) =>
      process.platform === "win32"
        ? name.toLowerCase() === key.toLowerCase()
        : name === key,
    );
    if (actual && process.env[actual] !== undefined)
      result[key] = process.env[actual];
  }
  if (process.platform === "win32" && !result.SystemRoot)
    throw new Error("system environment unavailable");
  result.PATH ||= "/usr/bin:/bin";
  return result;
}
async function executeCase(name, helper) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "cadence-host-fixture-")),
  );
  writeFileSync(join(root, ".fixture"), "host-prototype-v1");
  const cwd = join(root, "cwd 中文 space");
  mkdirSync(cwd);
  let executable = process.execPath;
  if (name === "unicode-environment") {
    executable = join(
      root,
      process.platform === "win32" ? "node 中文 space.exe" : "node 中文 space",
    );
    if (process.platform === "win32")
      copyFileSync(process.execPath, executable);
    else symlinkSync(process.execPath, executable);
  }
  const mode =
    name === "root-exit"
      ? "root-exit"
      : name === "output-limit"
        ? "flood"
        : ["stream", "unicode-environment", "assignment-failure"].includes(name)
          ? "stream"
          : "tree";
  const argumentsUnderTest = ["中文 spaced", 'quote"here', "trailing\\", ""];
  const request = validateRequest({
    version: 1,
    executable,
    argv: [
      join(directory, "lifecycle-fixture.mjs"),
      mode,
      root,
      ...argumentsUnderTest,
    ],
    cwd,
    env: environment(),
    timeoutMs: ["root-exit", "timeout"].includes(name) ? 2000 : 10000,
    shutdownMs: 5000,
    outputLimit: name === "output-limit" ? 2048 : 65536,
  });
  const command = process.platform === "win32" ? helper : process.execPath;
  const args =
    process.platform === "win32"
      ? name === "assignment-failure"
        ? ["--assignment-failure"]
        : []
      : [join(directory, "macos-supervisor.mjs")];
  const child = spawn(command, args, {
    shell: false,
    env: environment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let closed = false;
  let launchError = false;
  let invalid = false;
  let pending = "";
  let byteCount = 0;
  let output = "";
  const observations = [];
  child.on("error", () => {
    launchError = true;
  });
  child.on("close", () => {
    closed = true;
  });
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    byteCount += chunk.length;
    if (byteCount > 262144) {
      invalid = true;
      child.stdin.end();
      return;
    }
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (
          Object.keys(value).length === 1 &&
          typeof value.outputHex === "string" &&
          /^(?:[a-f0-9]{2})*$/.test(value.outputHex)
        )
          output += Buffer.from(value.outputHex, "hex").toString();
        else observations.push(validateObservation(value));
      } catch {
        invalid = true;
      }
    }
  });
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 65536) {
      invalid = true;
      child.stdin.end();
    }
  });
  child.stdin.write(
    process.platform === "win32"
      ? encodeWindowsRequest(request)
      : `${JSON.stringify(request)}\n`,
  );
  let evidence;
  try {
    if (["cancel", "parent-loss", "helper-failure"].includes(name)) {
      await until(
        () =>
          existsSync(join(root, "tree.pid")) &&
          existsSync(join(root, "descendant.pid")),
        5000,
      );
      if (name === "helper-failure") child.kill("SIGKILL");
      else if (name === "parent-loss") child.stdin.end();
      else child.stdin.write("C");
    }
    if (name === "root-exit") {
      await until(
        () =>
          existsSync(join(root, "descendant.pid")) &&
          existsSync(join(root, "root-exit.pid")),
        1500,
      );
      await until(
        () =>
          !alive(JSON.parse(readFileSync(join(root, "root-exit.pid"), "utf8"))),
        500,
      );
      evidence = {
        witness: alive(
          JSON.parse(readFileSync(join(root, "descendant.pid"), "utf8")),
        ),
      };
    }
    await until(() => closed || launchError, 18000);
    if (launchError || invalid || pending.trim() || stderrBytes)
      throw new Error("invalid helper execution/protocol");
    await until(() => pids(root).every((pid) => !alive(pid)), 5000);
    if (name === "helper-failure") {
      // This case proves cleanup of these observed fixture processes only.
      // It does not turn arbitrary PID probes into a production Job receipt.
      observations.length = 0;
      observations.push({
        version: 1,
        outcome: "failed",
        reason: "helper-failed",
        rootExited: true,
        managedSettled: true,
        descendantsReaped: true,
      });
      evidence = { witness: pids(root).length === 2 };
    } else if (name === "assignment-failure")
      evidence = {
        witness:
          pids(root).length === 0 && !existsSync(join(root, "witness.json")),
      };
    else if (["stream", "unicode-environment"].includes(name)) {
      const witness = JSON.parse(
        readFileSync(join(root, "witness.json"), "utf8"),
      );
      evidence = {
        witness:
          output.includes("fixture-witness:") &&
          witness.cwd === cwd &&
          witness.environmentPresent === true &&
          JSON.stringify(witness.argv) === JSON.stringify(argumentsUnderTest),
      };
    } else
      evidence ||= {
        witness:
          pids(root).length === (mode === "tree" ? 2 : 1) &&
          (name !== "output-limit" ||
            (Buffer.byteLength(output) > 0 &&
              Buffer.byteLength(output) <= request.outputLimit)),
      };
    if (observations.length !== 1)
      throw new Error("missing/duplicate settlement");
    validateCase(name, observations[0], evidence);
    return {
      name,
      outcome: "complete",
      observation: observations[0],
      evidence,
    };
  } catch (error) {
    error.observation = observations.at(-1);
    error.outcome = error.observation?.managedSettled ? "failed" : "uncertain";
    throw error;
  } finally {
    child.stdin.end();
    // Ownership is limited to live fixture PIDs recorded in this invocation.
    // Retain the root on uncertainty; never operate on persisted user run data.
    if (!closed) {
      child.kill("SIGKILL");
      await until(() => closed, 2000).catch(() => {});
    }
    await cleanupFixture(root);
  }
}
async function cleanupFixture(root) {
  const owned = pids(root);
  for (const pid of owned) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await until(() => owned.every((pid) => !alive(pid)), 5000);
  rmSync(root, { recursive: true, force: true });
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args[0] !== "--require-native" ||
    args[1] !== "--output" ||
    !args[2] ||
    ![3, 5].includes(args.length) ||
    (args.length === 5 && (args[3] !== "--helper" || !args[4]))
  )
    throw new Error("invalid CLI");
  const output = resolve(args[2]);
  mkdirSync(output, { recursive: true });
  // A failed rerun must never leave a stale success marker.
  rmSync(join(output, "qualified.json"), { force: true });
  const results = [];
  const identity = {
    platform: process.platform,
    arch: arch(),
    osRelease: release(),
    osBuild: version(),
    node: process.version,
    nodeSha256: hashFile(process.execPath),
    sources: Object.fromEntries(
      [
        "protocol.mjs",
        "build.mjs",
        "windows-launcher.c",
        "macos-supervisor.mjs",
        "lifecycle-fixture.mjs",
        "qualify.mjs",
      ].map((file) => [file, hashFile(join(directory, file))]),
    ),
  };
  try {
    const cases = planCases(process.platform);
    if (
      !(
        (process.platform === "win32" && process.arch === "x64") ||
        (process.platform === "darwin" &&
          ["x64", "arm64"].includes(process.arch))
      ) ||
      !["v22.13.0", "v24.13.0"].includes(process.version)
    )
      throw new Error("unsupported native runtime");
    const helper = args[4] ? resolve(args[4]) : undefined;
    if (process.platform === "win32") {
      if (!helper) throw new Error("helper required");
      identity.helper = verifyHelper(helper);
    } else if (helper) throw new Error("unexpected helper");
    const git = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      shell: false,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024,
    });
    if (git.status !== 0 || !/^[a-f0-9]{40,64}$/.test(git.stdout.trim()))
      throw new Error("commit identity unavailable");
    identity.commit = git.stdout.trim();
    for (const name of cases) {
      try {
        results.push(await executeCase(name, helper));
      } catch (error) {
        results.push({
          name,
          outcome: error.outcome || "uncertain",
          ...(error.observation ? { observation: error.observation } : {}),
        });
      }
    }
    validateResults(process.platform, results);
    const report = {
      version: 1,
      status: "native-qualified-prototype",
      identity,
      scope:
        process.platform === "win32"
          ? "Job"
          : "process-group; deliberate setsid/daemonize escape unsupported",
      caseCount: results.length,
      results,
    };
    writeFileSync(
      join(output, "qualified.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx" },
    );
  } finally {
    writeFileSync(
      join(output, "diagnostics.json"),
      `${JSON.stringify({ identity, caseCount: results.length, results }, null, 2)}\n`,
    );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "host prototype native qualification failed or unavailable; no support claim",
    );
    process.exitCode = 1;
  });
}
