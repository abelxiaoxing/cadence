// Injected Writable callback hold; real exported Cadence classes, no SDK mock.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { setImmediate as checkpoint } from "node:timers/promises";
import { CaptureEmitter, SdkCapture } from "../../src/worker-capture.mjs";
import { ToolIngress } from "../../src/worker-tools.mjs";
import { observeAccounting } from "./worker-accounting-observer.mjs";

const results = [];
for (const overlap of [false, true]) {
  const observation = observeAccounting();
  let hold = false,
    release;
  const resume = () => {
    hold = false;
    const callback = release;
    release = undefined;
    callback?.();
  };
  const frames = [];
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(chunk, _enc, callback) {
        frames.push(JSON.parse(chunk));
        if (hold) release = callback;
        else callback();
      },
    }),
    () => {},
  );
  const capture = new SdkCapture(emitter);
  const ingress = new ToolIngress(
    [],
    () => {
      throw new Error("fixture ingress");
    },
    emitter.queue,
  );
  const originals = [];
  const settlements = [];
  const updateValue = {
    content: [{ type: "text", text: "tiny 雪" }],
    details: {},
  };
  const [tool] = ingress.wrap([
    {
      execute(_id, _args, _signal, update) {
        update(updateValue);
      },
    },
  ]);
  const start = { toolCallId: "fixture", toolName: "bash" };
  try {
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    await capture.event({ type: "tool_execution_start", ...start, args: {} });
    for (let i = 0; i < 3; i++) {
      hold = true;
      tool.execute("fixture", {}, undefined, (partialResult) => {
        const event = {
          type: "tool_execution_update",
          ...start,
          partialResult,
        };
        const original = capture.event(event);
        originals.push(original);
        // Same original subscription settlement owns the ingress lease.
        settlements.push(
          original.then(
            () => {
              ingress.release(event);
              return "fulfilled";
            },
            () => {
              ingress.release(event);
              return "rejected";
            },
          ),
        );
      });
      if (!overlap) {
        assert.ok(ingress.frames > 0);
        resume();
        await settlements.at(-1);
      }
    }
    // Let rejected original settle, without advancing any pending write callback.
    await checkpoint();
    const held = {
      bytes: emitter.queue.bytes,
      ingress: ingress.frames,
      pendingBytes: emitter.queuedBytes,
    };
    if (overlap) {
      assert.ok(held.bytes > 0 && held.ingress > 0 && held.pendingBytes > 0);
      resume();
    }
    const outcomes = await Promise.all(settlements);
    await emitter.drain();
    assert.equal(originals.length, 3);
    assert.equal(ingress.frames, 0);
    assert.equal(emitter.queue.bytes, 0);
    assert.equal(emitter.queue.frames, 0);
    const expectedFailure = process.argv[2] === "before" && overlap;
    assert.equal(
      outcomes.filter((s) => s === "rejected").length,
      expectedFailure ? 1 : 0,
    );
    if (expectedFailure) {
      assert.equal(observation.facts.first.branch, "queue-reserve");
      assert.equal(observation.facts.first.requestedBytes, 1114112);
      await emitter.emit({ kind: "worker-failure", code: "capture" });
    } else {
      await capture.event({
        type: "tool_execution_end",
        ...start,
        result: updateValue,
        isError: false,
      });
      const updates = frames.filter((f) => f.event.kind === "tool-update");
      assert.equal(updates.length, 3);
      for (const { event } of updates) {
        const text = frames
          .filter(
            (f) =>
              f.event.kind === "detail-chunk" &&
              f.event.detailId === event.detailId,
          )
          .map((f) => f.event.text)
          .join("");
        assert.deepEqual(JSON.parse(text), updateValue);
        assert.equal(emitter.state.details.get(event.detailId).ended, true);
      }
      await capture.event({
        type: "message_start",
        message: { role: "assistant" },
      });
      await capture.event({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "done" }],
        },
      });
      await capture.final();
      assert.equal(emitter.state.preview, "done");
    }
    assert.equal(emitter.queue.bytes, 0);
    results.push({ overlap, outcomes, held, facts: observation.facts });
  } finally {
    resume();
    await Promise.allSettled(originals);
    await emitter.drain();
    observation.restore();
  }
}
process.stdout.write(
  `${JSON.stringify({ classification: "injected-writable-original-settlement", results })}\n`,
);
