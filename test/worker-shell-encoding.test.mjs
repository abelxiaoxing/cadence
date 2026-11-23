import assert from "node:assert/strict";
import { it } from "vitest";
import { CaptureQueue } from "../src/worker-capture.mjs";
import { captureShell } from "../src/worker-tools.mjs";

function fixture(chunks, exitCode = 0, secrets = []) {
  const queue = new CaptureQueue();
  const updates = [];
  let failures = 0,
    runs = 0,
    aborted = false;
  const tool = captureShell(
    "fixture",
    secrets,
    () => failures++,
    () => ({
      async exec(_command, _cwd, options) {
        runs++;
        for (const chunk of chunks) options.onData(chunk);
        aborted = options.signal.aborted;
        return { exitCode };
      },
    }),
    queue,
    { name: "bash" },
  );
  return {
    run: () =>
      tool.execute("id", { command: "fixture" }, undefined, (v) =>
        updates.push(v),
      ),
    state: () => ({ failures, runs, aborted, bytes: queue.bytes }),
    updates,
  };
}

it("GBK shell bytes preserve the actual nonzero result without capture failure or replay", async () => {
  const f = fixture(
    [Buffer.from("FAIL: "), Buffer.from([0xd6, 0xd0, 0xce, 0xc4])],
    7,
  );
  const result = await f.run();
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.exit_code, 7);
  assert.match(result.structuredContent.output, /^FAIL: .*\uFFFD/u);
  assert.match(result.content[0].text, /Command exited with code 7$/u);
  assert.deepEqual(f.state(), {
    failures: 0,
    runs: 1,
    aborted: false,
    bytes: 0,
  });
});

it("an incomplete UTF-8 tail is flushed as replacement text without canceling a successful command", async () => {
  const f = fixture([Buffer.from("done "), Buffer.from([0xe4, 0xb8])]);
  const result = await f.run();
  assert.equal(result.structuredContent.output, "done \uFFFD");
  assert.equal(result.structuredContent.exit_code, 0);
  assert.equal(result.isError, undefined);
  assert.deepEqual(f.state(), {
    failures: 0,
    runs: 1,
    aborted: false,
    bytes: 0,
  });
});

it("split UTF-8 stays intact and split secrets remain redacted beside invalid bytes", async () => {
  const secret = "fixture-secret";
  const chunks = [
    Buffer.from("中文🔧 "),
    Buffer.from([0xff]),
    Buffer.from(` ${secret} end`),
  ];
  const f = fixture(
    chunks.flatMap((chunk) => [...chunk].map((byte) => Buffer.from([byte]))),
    0,
    [secret],
  );
  const result = await f.run();
  assert.match(result.structuredContent.output, /^中文🔧 \uFFFD /u);
  assert.ok(!JSON.stringify([result, ...f.updates]).includes(secret));
  assert.deepEqual(f.state(), {
    failures: 0,
    runs: 1,
    aborted: false,
    bytes: 0,
  });
});

it("encoding tolerance does not bypass queue capacity or original operation settlement", async () => {
  const queue = new CaptureQueue();
  let release;
  const closed = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let failures = 0,
    aborted = false,
    settled = false;
  const tool = captureShell(
    "fixture",
    [],
    () => failures++,
    () => ({
      async exec(_command, _cwd, options) {
        const { lease: held } = queue.reserveSource();
        options.onData(Buffer.from([0xff]));
        aborted = options.signal.aborted;
        entered();
        await closed;
        held.release();
        return { exitCode: 1 };
      },
    }),
    queue,
    { name: "bash" },
  );
  const result = tool.execute("id", { command: "fixture" }).finally(() => {
    settled = true;
  });
  await started;
  assert.equal(aborted, true);
  assert.equal(settled, false);
  release();
  await assert.rejects(result, /capacity/u);
  assert.equal(failures, 1);
  assert.equal(queue.bytes, 0);
});
