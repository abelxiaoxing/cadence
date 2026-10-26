/** Instrumentation controls, not a scheduler repair/performance qualification. */
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SchedulerIoDiagnostics } from "./helpers/scheduler-io-diagnostics.ts";

it("sync instrumentation preserves this/arguments/result/throw without retaining payloads", () => {
  const d = new SchedulerIoDiagnostics(true);
  const secret = { forbidden: "never-record-this-payload" };
  const receiver = {};
  const thrown = { opaque: "never-record-this-error" };
  let got: unknown[] = [];
  const actual = {
    ...fs,
    readFileSync: function (this: unknown, ...args: unknown[]) {
      got = [this, ...args];
      if (args[0] === thrown) throw thrown;
      return secret;
    },
  } as unknown as typeof fs;
  const measured = d.fs(actual);
  d.runCase(() => {
    expect(Reflect.apply(measured.readFileSync, receiver, [secret, 42])).toBe(
      secret,
    );
    expect(got).toEqual([receiver, secret, 42]);
    let observed: unknown;
    try {
      Reflect.apply(measured.readFileSync, receiver, [thrown]);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(thrown);
  });
  const receipt = JSON.stringify(d.finish());
  expect(receipt).toContain('"errors":1');
  expect(receipt).not.toContain("never-record");
});

it("async observation returns exact original promises and late work retains its originating case", async () => {
  const d = new SchedulerIoDiagnostics(true);
  let release!: (value: object) => void;
  const original = new Promise<object>((resolve) => {
    release = resolve;
  });
  let next!: () => Promise<object>;
  d.runCase(() => {
    next = () => d.timed("async:sync", () => original);
    expect(next()).toBe(original);
  });
  d.teardownEnded();
  d.runCase(() => 1);
  release({ privatePayload: "never-record-this-payload" });
  await original;
  const receipt = d.finish() as {
    cases: {
      ordinal: number;
      pending: number;
      late: Record<string, { count: number }>;
    }[];
  };
  expect(receipt.cases[0].late["async:sync"].count).toBe(1);
  expect(receipt.cases[0].pending).toBe(0);
  expect(receipt.cases[1].late).toEqual({});
  expect(JSON.stringify(receipt)).not.toContain("never-record");
});

it("native file/directory calls and original FileHandle returns are observed without extra IO", async () => {
  const directorySync = process.platform !== "win32";
  const d = new SchedulerIoDiagnostics(true),
    measured = d.fs(fs);
  const path = join(
    fs.mkdtempSync(join(tmpdir(), "cadence-io-control-")),
    "data",
  );
  await d.runCase(async () => {
    const fd = measured.openSync(path, "wx", 0o600);
    const buffer = Buffer.from("fixture");
    measured.writeSync(fd, buffer);
    measured.fsyncSync(fd);
    measured.closeSync(fd);
    // Windows rejects directory fsync (EPERM); product code skips it there too.
    if (directorySync) {
      const dir = measured.openSync(
        join(path, ".."),
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      );
      measured.fsyncSync(dir);
      measured.closeSync(dir);
    }
    expect(measured.readFileSync(path)).toEqual(buffer);
    const m = d.promises(promises);
    const handle = await m.open(path, "r+");
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
  });
  const receipt = d.finish() as {
    cases: { totals: Record<string, { count: number }> }[];
  };
  const totals = receipt.cases[0].totals;
  expect(totals["fsyncSync:file"].count).toBe(1);
  expect(totals["fsyncSync:directory"]?.count ?? 0).toBe(directorySync ? 1 : 0);
  expect(totals["async:sync"].count).toBe(1);
  expect(totals["async:close"].count).toBe(1);
  expect(totals.readFileSync.count).toBe(1);
});

it("async open/handle instrumentation preserves arguments, handle and each original promise", async () => {
  const d = new SchedulerIoDiagnostics(true);
  let seen: unknown[] = [];
  const result = Promise.resolve();
  const handle = {
    writeFile: function (this: unknown, ...args: unknown[]) {
      seen = [this, ...args];
      return result;
    },
    write: () => result,
    read: () => result,
    readFile: () => result,
    stat: () => result,
    sync: () => result,
    close: () => result,
  };
  const original = Promise.resolve(handle);
  const source = {
    ...promises,
    open: (...args: unknown[]) => {
      seen = args;
      return original;
    },
  } as unknown as typeof promises;
  const measured = d.promises(source);
  await d.runCase(async () => {
    expect(measured.open("opaque-fixture", "r", 0o600)).toBe(original);
    expect(seen).toEqual(["opaque-fixture", "r", 0o600]);
    expect(await original).toBe(handle);
    const payload = {};
    expect(handle.writeFile(payload)).toBe(result);
    expect(seen).toEqual([handle, payload]);
    expect(handle.sync()).toBe(result);
    expect(handle.close()).toBe(result);
    await result;
  });
  expect(JSON.stringify(d.finish())).not.toContain("opaque-fixture");
});

it("registration keeps all budgets/options and exact callback promise; disabled mode is identity", async () => {
  const d = new SchedulerIoDiagnostics(true);
  let registration: unknown[] = [];
  const register = Object.assign(
    (...args: unknown[]) => {
      registration = args;
      return "registered";
    },
    { each: (..._rows: unknown[]) => register },
  );
  const measured = d.tests(register);
  const original = Promise.resolve("opaque-result");
  const options = { timeout: 20000 };
  expect(measured.each(["a"])("fixed name", () => original, options)).toBe(
    "registered",
  );
  expect(registration[0]).toBe("fixed name");
  expect(registration[2]).toBe(options);
  expect((registration[1] as () => Promise<string>)()).toBe(original);
  await original;
  const disabled = new SchedulerIoDiagnostics(false);
  expect(disabled.tests(register)).toBe(register);
  expect(disabled.fs(fs)).toBe(fs);
  expect(disabled.promises(promises)).toBe(promises);
  expect(JSON.stringify(d.finish())).not.toContain("opaque-result");
});
