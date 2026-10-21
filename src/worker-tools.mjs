import { Type } from "typebox";
import { ContractError, LIMITS } from "./worker-public.mjs";
import {
  measureData,
  own,
  ownArray,
  sanitizeData,
  TextSanitizer,
} from "./worker-redaction.mjs";

/** Matches the stock bash renderer's update throttle. */
const UPDATE_INTERVAL_MS = 100;

/** No stock bash definition/OutputAccumulator: raw output is never spilled. */
export function captureBash(
  cwd,
  secrets,
  fail,
  createLocalBashOperations,
  queue,
) {
  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a shell command in the working directory. Output is bounded and redacted; no raw spill file.",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(_id, args, signal, onUpdate) {
      const command = own(args, "command"),
        timeout = own(args, "timeout");
      if (
        typeof command !== "string" ||
        (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0))
      )
        throw new ContractError();
      const local = new AbortController();
      const abort = () => local.abort();
      const prefix = queue.reserve(
        secrets.reduce((n, value) => n + Buffer.byteLength(value), 0) * 4 +
          65536,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const sanitizer = new TextSanitizer(secrets);
      let output = "",
        sourceBytes = 0,
        failed = false;
      const append = (text) => {
        if (
          Buffer.byteLength(output) + Buffer.byteLength(text) >
          LIMITS.detailBytes
        )
          throw new ContractError("oversize");
        // The redacted accumulator is Cadence-owned retention too, not an
        // uncharged escape from the shared queue. No raw spill on exhaustion.
        prefix.grow(Buffer.byteLength(text));
        output += text;
      };
      const refuse = () => {
        failed = true;
        local.abort();
        fail();
      };
      // Previews only: the final result carries every byte. Windows pipes
      // deliver chatty output as thousands of small chunks, and each update is
      // a durable capture detail, so throttle like the stock bash renderer.
      let lastUpdate = Number.NEGATIVE_INFINITY;
      let pending;
      const publish = () => {
        pending = undefined;
        if (failed) return;
        lastUpdate = performance.now();
        try {
          let tail = output.slice(-4096);
          if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
          onUpdate?.({
            content: [{ type: "text", text: tail }],
            details:
              output.length > tail.length
                ? {
                    truncation: {
                      observedBytes: Buffer.byteLength(output),
                      updatePreview: true,
                    },
                  }
                : {},
          });
        } catch {
          refuse();
        }
      };
      try {
        const result = await createLocalBashOperations().exec(command, cwd, {
          signal: local.signal,
          timeout,
          onData(data) {
            if (failed) return;
            let raw;
            try {
              raw = queue.reserve(data.length * 12);
              // Charge original bytes synchronously BEFORE decoding/copying.
              sourceBytes += data.length;
              if (
                data.length > LIMITS.workerQueueBytes ||
                sourceBytes > LIMITS.detailBytes
              )
                throw new ContractError("oversize");
              append(sanitizer.write(decoder.decode(data, { stream: true })));
              const since = performance.now() - lastUpdate;
              if (since >= UPDATE_INTERVAL_MS) publish();
              else pending ??= setTimeout(publish, UPDATE_INTERVAL_MS - since);
            } catch {
              refuse();
            } finally {
              raw?.release();
            }
          },
        });
        try {
          append(sanitizer.write(decoder.decode()));
          append(sanitizer.end());
        } catch {
          fail();
          throw new ContractError();
        }
        if (failed) throw new ContractError("capacity");
        if (result.exitCode === null) throw new ContractError("unavailable");
        // Match the public stock tool's nonzero result/error semantics. The SDK
        // turns a throw into isError; this is never a parent check receipt.
        if (result.exitCode !== 0)
          throw new Error(
            `${output}\nCommand exited with code ${result.exitCode}`,
          );
        return {
          content: [{ type: "text", text: output || "(no output)" }],
          details: {},
        };
      } finally {
        // No preview may follow the result.
        clearTimeout(pending);
        prefix.release();
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
/** Reserve synchronous tool update ingress before the SDK's async emit queue.
 * The installed SDK forwards the exact partialResult object to awaited listeners.
 * The reservation is released only by that original listener's settlement. */
export class ToolIngress {
  constructor(secrets, fail, queue) {
    this.queue = queue;
    this.secrets = secrets;
    this.fail = fail;
    this.bytes = 0;
    this.frames = 0;
    this.leases = new WeakMap();
  }
  wrap(tools) {
    return ownArray(tools).map((tool) => ({
      ...tool,
      execute: (id, args, signal, update, ...rest) =>
        tool.execute(
          id,
          args,
          signal,
          (value) => {
            if (!update) return;
            let charged = 0;
            let lease;
            let handed = false;
            try {
              const reserved = this.queue.reserveSource();
              lease = reserved.lease;
              // Only public content and ordinary details; no opaque provider object.
              const selected = { content: own(value, "content") };
              const details = own(value, "details");
              if (details !== undefined) selected.details = details;
              const bytes = measureData(selected, reserved.bytes);
              if (
                this.bytes + bytes >
                  LIMITS.workerQueueBytes - LIMITS.ownerControlBytes ||
                this.frames + 1 >
                  LIMITS.workerQueueFrames - LIMITS.controlFrames
              )
                throw new ContractError("capacity");
              lease.shrink(bytes);
              this.bytes += bytes;
              this.frames++;
              charged = bytes;
              const copy = JSON.parse(sanitizeData(selected, this.secrets));
              this.leases.set(copy, { bytes, lease });
              handed = true;
              // The current SDK returns void, but a returned promise must still
              // be rejection-handled. Neither throw nor rejection proves an
              // already enqueued callback released its copy; only release(event)
              // discharges that original subscription's charge.
              Promise.resolve(update(copy)).catch(() => this.fail());
            } catch {
              if (!handed) lease?.release();
              if (charged && !handed) {
                this.bytes -= charged;
                this.frames--;
              }
              this.fail();
            }
          },
          ...rest,
        ),
    }));
  }
  release(event) {
    if (own(event, "type") !== "tool_execution_update") return;
    const result = own(event, "partialResult");
    const retained = this.leases.get(result);
    if (retained !== undefined) {
      retained.lease.release();
      this.bytes -= retained.bytes;
      this.frames--;
      this.leases.delete(result);
    }
  }
}
