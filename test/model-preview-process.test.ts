// Controlled native lifetimes: no real child, SDK import or provider call.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processStart } from "../src/service/liveness.ts";
import {
  ModelPreviewProcesses,
  type PreviewSource,
} from "../src/service/model-preview-process.ts";
import {
  PREVIEW_PROCESSES,
  PREVIEW_TIMEOUT_MS,
} from "../src/service/model-preview-protocol.ts";
import { LIMITS, publicError } from "../src/service-contract.ts";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("../src/service/liveness.ts", () => ({
  processStart: vi.fn(() => "ticks:fixture"),
}));
const preview = {
  status: "complete",
  entries: [],
  withheld: 0,
  remembered: null,
};
class Child extends EventEmitter {
  pid = 12345;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdin = new PassThrough();
  stdout = new PassThrough();
  kill = vi.fn(() => true);
  close(code = 0) {
    this.exitCode = code;
    this.emit("close", code, null);
  }
  output(value: unknown = { kind: "ok", value: preview }) {
    this.stdout.write(JSON.stringify(value));
  }
}
let children: Child[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  vi.mocked(processStart).mockReturnValue("ticks:fixture");
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation(() => {
      const child = new Child();
      children.push(child);
      return child as unknown as ReturnType<typeof spawn>;
    });
});
afterEach(() => {
  vi.useRealTimers();
});
function fixture() {
  const options = {
    worker: new URL("file:///fixture/model-preview.mjs"),
    assertCurrent: vi.fn(),
    launched: vi.fn(),
    closed: vi.fn(),
    unconfirmed: vi.fn(),
  };
  const pool = new ModelPreviewProcesses(options);
  const source: PreviewSource = {
    agentDir: "/fixture/agent",
    cwd: "/fixture/project",
    home: "/fixture",
    environment: {},
    secrets: ["fixture-secret"],
  };
  return { pool, source, options };
}
it("coalesces concurrent source reads and returns only after native close; nothing is cached afterward", async () => {
  const { pool, source, options } = fixture();
  const first = pool.read(source),
    second = pool.read(source);
  expect(first).toBe(second);
  expect(spawn).toHaveBeenCalledTimes(1);
  children[0].output();
  children[0].emit("exit", 0, null);
  let done = false;
  void first.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  children[0].close();
  expect(await first).toEqual(preview);
  expect(options.closed).toHaveBeenCalledExactlyOnceWith(children[0].pid);
  const next = pool.read(source);
  expect(spawn).toHaveBeenCalledTimes(2);
  children[1].output();
  children[1].close();
  await next;
});
it("secrets go only to the private input, never argv, and sources are not combined across accounts", async () => {
  const { pool, source } = fixture();
  const a = pool.read(source),
    b = pool.read({ ...source, agentDir: "/other/agent" });
  expect(spawn).toHaveBeenCalledTimes(2);
  const [, args, options] = vi.mocked(spawn).mock.calls[0];
  expect(args).toEqual(["/fixture/model-preview.mjs"]);
  expect(options).toMatchObject({
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "ignore", "ipc"],
  });
  expect(children[0].stdin.read().toString()).toContain("fixture-secret");
  children.forEach((child) => {
    child.output();
    child.close();
  });
  await Promise.all([a, b]);
});
it("capacity counts stopping originals until actual close", async () => {
  const { pool, source } = fixture();
  const reads = Array.from({ length: PREVIEW_PROCESSES }, (_, i) =>
    pool.read({ ...source, cwd: `/fixture/${i}` }),
  );
  pool.invalidate();
  await expect(pool.read(source)).rejects.toThrow("capacity");
  for (const child of children) child.close(1);
  for (const read of reads) await expect(read).rejects.toThrow("unavailable");
  const next = pool.read(source);
  children.at(-1)!.output();
  children.at(-1)!.close();
  await next;
});
it("Stop stops discovery immediately but joins its original native closure", async () => {
  const { pool, source } = fixture();
  const read = pool.read(source);
  const closing = pool.close();
  expect(children[0].kill).toHaveBeenCalledWith("SIGTERM");
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  await expect(pool.read(source)).rejects.toThrow("quarantine");
  children[0].close(1);
  await closing;
  await expect(read).rejects.toThrow("unavailable");
  expect(closed).toBe(true);
});
it("one total deadline escalates signals and retains quarantine on unconfirmed closure", async () => {
  const { pool, source, options } = fixture();
  const read = pool.read(source);
  await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS);
  expect(children[0].kill).toHaveBeenLastCalledWith("SIGTERM");
  await vi.advanceTimersByTimeAsync(LIMITS.terminateGraceMs);
  expect(children[0].kill).toHaveBeenLastCalledWith("SIGKILL");
  await vi.advanceTimersByTimeAsync(LIMITS.unconfirmedStopMs);
  await expect(read).rejects.toThrow("quarantine");
  expect(options.unconfirmed).toHaveBeenCalledOnce();
  expect(options.closed).not.toHaveBeenCalled();
  await expect(pool.close()).rejects.toThrow("quarantine");
  children[0].close(1);
  await expect(pool.read(source)).rejects.toThrow("quarantine");
});
it("a changed process identity or lost gateway lease is never signalled", async () => {
  for (const lost of ["pid", "lease"]) {
    const { pool, source, options } = fixture();
    const read = pool.read(source);
    const child = children.at(-1)!;
    if (lost === "pid")
      vi.mocked(processStart).mockReturnValueOnce("ticks:other");
    else
      options.assertCurrent.mockImplementation(() => {
        throw Error("lost");
      });
    pool.invalidate();
    expect(child.kill).not.toHaveBeenCalled();
    child.close(1);
    await expect(read).rejects.toThrow("unavailable");
  }
});
it.each(["oversize", "bad-json", "nonzero", "private-field"])(
  "refuses %s output, never publishing a clipped or unaudited catalog",
  async (mode) => {
    const { pool, source } = fixture();
    const read = pool.read(source);
    const child = children[0];
    if (mode === "oversize")
      child.stdout.write(Buffer.alloc(LIMITS.pageBytes + 1, 65));
    else if (mode === "bad-json") child.stdout.write("{broken");
    else
      child.output(
        mode === "private-field"
          ? { kind: "ok", value: { ...preview, apiKey: "fixture-secret" } }
          : undefined,
      );
    child.close(mode === "nonzero" ? 1 : 0);
    await expect(read).rejects.toThrow();
  },
);
it("a safe child refusal preserves its public code without logging raw SDK errors", async () => {
  const { pool, source } = fixture();
  const read = pool.read(source);
  children[0].output({
    kind: "error",
    error: publicError("corrupt-selected", "none"),
  });
  children[0].close();
  await expect(read).rejects.toThrow("corrupt-selected");
});
