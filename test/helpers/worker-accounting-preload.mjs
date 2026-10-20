// FIXTURE ONLY. Open exactly one private receipt before the unchanged host guard.
// Never grants the worker a new filesystem/process/network operation.
import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, resolve } from "node:path";
import { observeAccounting } from "./worker-accounting-observer.mjs";

const path = process.env.CADENCE_W2_OBSERVATION;
if (
  !path ||
  dirname(path) !== resolve(process.env.TMPDIR) ||
  !/cadence-w2-producer-[^/]+\.accounting\.json$/.test(path)
)
  throw new Error("invalid fixture receipt");
const fd = fs.openSync(path, "wx", 0o600);
const write = fs.writeSync,
  close = fs.closeSync;
const observation = observeAccounting();
const bash = {
  launches: 0,
  callbacks: 0,
  totalBytes: 0,
  maxBytes: 0,
  exitObserved: false,
  exitCode: null,
  closeObserved: false,
  signalObserved: false,
};
await import("./worker-bash-guard.mjs");
const spawn = cp.spawn;
cp.spawn = function (...args) {
  const child = spawn.apply(this, args); // original guard, exact command allowance
  try {
    bash.launches = Math.min(1000000, bash.launches + 1);
    const data = (chunk) => {
      try {
        bash.callbacks = Math.min(1000000, bash.callbacks + 1);
        bash.totalBytes = Math.min(2 ** 30, bash.totalBytes + chunk.length);
        bash.maxBytes = Math.max(bash.maxBytes, chunk.length);
      } catch {
        /* fixed nonthrowing observation */
      }
    };
    child.stdout?.on("data", data);
    child.stderr?.on("data", data);
    child.once("exit", (code, signal) => {
      bash.exitObserved = true;
      bash.exitCode = Number.isInteger(code) ? code : null;
      bash.signalObserved = signal !== null;
    });
    child.once("close", () => {
      bash.closeObserved = true;
    });
  } catch {
    /* original child remains the authority */
  }
  return child;
};
syncBuiltinESMExports();
process.once("exit", () => {
  try {
    const body = JSON.stringify({
      schema: "cadence-w2-fixture-accounting/1",
      ...observation.facts,
      bash,
    });
    if (Buffer.byteLength(body) <= 8192) write(fd, body);
  } catch {
    /* missing receipt is not a pass */
  } finally {
    try {
      close(fd);
    } catch {
      /* no raw diagnostic */
    }
  }
});
