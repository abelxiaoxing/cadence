import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { executionProfile } from "../src/execution-profile.ts";
import {
  encodeWindowsJobRequest,
  WindowsJobBackend,
} from "../src/windows-job-backend.ts";

afterEach(() => vi.useRealTimers());
const input = {
  root: "C:\\candidate",
  executable: "C:\\node.exe",
  args: ["", "路径 with spaces", 'a"b', "end\\"],
  environment: { SystemRoot: "C:\\Windows" },
};
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  const spawnProcess = vi.fn(() => child);
  const backend = new WindowsJobBackend({
    helperPath: "C:\\helper.exe",
    platform: "win32",
    arch: "x64",
    probe: () => true,
    spawnProcess: spawnProcess as never,
  });
  const finish = (observation: object, code = 0) => {
    child.stdout.write(`${JSON.stringify(observation)}\n`);
    child.emit("close", code);
  };
  return { child, backend, finish, spawnProcess };
}
const settled = {
  version: 2,
  outcome: "complete",
  reason: "exit",
  rootExited: true,
  managedSettled: true,
  exitCode: 1,
};

it("requires an explicit host-trusted mode without altering Linux defaults", () => {
  expect(executionProfile({}).mode).toBe("isolated");
  expect(executionProfile({ ABEL_EXECUTION_MODE: "host-trusted" }).mode).toBe(
    "host-trusted",
  );
  expect(() => executionProfile({ ABEL_EXECUTION_MODE: "host" })).toThrow(
    "execution-mode-invalid",
  );
});
it("encodes native Unicode argv and environment, supports the existing verification deadline, rejects mounts and duplicate environment keys", () => {
  const wire = encodeWindowsJobRequest(input, 600_000);
  expect(wire.readUInt32LE(0)).toBe(2);
  expect(wire.readUInt32LE(4)).toBe(600_000);
  expect(wire.toString("utf16le")).toContain('"" "路径 with spaces"');
  expect(() =>
    encodeWindowsJobRequest(
      { ...input, mounts: [{ source: "C:\\a", target: "C:\\b" }] },
      1,
    ),
  ).toThrow();
  expect(() =>
    encodeWindowsJobRequest(
      { ...input, environment: { Path: "a", PATH: "b" } },
      1,
    ),
  ).toThrow();
  expect(() =>
    encodeWindowsJobRequest({ ...input, executable: "node.cmd" }, 1),
  ).toThrow();
});
it("returns the target exit code only after the helper closes with confirmed Job settlement", async () => {
  const f = fixture();
  const result = f.backend.run({ ...input, outputWitness: "目标-RED" });
  await new Promise(setImmediate);
  const witness = Buffer.from("目标-RED");
  for (const bytes of [witness.subarray(0, 2), witness.subarray(2)])
    f.child.stdout.write(
      `${JSON.stringify({ outputHex: bytes.toString("hex") })}\n`,
    );
  f.finish(settled);
  expect(await result).toMatchObject({
    ok: true,
    exitCode: 1,
    outputWitnessMatched: true,
  });
  expect(f.spawnProcess).toHaveBeenCalledWith(
    "C:\\helper.exe",
    [],
    expect.objectContaining({ shell: false }),
  );
});
it.each([
  { ...settled, managedSettled: false },
  { ...settled, exitCode: undefined },
  { ...settled, outcome: "uncertain", reason: "termination-unconfirmed" },
])(
  "does not admit malformed or unsettled observations as product Red",
  async (observation) => {
    const f = fixture();
    const result = f.backend.run(input);
    await new Promise(setImmediate);
    f.finish(observation);
    expect(await result).toMatchObject({
      ok: false,
      code: "isolation-termination-unconfirmed",
    });
  },
);
it("does not confuse helper exit with target settlement", async () => {
  const f = fixture();
  const result = f.backend.run(input);
  await new Promise(setImmediate);
  f.child.emit("close", 1);
  expect(await result).toMatchObject({
    ok: false,
    code: "isolation-termination-unconfirmed",
  });
});
it("waits for confirmed cancellation and keeps infrastructure failures out of Red", async () => {
  const f = fixture();
  const controller = new AbortController();
  const result = f.backend.run({ ...input, signal: controller.signal });
  await new Promise(setImmediate);
  controller.abort();
  f.finish({ ...settled, outcome: "failed", reason: "cancelled" });
  expect(await result).toEqual({
    ok: false,
    state: "cancelled",
    code: "cancelled",
  });
});

it("bounds cancellation even when the helper does not send a settlement receipt", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    controller = new AbortController();
  const result = f.backend.run({ ...input, signal: controller.signal });
  controller.abort();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toMatchObject({
    ok: false,
    code: "isolation-termination-unconfirmed",
  });
  expect(f.child.kill).toHaveBeenCalledOnce();
});
it("rejects invalid native requests before spawning rather than retaining imaginary processes", async () => {
  const f = fixture();
  expect(
    await f.backend.run({ ...input, executable: "script.cmd" }),
  ).toMatchObject({ ok: false, code: "isolation-backend-launch-failed" });
  expect(f.spawnProcess).not.toHaveBeenCalled();
});

it.each(["", "relative/helper.exe"])(
  "rejects invalid configured helper path %j before identity traversal",
  (helper) => {
    expect(() =>
      executionProfile({
        ABEL_EXECUTION_MODE: "host-trusted",
        ABEL_WINDOWS_JOB_HELPER: helper,
      }),
    ).toThrow("windows-job-helper-path-invalid");
  },
);
