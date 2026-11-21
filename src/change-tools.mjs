/** Fixed-revision, readonly Git evidence. Suspended pipes retain real stream
 * positions under backpressure, never replay prefixes or spill source copies. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { gitArguments, gitEnvironment } from "./git-environment.mjs";

// Only fixed-revision evidence retains a cursor protocol. Inactive fields have
// a legal wire value even if a provider requires every declared property.
const optional = (schema) =>
  Type.Optional({
    ...schema,
    type: [schema.type, "null"],
    ...(schema.enum ? { enum: [...schema.enum, null] } : {}),
  });

const parameters = Type.Object(
  {
    mode: optional(
      Type.String({ enum: ["paths", "diff", "base", "candidate"] }),
    ),
    scope: optional(Type.String({ enum: ["full", "delta"] })),
    path: optional(Type.String({ maxLength: 1024 })),
    cursor: optional(Type.String({ maxLength: 128 })),
    close: optional(Type.Boolean({ enum: [true] })),
  },
  { additionalProperties: false },
);

export const CHANGE_LIMITS = Object.freeze({
  scans: 4,
  /** Target raw text bytes per page before serialized-response bounding. */
  pageBytes: 8192,
  /** Hard UTF-8 byte ceiling on the serialized JSON tool response envelope. */
  responseBytes: 12288,
  idleMs: 120000,
  operationMs: 30000,
});

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

/** Length of the longest complete UTF-8 prefix within `buf.subarray(0, limit)`.
 * Trailing incomplete multi-byte sequences stay buffered for the next page
 * instead of corrupting decoding or losing bytes across response-size shrinking. */
function completeUtf8Prefix(buf, limit, final) {
  const n = Math.min(buf.length, limit);
  if (final || n === 0) return n;
  // Walk back at most 3 bytes to see if the tail is a truncated UTF-8 sequence.
  let i = n - 1;
  while (i >= Math.max(0, n - 4) && (buf[i] & 0xc0) === 0x80) i--;
  const lead = buf[i];
  const expected =
    (lead & 0x80) === 0
      ? 1
      : (lead & 0xe0) === 0xc0
        ? 2
        : (lead & 0xf0) === 0xe0
          ? 3
          : (lead & 0xf8) === 0xf0
            ? 4
            : 1;
  return i + expected <= n ? n : i;
}

export function createChangeTools(binding) {
  binding = Object.freeze({ ...binding });
  if (
    typeof binding.root !== "string" ||
    ![binding.base, binding.candidate].every(
      (oid) => typeof oid === "string" && OID.test(oid),
    ) ||
    (binding.deltaBase !== undefined &&
      (typeof binding.deltaBase !== "string" || !OID.test(binding.deltaBase)))
  )
    throw new Error("Invalid fixed Git evidence binding");
  const scans = new Set(),
    cursors = new Map();
  let closing = false,
    closeOriginal;
  const stop = (scan) => {
    clearTimeout(scan.timer);
    if (
      !scan.child.killed &&
      scan.child.exitCode === null &&
      scan.child.signalCode === null
    )
      scan.child.kill("SIGKILL");
    scan.child.stdout.destroy();
  };
  const finish = async (scan) => {
    stop(scan);
    await scan.closed;
    scans.delete(scan);
  };
  const execute = async (_id, args, signal) => {
    if (closing) throw new Error("Change observations closed");
    if (signal?.aborted) throw new Error("Change observation canceled");
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (key) => !Object.hasOwn(parameters.properties, key),
      )
    )
      throw new Error(
        "Invalid change arguments: use only declared fields; omit unused fields or set them to null",
      );
    args = Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== null),
    );
    let scan;
    if (args.cursor !== undefined) {
      if (
        Object.keys(args).some((k) => !["cursor", "close"].includes(k)) ||
        (args.close !== undefined && args.close !== true)
      )
        throw new Error(
          "A change cursor request accepts only cursor and optional close:true; omit mode/scope/path or set them to null. For a new query, omit cursor/close or set them to null",
        );
      scan = cursors.get(args.cursor);
      if (!scan)
        throw new Error(
          "Change cursor expired, consumed or foreign; start explicitly",
        );
      cursors.delete(args.cursor);
      clearTimeout(scan.timer);
    } else {
      if (args.close !== undefined)
        throw new Error(
          "Invalid change arguments: close:true requires a returned cursor; omit close and cursor or set them to null for a new query",
        );
      const mode = args.mode ?? "paths",
        scope = args.scope ?? "full",
        path = args.path;
      if (!["paths", "diff", "base", "candidate"].includes(mode))
        throw new Error("Invalid change mode");
      if (!["full", "delta"].includes(scope))
        throw new Error("Invalid change scope");
      if (scope === "delta" && !["paths", "diff"].includes(mode))
        throw new Error(
          "Delta scope applies only to paths and diff modes; use scope full or omit scope for base/candidate file reads",
        );
      if (scope === "delta" && !binding.deltaBase)
        throw new Error(
          "Delta scope is unavailable on the first review round; use scope full or omit scope",
        );
      if (
        path !== undefined &&
        (typeof path !== "string" ||
          !path ||
          path.length > 1024 ||
          path.includes("\\") ||
          path.includes("\0") ||
          path
            .split("/")
            .some(
              (p) =>
                !p || p === "." || p === ".." || p.toLowerCase() === ".git",
            ))
      )
        throw new Error("Select a checkout-relative path");
      if (["base", "candidate"].includes(mode) && !path)
        throw new Error("Select a file");
      if (scans.size >= CHANGE_LIMITS.scans)
        throw new Error(
          "Change cursor capacity reached; close an unused cursor",
        );
      const effectiveBase =
        scope === "delta" ? binding.deltaBase : binding.base;
      const command =
        mode === "paths" || mode === "diff"
          ? [
              "diff",
              ...(mode === "paths"
                ? ["--name-status"]
                : ["--no-color", "--unified=3"]),
              "--no-renames",
              "--no-ext-diff",
              "--no-textconv",
              effectiveBase,
              binding.candidate,
              "--",
              ...(path ? [path] : []),
            ]
          : [
              "show",
              "--no-ext-diff",
              "--no-textconv",
              `${mode === "base" ? effectiveBase : binding.candidate}:${path}`,
            ];
      const child = spawn(
        "git",
        gitArguments([
          "--no-pager",
          "--no-lazy-fetch",
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
          ...command,
        ]),
        {
          cwd: binding.root,
          env: gitEnvironment(),
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );
      const closed = new Promise((resolve) => {
        let error = false;
        child.once("error", () => {
          error = true;
        });
        child.once("close", (code) => resolve({ code, error }));
      });
      scan = {
        child,
        closed,
        iterator: child.stdout[Symbol.asyncIterator](),
        buffer: Buffer.alloc(0),
        eof: false,
        bytes: 0,
        base: effectiveBase,
        scope,
        active: undefined,
        timer: undefined,
        stopped: false,
      };
      scans.add(scan);
    }
    const selected = scan;
    const original = (async () => {
      if (args.close) {
        await finish(selected);
        return render(selected, "", "closed", null, selected.bytes);
      }
      const abort = () => {
        selected.stopped = true;
        stop(selected);
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, CHANGE_LIMITS.operationMs);
      timer.unref();
      try {
        if (signal?.aborted || closing) abort();
        while (
          selected.buffer.length < CHANGE_LIMITS.pageBytes &&
          !selected.eof &&
          !selected.stopped
        ) {
          const next = await selected.iterator.next();
          if (next.done === true) selected.eof = true;
          else
            selected.buffer = selected.buffer.length
              ? Buffer.concat([selected.buffer, Buffer.from(next.value)])
              : Buffer.from(next.value);
        }
        if (selected.stopped || closing)
          throw new Error(
            "Change observation stopped; original Git closure joined",
          );
        const decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        });
        const maxTake = Math.min(
          selected.buffer.length,
          CHANGE_LIMITS.pageBytes,
        );
        let take = completeUtf8Prefix(
          selected.buffer,
          maxTake,
          selected.eof && maxTake === selected.buffer.length,
        );
        // Shrink raw byte count when JSON escaping inflates the serialized envelope
        // beyond responseBytes (always guaranteeing forward progress >= 1 codepoint).
        let part = selected.buffer.subarray(0, take);
        if (part.includes(0))
          throw new Error("Binary Git object omitted; not text evidence");
        let text = decoder.decode(part);
        const envelopeBytes = (n, value) => {
          const st =
            selected.eof && n === selected.buffer.length ? "done" : "more";
          const cur =
            st === "more" ? "00000000-0000-4000-8000-000000000000" : null;
          return Buffer.byteLength(
            JSON.stringify(
              render(selected, value, st, cur, selected.bytes + n),
            ),
          );
        };
        while (
          take > 4 &&
          envelopeBytes(take, text) > CHANGE_LIMITS.responseBytes
        ) {
          const nextTake = completeUtf8Prefix(
            selected.buffer,
            Math.max(4, Math.floor(take * 0.7)),
            false,
          );
          if (nextTake <= 0 || nextTake >= take) break;
          take = nextTake;
          part = selected.buffer.subarray(0, take);
          text = decoder.decode(part);
        }
        selected.buffer = selected.buffer.subarray(take);
        selected.bytes += take;
        const done = selected.eof && selected.buffer.length === 0;
        if (done) {
          const native = await selected.closed;
          if (native.error || native.code !== 0)
            throw new Error("Git evidence unavailable; no complete coverage");
          await finish(selected);
          return render(selected, text, "done", null, selected.bytes);
        }
        const cursor = randomUUID();
        cursors.set(cursor, selected);
        selected.timer = setTimeout(() => {
          cursors.delete(cursor);
          void finish(selected);
        }, CHANGE_LIMITS.idleMs);
        selected.timer.unref();
        return render(selected, text, "more", cursor, selected.bytes);
      } catch (error) {
        await finish(selected);
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    })();
    selected.active = original;
    try {
      return await original;
    } finally {
      if (selected.active === original) selected.active = undefined;
    }
  };
  function renderPayload(scan, text, state, nextCursor, bytes) {
    return JSON.stringify({
      text,
      state,
      nextCursor,
      bytes,
      scope: scan.scope,
      base: scan.base,
      candidate: binding.candidate,
      ...(binding.deltaBase ? { deltaBase: binding.deltaBase } : {}),
      coverage: {
        complete: state === "done",
        consistency: "fixed-git-objects",
      },
    });
  }
  function render(scan, text, state, nextCursor, bytes) {
    return {
      content: [
        {
          type: "text",
          text: renderPayload(scan, text, state, nextCursor, bytes),
        },
      ],
      details: { state, nextCursor },
    };
  }
  return {
    tools: [
      {
        name: "changes",
        label: "changes",
        description:
          "Readonly evidence for the owner's fixed base/candidate commits (and optional deltaBase from the prior review round). mode paths lists changed paths (Git-quoted), diff reads patches, base/candidate reads one file at that revision. scope defaults to full (candidateBase..candidate); scope delta reads deltaBase..candidate when available while full remains always readable. Optional checkout-relative path narrows a diff. Text may split across pages bounded by serialized response bytes: continue exclusively with {cursor}; {cursor,close:true} releases it. more is incomplete, including empty progress. No arbitrary refs, Git commands, shell or writes. Omit unused parameters or set them to null; never invent a cursor or mix query and cursor fields.",
        parameters,
        constrainedSampling: { type: "json_schema", strict: "prefer" },
        execute,
      },
    ],
    close() {
      if (closeOriginal) return closeOriginal;
      closing = true;
      cursors.clear();
      for (const scan of scans) {
        scan.stopped = true;
        stop(scan);
      }
      closeOriginal = Promise.all(
        [...scans].map(async (scan) => {
          await scan.active?.catch(() => {});
          await finish(scan);
        }),
      ).then(() => {});
      return closeOriginal;
    },
  };
}
