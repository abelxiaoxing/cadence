import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRequest } from "./protocol.mjs";

export function settlement({
  rootExited,
  groupExists,
  expired,
  reason = "exit",
}) {
  const settled = rootExited && !groupExists;
  return {
    version: 1,
    outcome: settled
      ? reason === "exit"
        ? "complete"
        : "failed"
      : "uncertain",
    reason: settled
      ? reason
      : expired
        ? "termination-unconfirmed"
        : "termination-unconfirmed",
    rootExited,
    managedSettled: settled,
    descendantsReaped: settled,
  };
}
function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
function finishObservation(observation, code) {
  // Pipes are asynchronous on macOS. Exiting immediately after console.log
  // can discard the only settlement receipt even though the group is gone.
  process.stdout.write(`${JSON.stringify(observation)}\n`, () =>
    process.exit(code),
  );
}
// Separate EOF monitor survives supervisor death. Only the inherited process
// group is in scope; deliberate setsid/daemonization is explicitly unsupported.
function watch(pid, timeoutMs, shutdownMs) {
  let rootExited = false;
  let reason = "exit";
  let stopping = 0;
  const start = performance.now();
  const stop = (why) => {
    if (!stopping) {
      reason = why;
      stopping = performance.now();
      signalGroup(pid, "SIGTERM");
    }
  };
  process.stdin.on("data", (data) => {
    for (const byte of data.toString()) {
      if (byte === "R") rootExited = true;
      else stop(byte === "L" ? "output-limit" : "cancelled");
    }
  });
  process.stdin.on("end", () => stop("cancelled"));
  const timer = setInterval(() => {
    try {
      rootExited ||= !exists(pid);
      const groupExists = exists(-pid);
      if (rootExited && !groupExists) {
        clearInterval(timer);
        finishObservation(
          settlement({ rootExited, groupExists, expired: false, reason }),
          0,
        );
        return;
      }
      if (!stopping && performance.now() - start >= timeoutMs) stop("timeout");
      if (
        stopping &&
        performance.now() - stopping >= Math.min(250, shutdownMs / 2)
      )
        signalGroup(pid, "SIGKILL");
      if (stopping && performance.now() - stopping >= shutdownMs) {
        clearInterval(timer);
        finishObservation(
          settlement({ rootExited, groupExists, expired: true, reason }),
          2,
        );
      }
    } catch {
      clearInterval(timer);
      process.exit(2);
    }
  }, 20);
}
function main() {
  if (process.platform !== "darwin") throw new Error("macOS required");
  if (process.argv[2] === "--watch") {
    const nums = process.argv.slice(3).map(Number);
    if (
      nums.length !== 3 ||
      nums.some((v) => !Number.isSafeInteger(v) || v <= 1) ||
      nums[1] > 60000 ||
      nums[2] > 10000
    )
      throw new Error("invalid monitor");
    watch(...nums);
    return;
  }
  if (process.argv.length !== 2)
    throw new Error("invalid supervisor arguments");
  const admissionTimer = setTimeout(() => process.exit(1), 5000);
  let input = Buffer.alloc(0);
  let monitor;
  let admitted = false;
  let ended = false;
  const control = (byte) => {
    if (monitor?.stdin.writable) monitor.stdin.write(byte);
  };
  process.stdin.on("end", () => {
    ended = true;
    control("C");
  });
  process.stdin.on("data", (chunk) => {
    if (admitted) {
      control("C");
      return;
    }
    input = Buffer.concat([input, chunk]);
    if (input.length > 60001) process.exit(1);
    const newline = input.indexOf(10);
    if (newline < 0) return;
    admitted = true;
    clearTimeout(admissionTimer);
    try {
      const request = validateRequest(
        JSON.parse(input.subarray(0, newline).toString()),
        "darwin",
      );
      const child = spawn(request.executable, request.argv, {
        cwd: request.cwd,
        env: request.env,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", () => {
        console.log(
          JSON.stringify({
            version: 1,
            outcome: "failed",
            reason: "launch-failed",
            rootExited: false,
            managedSettled: true,
            descendantsReaped: true,
          }),
        );
        process.exitCode = 1;
        process.stdin.destroy();
      });
      child.on("spawn", () => {
        monitor = spawn(
          process.execPath,
          [
            fileURLToPath(import.meta.url),
            "--watch",
            String(child.pid),
            String(request.timeoutMs),
            String(request.shutdownMs),
          ],
          { env: {}, stdio: ["pipe", "inherit", "ignore"] },
        );
        monitor.stdin.on("error", () => {});
        monitor.on("error", () => {
          signalGroup(child.pid, "SIGKILL");
          process.exit(2);
        });
        monitor.on("exit", (code) => process.exit(code ?? 2));
        if (ended || input.length > newline + 1) control("C");
      });
      child.on("exit", () => control("R"));
      let count = 0;
      const output = (data) => {
        count += data.length;
        if (count > request.outputLimit) control("L");
        else console.log(JSON.stringify({ outputHex: data.toString("hex") }));
      };
      child.stdout.on("data", output);
      child.stderr.on("data", output);
    } catch {
      process.exit(1);
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    console.error("macOS prototype unavailable");
    process.exitCode = 1;
  }
}
