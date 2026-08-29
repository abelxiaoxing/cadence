import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-isolation-limit-"));
  roots.push(root);
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  const spawnProcess = vi.fn(() => child) as never;
  return { root, child, spawnProcess };
}

describe("BubblewrapIsolationBackend bounds", () => {
  it("waits for verifier close after a running verifier is cancelled", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const controller = new AbortController();
    const backend = new BubblewrapIsolationBackend({
      bwrapPath: "/fixture/bwrap",
      probe: () => true,
      spawnProcess: value.spawnProcess,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
      terminateGraceMs: 10,
    });
    const execution = backend.run({
      root: value.root,
      executable: "/usr/bin/node",
      signal: controller.signal,
    });
    let settled = false;
    void execution.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(value.spawnProcess).toHaveBeenCalledOnce();
    controller.abort();
    expect(value.child.kill).toHaveBeenCalledWith("SIGTERM");
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(value.child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);
    value.child.emit("close", null);
    await expect(execution).resolves.toEqual({
      ok: false,
      state: "cancelled",
      code: "cancelled",
    });
  });

  it("terminates a verifier that exceeds its execution deadline", async () => {
    vi.useFakeTimers();
    const value = fixture();
    const backend = new BubblewrapIsolationBackend({
      bwrapPath: "/fixture/bwrap",
      probe: () => true,
      spawnProcess: value.spawnProcess,
      timeoutMs: 20,
      maxOutputBytes: 1024,
      terminateGraceMs: 10,
    });
    const execution = backend.run({
      root: value.root,
      executable: "/usr/bin/node",
    });
    let settled = false;
    void execution.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(21);

    expect(value.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(value.child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(settled).toBe(false);
    value.child.emit("close", null);
    await expect(execution).resolves.toEqual({
      ok: false,
      state: "paused",
      code: "isolation-execution-timeout",
    });
  });

  it("caps combined stdout and stderr bytes and terminates a noisy verifier", async () => {
    const value = fixture();
    const backend = new BubblewrapIsolationBackend({
      bwrapPath: "/fixture/bwrap",
      probe: () => true,
      spawnProcess: value.spawnProcess,
      timeoutMs: 10_000,
      maxOutputBytes: 8,
      terminateGraceMs: 10,
    });
    const execution = backend.run({
      root: value.root,
      executable: "/usr/bin/node",
    });
    await new Promise((resolve) => setImmediate(resolve));
    value.child.stdout.write("12345");
    value.child.stderr.write("6789");

    let settled = false;
    void execution.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(value.child.kill).toHaveBeenCalledWith("SIGTERM");
    value.child.emit("close", null);
    await expect(execution).resolves.toEqual({
      ok: false,
      state: "paused",
      code: "isolation-output-limit-exceeded",
    });
  });
});
