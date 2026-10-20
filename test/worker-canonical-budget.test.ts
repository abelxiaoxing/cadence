import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { setImmediate as checkpoint } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import {
  CaptureEmitter,
  CaptureQueue,
  SdkCapture,
} from "../src/worker-capture.mjs";
import { LIMITS } from "../src/worker-public.mjs";
import {
  DetailSanitizer,
  sanitizedJsonChunks,
  TextSanitizer,
} from "../src/worker-redaction.mjs";

it("three bounded overlapping canonical updates and serial comparison retain original leases", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./helpers/worker-canonical-overlap.mjs", import.meta.url),
      ),
      "after",
    ],
    {
      env: process.env,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 16384,
    },
  );
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
  const { results } = JSON.parse(result.stdout);
  expect(results.map((r: { outcomes: string[] }) => r.outcomes)).toEqual([
    ["fulfilled", "fulfilled", "fulfilled"],
    ["fulfilled", "fulfilled", "fulfilled"],
  ]);
  expect(results[1].held.bytes).toBeLessThan(256 * 1024);
  expect(results[1].facts.high.canonical).toBe(3);
  expect(results[1].facts.high.updates).toBe(3);
  expect(results[1].facts.queue.bytes).toBe(0);
}, 20000);

function projection(value: unknown, secrets: string[] = []) {
  const queue = new CaptureQueue();
  const prefix = queue.reserve(
    65536 + secrets.reduce((n, s) => n + Buffer.byteLength(s), 0) * 4,
  );
  const iterator = sanitizedJsonChunks(value, secrets, (bytes) =>
    queue.reserve(bytes),
  );
  return { queue, prefix, iterator };
}

it("canonical lexical leases grow with actual nested keys and release on iterator close", () => {
  const key = "雪".repeat(2000);
  const { queue, prefix, iterator } = projection({ [key]: { nested: "body" } });
  expect(iterator.next().value).toBe("{");
  const table = queue.bytes;
  expect(table).toBeGreaterThan(65536 + 6000);
  expect(table).toBeLessThan(100000);
  expect(iterator.next().value).toBe(`${JSON.stringify(key)}:`);
  expect(queue.bytes).toBeGreaterThan(table + 6000 * 20);
  expect(queue.bytes).toBeLessThan(300000);
  iterator.return(undefined);
  expect(queue.bytes).toBe(prefix.bytes);
  prefix.release();
  expect(queue.bytes).toBe(0);
});

it("canonical growth refusal preserves existing leases and leaves control headroom", () => {
  const key = "x".repeat(8192);
  const { queue, prefix, iterator } = projection({ [key]: "body" });
  iterator.next();
  // Inject a genuinely occupied data lane after the key table, before copying
  // the sanitized/escaped key. No timeout/refund or large-source replacement.
  const occupied = queue.reserve(
    LIMITS.workerQueueBytes - LIMITS.ownerControlBytes - queue.bytes - 1,
  );
  expect(() => iterator.next()).toThrow();
  expect(queue.bytes).toBe(prefix.bytes + occupied.bytes);
  const failure = queue.reserve(LIMITS.frameBytes * 3, "control");
  failure.release();
  occupied.release();
  prefix.release();
  expect(queue.bytes).toBe(0);
});

for (const value of [
  { ["x".repeat(8193)]: "value" },
  { "\ud800": "value" },
  { "a-secret": 1, "b-secret": 2 },
  { a: 1, aa: 2 },
])
  it("huge, malformed and ambiguous canonical keys remain refusals", () => {
    const { queue, prefix, iterator } = projection(value, [
      "a",
      "aa",
      "a-secret",
      "b-secret",
    ]);
    expect(() => [...iterator]).toThrow();
    expect(queue.bytes).toBe(prefix.bytes);
    prefix.release();
    expect(queue.bytes).toBe(0);
  });

it("UTF8 and split known-secret canonical fields survive independent owner serialization", () => {
  const secret = "split-秘密-canary";
  const value = {
    ["large".repeat(800)]: "a".repeat(1019) + secret + '雪😀\\"\n'.repeat(2000),
    nested: { ordinary: "tail", password: { hidden: "never-public" } },
  };
  const { queue, prefix, iterator } = projection(value, [secret]);
  const output = [...iterator].join("");
  expect(output).not.toContain(secret);
  expect(output).not.toContain("never-public");
  expect(JSON.parse(output)).toEqual({
    ["large".repeat(800)]:
      `${"a".repeat(1019)}[redacted]${'雪😀\\"\n'.repeat(2000)}`,
    nested: { ordinary: "tail", password: "[redacted]" },
  });
  expect(queue.bytes).toBe(prefix.bytes);
  prefix.release();
  for (const size of [1, 7, 1024, 8192]) {
    const owner = new DetailSanitizer("canonical-json", [secret]);
    let stored = "";
    for (let at = 0; at < output.length; at += size)
      stored += owner.write(output.slice(at, at + size));
    stored += owner.end();
    // Owner serialization may escape a split surrogate pair; independent stored
    // hashes are intentional. Decoded field values must remain exactly equal.
    expect(JSON.parse(stored)).toEqual(JSON.parse(output));
  }
});

it("one-byte literal expansion is charged before source copying and held across yield", () => {
  const { queue, prefix, iterator } = projection("x".repeat(1024), ["x"]);
  expect(iterator.next().value).toBe('"');
  const next = iterator.next();
  expect(next.value).toBe("[redacted]".repeat(1024).slice(0, -64)); // heuristic tail retained
  expect(queue.bytes).toBeGreaterThan(prefix.bytes + 10240);
  iterator.return(undefined);
  expect(queue.bytes).toBe(prefix.bytes);
  prefix.release();
});

for (const close of ["return", "throw"] as const)
  it(`nested canonical generators retain ancestor and slice leases until ${close}`, () => {
    const key = `nested-${"雪".repeat(512)}`;
    const { queue, prefix, iterator } = projection({
      [key]: { [key]: { [key]: "p".repeat(4096) } },
    });
    for (let i = 0; i < 7; i++) expect(iterator.next().done).toBe(false);
    // Three tables, three comparison keys, one source slice and the prefix.
    expect(iterator.next().value).toBe("p".repeat(960));
    expect(queue.frames).toBe(8);
    expect(queue.bytes).toBeGreaterThan(prefix.bytes + 3 * 1500 * 24 + 36000);
    let opaqueReads = 0;
    const opaque = Object.defineProperty({}, "message", {
      get() {
        opaqueReads++;
        throw new Error("must not inspect");
      },
    });
    if (close === "return") iterator.return(undefined);
    else {
      let caught: unknown;
      try {
        iterator.throw(opaque);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(opaque);
    }
    expect(opaqueReads).toBe(0);
    expect(queue.bytes).toBe(prefix.bytes);
    expect(queue.frames).toBe(1);
    prefix.release();
  });

it("key-table growth precedes push and refusal prevents sort", () => {
  const first = "table-a",
    second = "table-b";
  const { queue, prefix, iterator } = projection({ [first]: 1, [second]: 2 });
  const occupied = queue.reserve(
    LIMITS.workerQueueBytes - LIMITS.ownerControlBytes - queue.bytes - 94,
  );
  const baseline = queue.bytes;
  const push = Array.prototype.push,
    sort = Array.prototype.sort;
  let pushed = 0,
    sorted = 0,
    bytesAtPush = 0;
  // A spy records calls with Array.push itself: use transparent synchronous
  // wrappers here, with no assertions/awaits until the originals are restored.
  Array.prototype.push = function (...items) {
    if (items[0] === first || items[0] === second) {
      pushed++;
      bytesAtPush = queue.bytes;
    }
    return Reflect.apply(push, this, items);
  };
  Array.prototype.sort = function (...args) {
    if (this[0] === first) sorted++;
    return Reflect.apply(sort, this, args);
  };
  let failed = false;
  try {
    iterator.next();
  } catch {
    failed = true;
  } finally {
    Array.prototype.sort = sort;
    Array.prototype.push = push;
  }
  expect(failed).toBe(true);
  expect(pushed).toBe(1);
  expect(bytesAtPush).toBe(baseline + 94);
  expect(sorted).toBe(0);
  expect(queue.bytes).toBe(baseline);
  occupied.release();
  prefix.release();
  expect(queue.bytes).toBe(0);
});

it("slice capacity refusal precedes sanitizer copying and retains unrelated input ownership", () => {
  const { queue, prefix, iterator } = projection("x".repeat(4096));
  expect(iterator.next().value).toBe('"');
  const input = queue.reserve(
    LIMITS.workerQueueBytes - LIMITS.ownerControlBytes - queue.bytes - 1,
  );
  const write = vi.spyOn(TextSanitizer.prototype, "write");
  try {
    expect(() => iterator.next()).toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(queue.bytes).toBe(prefix.bytes + input.bytes);
  } finally {
    write.mockRestore();
    input.release();
    prefix.release();
  }
  expect(queue.bytes).toBe(0);
});

it("canonical preflight refuses deep and accessor sources without invoking getters", () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      reads++;
      return "not public";
    },
  });
  let deep: unknown = "leaf";
  for (let n = 0; n < 65; n++) deep = { nested: deep };
  for (const value of [deep, accessor]) {
    const { queue, prefix, iterator } = projection(value);
    expect(() => iterator.next()).toThrow();
    expect(queue.bytes).toBe(prefix.bytes);
    prefix.release();
    expect(queue.bytes).toBe(0);
  }
  expect(reads).toBe(0);
});

for (const mode of ["callback-error", "write-throw", "pending-late"] as const)
  it(`canonical iterator cleanup does not refund an original stdout write: ${mode}`, async () => {
    let armed = false,
      failures = 0;
    let release: ((error?: Error | null) => void) | undefined;
    const finishWrite = (error?: Error) => {
      const callback = release;
      release = undefined;
      callback?.(error);
    };
    const output = new Writable({
      write(chunk, _enc, callback) {
        if (!armed || JSON.parse(String(chunk)).event.kind !== "detail-chunk")
          return callback();
        armed = false;
        if (mode === "write-throw") throw new Error("injected write failure");
        release = callback;
      },
    });
    output.on("error", () => {}); // labelled injected write fault, not global suppression
    const emitter = new CaptureEmitter(randomUUID(), output, () => {
      failures++;
    });
    const capture = new SdkCapture(emitter);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    await capture.event({
      type: "tool_execution_start",
      toolCallId: "fixture",
      toolName: "bash",
      args: {},
    });
    armed = true;
    const original = capture.event({
      type: "tool_execution_update",
      toolCallId: "fixture",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "small 雪" }] },
    });
    const observed = original.then(
      () => "fulfilled",
      () => "rejected",
    );
    try {
      await checkpoint();
      if (mode !== "write-throw") {
        expect(release).toBeTypeOf("function");
        expect(emitter.queue.bytes).toBeGreaterThan(emitter.queuedBytes);
      }
      if (mode === "callback-error")
        finishWrite(new Error("injected callback failure"));
      expect(await observed).toBe("rejected");
      expect(failures).toBeGreaterThan(0);
      if (mode === "pending-late") {
        // Real unchanged 5s reporting bound. Lexical copies are no longer used,
        // but the original encoded write remains charged until its callback.
        expect(emitter.queuedBytes).toBeGreaterThan(0);
        expect(emitter.queue.bytes).toBe(emitter.queuedBytes);
        finishWrite();
      }
      await emitter.drain();
      expect(emitter.queue.bytes).toBe(0);
      expect(emitter.state.selected).toBeNull();
    } finally {
      finishWrite();
      await observed;
      await emitter.drain();
    }
  }, 20000);
