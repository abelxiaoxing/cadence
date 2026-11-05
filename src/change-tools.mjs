/** Fixed-revision, readonly Git evidence. Suspended pipes retain real stream
 * positions under backpressure, never replay prefixes or spill source copies. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { gitArguments, gitEnvironment } from "./git-environment.mjs";

export const CHANGE_LIMITS = Object.freeze({
  scans: 4,
  pageBytes: 2048,
  idleMs: 120000,
  operationMs: 30000,
});
export function createChangeTools(binding) {
  binding = Object.freeze({ ...binding });
  if (
    typeof binding.root !== "string" ||
    ![binding.base, binding.candidate].every((oid) =>
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(oid),
    )
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
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Invalid change arguments");
    let scan;
    if (args.cursor !== undefined) {
      if (
        Object.keys(args).some((k) => !["cursor", "close"].includes(k)) ||
        (args.close !== undefined && args.close !== true)
      )
        throw new Error("A change cursor cannot change its query");
      scan = cursors.get(args.cursor);
      if (!scan)
        throw new Error(
          "Change cursor expired, consumed or foreign; start explicitly",
        );
      cursors.delete(args.cursor);
      clearTimeout(scan.timer);
    } else {
      if (Object.keys(args).some((k) => !["mode", "path"].includes(k)))
        throw new Error("Invalid change arguments");
      const mode = args.mode ?? "paths",
        path = args.path;
      if (!["paths", "diff", "base", "candidate"].includes(mode))
        throw new Error("Invalid change mode");
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
              binding.base,
              binding.candidate,
              "--",
              ...(path ? [path] : []),
            ]
          : [
              "show",
              "--no-ext-diff",
              "--no-textconv",
              `${binding[mode]}:${path}`,
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
        decoder: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }),
        buffer: Buffer.alloc(0),
        bytes: 0,
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
        return render("", "closed", null, selected.bytes);
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
        let done = false;
        if (!selected.buffer.length && !selected.stopped) {
          const next = await selected.iterator.next();
          done = next.done === true;
          if (!done) selected.buffer = Buffer.from(next.value);
        }
        if (selected.stopped || closing)
          throw new Error(
            "Change observation stopped; original Git closure joined",
          );
        const part = selected.buffer.subarray(0, CHANGE_LIMITS.pageBytes);
        selected.buffer = selected.buffer.subarray(part.length);
        if (part.includes(0))
          throw new Error("Binary Git object omitted; not text evidence");
        const text = selected.decoder.decode(part, { stream: !done });
        selected.bytes += part.length;
        if (done) {
          const native = await selected.closed;
          if (native.error || native.code !== 0)
            throw new Error("Git evidence unavailable; no complete coverage");
          await finish(selected);
          return render(text, "done", null, selected.bytes);
        }
        const cursor = randomUUID();
        cursors.set(cursor, selected);
        selected.timer = setTimeout(() => {
          cursors.delete(cursor);
          void finish(selected);
        }, CHANGE_LIMITS.idleMs);
        selected.timer.unref();
        return render(text, "more", cursor, selected.bytes);
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
  function render(text, state, nextCursor, bytes) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            text,
            state,
            nextCursor,
            bytes,
            base: binding.base,
            candidate: binding.candidate,
            coverage: {
              complete: state === "done",
              consistency: "fixed-git-objects",
            },
          }),
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
          "Readonly evidence for the owner's fixed base/candidate commits. mode paths lists changed paths (Git-quoted), diff reads patches, base/candidate reads one file at that revision. Optional checkout-relative path narrows a diff. Text may split across pages: continue exclusively with {cursor}; {cursor,close:true} releases it. more is incomplete, including empty progress. No arbitrary refs, Git commands, shell or writes.",
        parameters: Type.Object(
          {
            mode: Type.Optional(
              Type.String({ enum: ["paths", "diff", "base", "candidate"] }),
            ),
            path: Type.Optional(Type.String({ maxLength: 1024 })),
            cursor: Type.Optional(Type.String({ maxLength: 128 })),
            close: Type.Optional(Type.Literal(true)),
          },
          { additionalProperties: false },
        ),
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
