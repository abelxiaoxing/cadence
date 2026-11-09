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

/** Pi shell definitions/backends with a bounded redacted accumulator instead
 * of the stock raw-spill accumulator. No command allowlist or lifetime quota. */
export function captureShell(
  cwd,
  secrets,
  fail,
  operations,
  queue,
  definition,
  commandPrefix,
) {
  return {
    ...definition,
    description: `Execute ${definition.name} in the fixed working directory, with an optional per-command timeout in seconds. Output is redacted and retained as a labelled bounded tail; no raw spill file.`,
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
          256 * 1024,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const sanitizer = new TextSanitizer(secrets);
      let output = "",
        sourceBytes = 0,
        failed = false,
        truncated = false;
      const append = (text) => {
        output += text;
        if (Buffer.byteLength(output) > 65536) {
          truncated = true;
          output = Buffer.from(output).subarray(-65536).toString("utf8");
          if (output.startsWith("\uFFFD")) output = output.slice(1);
        }
      };
      const refuse = () => {
        failed = true;
        local.abort();
        fail();
      };
      // Bounded previews and a labelled redacted tail; no raw spill or log quota. Windows pipes
      // deliver chatty output as thousands of small chunks, and each update is
      // a durable capture detail, so throttle like the stock bash renderer.
      let lastUpdate = Number.NEGATIVE_INFINITY;
      let pending;
      const publish = () => {
        pending = undefined;
        if (failed || queue.bytes > LIMITS.workerQueueBytes / 2) return;
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
        const started = performance.now();
        const result = await operations().exec(
          commandPrefix ? `${commandPrefix}\n${command}` : command,
          cwd,
          {
            signal: local.signal,
            timeout,
            onData(data) {
              if (failed) return;
              let raw;
              try {
                sourceBytes += data.length;
                // A pipe chunk is processed in bounded slices; cumulative log
                // volume does not have authority to stop the command.
                for (let at = 0; at < data.length; at += 8192) {
                  raw = queue.reserve(8192 * 12);
                  append(
                    sanitizer.write(
                      decoder.decode(data.subarray(at, at + 8192), {
                        stream: true,
                      }),
                    ),
                  );
                  raw.release();
                  raw = undefined;
                }
                const since = performance.now() - lastUpdate;
                if (since >= UPDATE_INTERVAL_MS) publish();
                else
                  pending ??= setTimeout(publish, UPDATE_INTERVAL_MS - since);
              } catch {
                refuse();
              } finally {
                raw?.release();
              }
            },
          },
        );
        try {
          append(sanitizer.write(decoder.decode()));
          append(sanitizer.end());
        } catch {
          fail();
          throw new ContractError();
        }
        if (truncated)
          output = `[Output truncated; retained redacted tail of ${sourceBytes} observed bytes.]\n${output}`;
        if (failed) throw new ContractError("capacity");
        if (result.exitCode === null) throw new ContractError("unavailable");
        return {
          content: [
            {
              type: "text",
              text:
                result.exitCode === 0
                  ? output || "(no output)"
                  : `${output}\nCommand exited with code ${result.exitCode}`,
            },
          ],
          ...(result.exitCode === 0 ? {} : { isError: true }),
          structuredContent: {
            output,
            truncated,
            exit_code: result.exitCode,
            wall_time_seconds:
              Math.round((performance.now() - started) / 100) / 10,
          },
          details: truncated
            ? { truncation: { observedBytes: sourceBytes } }
            : {},
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
