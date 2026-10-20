// FIXTURE ONLY. Fixed primitive accounting, no payload/IDs/errors. Wrappers return
// the original promise and rethrow the original value; observation never paces work.
import {
  CaptureEmitter,
  CaptureQueue,
  SdkCapture,
} from "../../src/worker-capture.mjs";
import { ToolIngress } from "../../src/worker-tools.mjs";

export function observeAccounting() {
  const facts = {
    first: null,
    queue: { bytes: 0, dataBytes: 0, frames: 0, dataFrames: 0 },
    high: {
      bytes: 0,
      dataBytes: 0,
      frames: 0,
      dataFrames: 0,
      canonical: 0,
      updates: 0,
      pending: 0,
      pendingBytes: 0,
      ingress: 0,
      ingressBytes: 0,
    },
    canonical: 0,
    updates: 0,
    entered: 0,
    settled: 0,
    pending: 0,
    pendingBytes: 0,
    ingress: 0,
    ingressBytes: 0,
    events: Object.fromEntries(
      [
        "agent_start",
        "agent_end",
        "turn_start",
        "turn_end",
        "message_start",
        "message_update",
        "message_end",
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "unknown",
      ].map((k) => [k, 0]),
    ),
  };
  const clean = (fn) => {
    try {
      fn();
    } catch {
      /* observation cannot change work */
    }
  };
  const bounded = (n) => Math.min(2 ** 30, Math.max(0, n));
  const sample = (queue) =>
    clean(() => {
      for (const key of ["bytes", "dataBytes", "frames", "dataFrames"]) {
        facts.queue[key] = bounded(queue[key]);
        facts.high[key] = Math.max(facts.high[key], facts.queue[key]);
      }
      for (const key of [
        "canonical",
        "updates",
        "pending",
        "pendingBytes",
        "ingress",
        "ingressBytes",
      ])
        facts.high[key] = Math.max(facts.high[key], bounded(facts[key]));
    });
  const failure = (branch, queue, bytes = null, lane = null) =>
    clean(() => {
      sample(queue);
      facts.first ??= {
        branch,
        requestedBytes: bytes,
        lane,
        ...facts.queue,
        canonical: facts.canonical,
        updates: facts.updates,
        pending: facts.pending,
        pendingBytes: facts.pendingBytes,
        ingress: facts.ingress,
        ingressBytes: facts.ingressBytes,
      };
    });
  const restores = [];
  const wrap = (prototype, name, build) => {
    const original = prototype[name];
    prototype[name] = build(original);
    restores.push(() => {
      prototype[name] = original;
    });
  };
  const observe = (original, done) => {
    original
      .then(
        () => clean(() => done(false)),
        () => clean(() => done(true)),
      )
      .catch(() => {});
    return original;
  };
  wrap(
    CaptureQueue.prototype,
    "reserve",
    (original) =>
      function (bytes, lane = "data") {
        let lease;
        try {
          lease = original.call(this, bytes, lane);
        } catch (error) {
          failure("queue-reserve", this, bytes, lane);
          throw error;
        }
        sample(this);
        for (const method of ["grow", "shrink", "release"]) {
          const operation = lease[method];
          lease[method] = (...args) => {
            try {
              const result = operation(...args);
              sample(this);
              return result;
            } catch (error) {
              failure(`queue-${method}`, this, args[0] ?? null, lane);
              throw error;
            }
          };
        }
        return lease;
      },
  );
  wrap(
    CaptureEmitter.prototype,
    "emit",
    (original) =>
      function (event) {
        let result;
        try {
          result = original.call(this, event);
        } catch (error) {
          failure("emitter", this.queue);
          throw error;
        }
        const update = () => {
          facts.pending = this.pending.size;
          facts.pendingBytes = this.queuedBytes;
          sample(this.queue);
        };
        clean(update);
        return observe(result, (failed) => {
          update();
          if (failed) failure("write-wait", this.queue);
        });
      },
  );
  wrap(
    SdkCapture.prototype,
    "detail",
    (original) =>
      function (descriptor, ...args) {
        let canonical = false;
        clean(() => {
          canonical =
            Object.getOwnPropertyDescriptor(descriptor, "encoding")?.value ===
            "canonical-json";
        });
        if (canonical) facts.canonical = bounded(facts.canonical + 1);
        sample(this.emitter.queue);
        return observe(original.call(this, descriptor, ...args), (failed) => {
          if (failed) failure("canonical-detail", this.emitter.queue);
          if (canonical) facts.canonical--;
          sample(this.emitter.queue);
        });
      },
  );
  wrap(
    SdkCapture.prototype,
    "event",
    (original) =>
      function (event) {
        let type;
        clean(() => {
          type = Object.getOwnPropertyDescriptor(event, "type")?.value;
        });
        const key =
          typeof type === "string" && Object.hasOwn(facts.events, type)
            ? type
            : "unknown";
        facts.events[key] = bounded(facts.events[key] + 1);
        const update = type === "tool_execution_update";
        if (update) {
          facts.entered = bounded(facts.entered + 1);
          facts.updates = bounded(facts.updates + 1);
        }
        sample(this.emitter.queue);
        return observe(original.call(this, event), (failed) => {
          if (failed) failure("sdk-event", this.emitter.queue);
          if (update) {
            facts.settled = bounded(facts.settled + 1);
            facts.updates--;
          }
          sample(this.emitter.queue);
        });
      },
  );
  const ingressSample = (ingress) =>
    clean(() => {
      facts.ingress = ingress.frames;
      facts.ingressBytes = ingress.bytes;
      sample(ingress.queue);
    });
  wrap(
    ToolIngress.prototype,
    "wrap",
    (original) =>
      function (tools) {
        // Observe before the SDK update callback; no replacement values or copies.
        const wrapped = original.call(this, tools);
        return wrapped.map((tool) => ({
          ...tool,
          execute: (id, args, signal, update, ...rest) =>
            tool.execute(
              id,
              args,
              signal,
              update &&
                ((value) => {
                  ingressSample(this);
                  return update(value);
                }),
              ...rest,
            ),
        }));
      },
  );
  wrap(
    ToolIngress.prototype,
    "release",
    (original) =>
      function (event) {
        try {
          return original.call(this, event);
        } catch (error) {
          failure("ingress-release", this.queue);
          throw error;
        } finally {
          ingressSample(this);
        }
      },
  );
  return {
    facts,
    restore() {
      for (const restore of restores.reverse()) restore();
    },
  };
}
