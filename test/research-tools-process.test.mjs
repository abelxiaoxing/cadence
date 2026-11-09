import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

// Exercise the installed SDK's actual search adapters without requiring an
// external binary, spawning a process or allowing any automatic download.
const seam = { spawn: undefined };
beforeEach(() => {
  // The SDK is externalized by Vitest: update the actual builtin named exports,
  // not a vi.mock namespace that only this test's own imports would observe.
  vi.spyOn(childProcess, "spawnSync").mockImplementation((_command, args) => {
    if (args?.[0] !== "--version")
      throw new Error("Unexpected SDK process probe");
    return { status: 0, stdout: "fixture", stderr: "" };
  });
  vi.spyOn(childProcess, "spawn").mockImplementation((...args) => {
    if (!seam.spawn) throw new Error("Unexpected SDK process");
    return seam.spawn(...args);
  });
  syncBuiltinESMExports();
});
afterEach(() => {
  seam.spawn = undefined;
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture(name) {
  vi.stubEnv("PI_OFFLINE", "1");
  const fetch = vi.fn(async () => {
    throw new Error("Network forbidden");
  });
  vi.stubGlobal("fetch", fetch);
  const root = await mkdtemp(join(tmpdir(), "pi-search-process-"));
  const selected = await mkdtemp(join(tmpdir(), "pi-search-selected-"));
  const kit = createWorkerToolkit({
    runtime: fixtureRuntime(),
    purpose: "research",
    workspace: bindWorkerWorkspace(root, [selected]),
  });
  const tool = kit
    .wrap(kit.sessionOptions.customTools)
    .find((entry) => entry.name === name);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  let spawned;
  const started = new Promise((resolve) => {
    spawned = resolve;
  });
  const spawn = vi.fn((command, args) => {
    spawned({ command, args });
    return child;
  });
  seam.spawn = spawn;
  const finish = (code = 0) => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  };
  const abort = new AbortController();
  let settled = false;
  const result = tool
    .execute("search", { pattern: "fixture" }, abort.signal, undefined, {
      cwd: root,
    })
    .catch((error) => error)
    .finally(() => {
      settled = true;
    });
  const launched = await Promise.race([
    started,
    result.then((outcome) => {
      throw new Error(
        `SDK search settled before the controlled spawn: ${outcome?.message ?? "completed"}`,
      );
    }),
  ]);
  expect(launched.args.at(-1)).toBe(selected);
  return {
    kit,
    child,
    abort,
    result,
    finish,
    fetch,
    settled: () => settled,
    spawn,
  };
}
it("grep preserves SDK cancellation: signal the child, but do not settle before its actual close", async () => {
  const f = await fixture("grep");
  try {
    f.abort.abort();
    expect(f.child.kill).toHaveBeenCalledTimes(1);
    let closed = false;
    const closing = f.kit.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.settled()).toBe(false);
    expect(closed).toBe(false);
    f.finish();
    expect((await f.result).message).toMatch(/aborted|canceled/);
    await closing;
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.fetch).not.toHaveBeenCalled();
  } finally {
    f.finish();
    await f.result;
    await f.kit.close();
  }
});
it("find's early-abort observer cannot release the original search or replay it", async () => {
  const f = await fixture("find");
  try {
    f.abort.abort();
    let closed = false;
    const closing = f.kit.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.settled()).toBe(false);
    expect(closed).toBe(false);
    f.finish();
    expect((await f.result).message).toContain("may have completed");
    await closing;
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.fetch).not.toHaveBeenCalled();
  } finally {
    f.finish();
    await f.result;
    await f.kit.close();
  }
});
it.each(["grep", "find"])(
  "%s preserves SDK process failures instead of reporting empty search evidence",
  async (name) => {
    const f = await fixture(name);
    try {
      f.child.stderr.write("fixture process failure");
      f.finish(2);
      expect((await f.result).message).toContain("fixture process failure");
      expect(f.fetch).not.toHaveBeenCalled();
    } finally {
      f.finish();
      await f.result;
      await f.kit.close();
    }
  },
);
