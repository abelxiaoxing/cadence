/** Model-facing observation tools and their worker-local resource lifetime.
 * A cursor is one-use navigation, never execution authority or a durable snapshot. */
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { RESEARCH_LIMITS as L, ResearchScan } from "./research-scan.mjs";

const object = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid investigation arguments");
  return value;
};
const integer = (value, maximum = Number.MAX_SAFE_INTEGER, minimum = 1) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error("Invalid investigation range or limit");
  return value;
};
const string = (value, maximum = 4096) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new Error("Invalid investigation path or pattern");
  return value;
};
const array = (value, maximum) => {
  if (!Array.isArray(value) || !value.length || value.length > maximum)
    throw new Error("Invalid investigation batch");
  return value;
};
const glob = (value) => {
  string(value, 256);
  if (/[{}()]/u.test(value))
    throw new Error("Use a simple glob without braces or extglobs");
  return value;
};
function query(kind, args) {
  const common = ["pageSize", "path"];
  object(args, [
    ...common,
    ...(kind === "read"
      ? ["files", "offset", "limit"]
      : kind === "grep"
        ? ["pattern", "patterns", "glob", "depth", "ignoreCase", "literal"]
        : kind === "find"
          ? ["pattern", "depth"]
          : []),
  ]);
  const result = {
    kind,
    pageSize: integer(args.pageSize ?? L.results, L.results),
  };
  if (kind === "read") {
    if (
      args.files !== undefined &&
      ["path", "offset", "limit"].some((key) => args[key] !== undefined)
    )
      throw new Error("Select either one file or a file batch");
    const offset = integer(args.offset ?? 1);
    const end =
      args.limit === undefined
        ? Number.MAX_SAFE_INTEGER
        : integer(offset + integer(args.limit) - 1);
    const files =
      args.files === undefined
        ? [{ path: string(args.path), ranges: [{ start: offset, end }] }]
        : array(args.files, L.files);
    let count = 0;
    result.files = files.map((entry) => {
      object(entry, ["path", "ranges"]);
      const ranges = entry.ranges ?? [
        { start: 1, end: Number.MAX_SAFE_INTEGER },
      ];
      return {
        path: string(entry.path),
        ranges: array(ranges, L.ranges).map((range) => {
          object(range, ["start", "end"]);
          if (++count > L.ranges)
            throw new Error("Too many requested line ranges");
          const start = integer(range.start);
          return {
            start,
            end: integer(range.end, Number.MAX_SAFE_INTEGER, start),
          };
        }),
      };
    });
  } else {
    result.path = args.path === undefined ? undefined : string(args.path);
    result.depth = integer(args.depth ?? L.depth, L.depth, 0);
    if (kind === "find") result.glob = glob(args.pattern);
    if (kind === "grep") {
      if (args.literal !== undefined && args.literal !== true)
        throw new Error("Research grep supports literal text only, not regex");
      if (args.ignoreCase !== undefined && typeof args.ignoreCase !== "boolean")
        throw new Error("Invalid case selection");
      if ((args.pattern === undefined) === (args.patterns === undefined))
        throw new Error("Supply one pattern or a patterns array");
      result.ignoreCase = args.ignoreCase === true;
      result.patterns = array(args.patterns ?? [args.pattern], L.patterns).map(
        (pattern) => {
          const text = string(pattern, 256);
          return result.ignoreCase ? text.toLowerCase() : text;
        },
      );
      if (args.glob !== undefined) result.glob = glob(args.glob);
    }
  }
  return result;
}

const path = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 4096,
    description:
      "Within the admitted roots; relative paths use the first root.",
  }),
);
const pageSize = Type.Optional(
  Type.Integer({ minimum: 1, maximum: L.results }),
);
const depth = Type.Optional(Type.Integer({ minimum: 0, maximum: L.depth }));
const pattern = Type.String({ minLength: 1, maxLength: 256 });
// Provider function schemas require an object root, not a union of objects.
// Initial-query versus continuation exclusivity is checked before admission;
// every field is optional here because a continuation carries no query fields.
const parameters = (shape) =>
  Type.Partial(
    Type.Object({
      ...shape,
      cursor: Type.String({ minLength: 1, maxLength: 128 }),
      close: Type.Literal(true),
    }),
    { additionalProperties: false },
  );
const definitions = [
  {
    name: "read",
    description:
      "Read UTF-8 text or a batch of file/line ranges. Use path with optional 1-based offset/limit, or files with ranges {start,end}. Overlapping ranges are merged. pageSize bounds one response, not the requested range. Resume a returned cursor instead of rereading a prefix; {cursor,close:true} releases it. Long/binary/invalid text omissions are explicit.",
    parameters: parameters({
      path,
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      files: Type.Optional(
        Type.Array(
          Type.Object(
            {
              path: Type.String(),
              ranges: Type.Optional(
                Type.Array(
                  Type.Object({
                    start: Type.Integer({ minimum: 1 }),
                    end: Type.Integer({ minimum: 1 }),
                  }),
                  { minItems: 1, maxItems: L.ranges },
                ),
              ),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: L.files },
        ),
      ),
      pageSize,
    }),
  },
  {
    name: "grep",
    description:
      "Search literal text, not regex, in one file or a tree. Supply pattern or patterns (OR; matchedPatterns are zero-based input indexes). Each file is scanned once per query. Optional simple glob, ignoreCase and depth. No symlink traversal, .gitignore interpretation, or .git/node_modules scan. Empty pages with a cursor are progress, NOT absence. Resume with {cursor}, or release with {cursor,close:true}.",
    parameters: parameters({
      path,
      pattern: Type.Optional(pattern),
      patterns: Type.Optional(
        Type.Array(pattern, { minItems: 1, maxItems: L.patterns }),
      ),
      glob: Type.Optional(pattern),
      literal: Type.Optional(Type.Literal(true)),
      ignoreCase: Type.Optional(Type.Boolean()),
      depth,
      pageSize,
    }),
  },
  {
    name: "find",
    description:
      "Find file paths with a simple glob (*, **, ?, brackets; no braces/extglobs). Bounded traversal in filesystem order, skipping tree symlinks and .git/node_modules, not backup trees; .gitignore is not interpreted. Resume actual directory positions with {cursor}; {cursor,close:true} releases them. Coverage/omissions are explicit.",
    parameters: parameters({ path, pattern, depth, pageSize }),
  },
  {
    name: "ls",
    description:
      "List one directory in filesystem order, including entry kinds. Does not follow symlinks or recurse. Continue with the returned {cursor}, not a repeated initial request; {cursor,close:true} releases it.",
    parameters: parameters({ path, pageSize }),
  },
];

function render(scan, items, state, nextCursor, pausedBy, elapsedMs) {
  const omissions = [...scan.omissions].map(([reason, count]) => ({
    reason,
    count,
  }));
  const details = {
    state,
    nextCursor,
    pausedBy,
    coverage: {
      complete: state === "done" && !omissions.length,
      consistency: "live-filesystem",
      omissions,
    },
    progress: { ...scan.page, total: { ...scan.total } },
    elapsedMs,
    ...(state === "more" || omissions.length
      ? {
          truncation: {
            reason: [
              ...(pausedBy ? [pausedBy] : []),
              ...omissions.map((o) => o.reason),
            ],
          },
        }
      : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify({ items, ...details }) }],
    details,
  };
}
const size = (result) => Buffer.byteLength(JSON.stringify(result));

export function createResearchTools(workspace, now = () => performance.now()) {
  const scans = new Set();
  const cursors = new Map();
  let closing = false,
    closingOriginal,
    failure;
  const finish = (scan) => {
    scan.finishing ??= (async () => {
      try {
        await scan.close();
        scans.delete(scan);
      } catch {
        failure = new Error("Investigation resource closure failed");
        throw failure;
      }
    })();
    return scan.finishing;
  };
  const stop = async (scan) => {
    scan.stopping = true;
    await scan.active?.catch(() => {});
    await finish(scan);
  };
  const execute = (kind, args, signal) => {
    if (closing || failure)
      return Promise.reject(failure ?? new Error("Investigation tools closed"));
    if (signal?.aborted)
      return Promise.reject(new Error("Investigation canceled"));
    let scan,
      close = false;
    try {
      if (args?.cursor !== undefined) {
        object(args, ["cursor", "close"]);
        if (args.close !== undefined && args.close !== true)
          throw new Error("Invalid cursor operation");
        const token = string(args.cursor, 128);
        scan = cursors.get(token);
        if (scan && scan.query.kind === kind && now() >= scan.expiresAt) {
          cursors.delete(token);
          clearTimeout(scan.timer);
          void stop(scan).catch(() => {
            /* finish retains the closure failure. */
          });
          throw new Error(
            "Investigation cursor expired; start a fresh query explicitly",
          );
        }
        if (!scan || scan.query.kind !== kind)
          throw new Error(
            "Investigation cursor consumed or foreign; start a fresh query explicitly",
          );
        cursors.delete(token);
        clearTimeout(scan.timer);
        close = args.close === true;
      } else {
        const request = query(kind, args);
        if (scans.size >= L.scans)
          throw new Error(
            "Investigation cursor capacity reached; close an unused cursor",
          );
        scan = new ResearchScan(workspace, request);
        scans.add(scan); // Reserve before the first asynchronous filesystem operation.
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const original = (async () => {
      const startedAt = now();
      scan.begin(signal);
      const items = [];
      const token = randomUUID();
      let done = false,
        pausedBy = null;
      try {
        if (close) {
          await finish(scan);
          return render(
            scan,
            [],
            "closed",
            null,
            null,
            Math.max(0, now() - startedAt),
          );
        }
        await scan.validate();
        for (;;) {
          scan.check();
          if (now() - startedAt >= L.toolMs) {
            pausedBy = "cooperative time quantum";
            break;
          }
          const next = scan.pending ?? (await scan.iterator.next());
          scan.pending = undefined;
          scan.check();
          if (next.done) {
            done = true;
            break;
          }
          if (!next.value) continue;
          if (next.value.pause) {
            pausedBy = next.value.pause;
            break;
          }
          const item = next.value.item;
          const candidate = render(
            scan,
            [...items, item],
            "more",
            token,
            "output quantum",
            0,
          );
          // Reserve bounded metadata growth (counters/omissions/elapsed) while
          // charging the entire encoded envelope, not just unescaped line text.
          if (size(candidate) > L.outputBytes - 4096) {
            if (!items.length) {
              scan.omit("oversized result omitted");
              continue;
            }
            scan.pending = next;
            pausedBy = "output quantum";
            break;
          }
          if (items.length >= scan.query.pageSize) {
            scan.pending = next;
            pausedBy = "result quantum";
            break;
          }
          items.push(item);
        }
        await scan.validate();
        scan.check();
        if (done) await finish(scan);
        const result = render(
          scan,
          items,
          done ? "done" : "more",
          done ? null : token,
          pausedBy,
          Math.max(0, now() - startedAt),
        );
        if (size(result) > L.outputBytes)
          throw new Error("Investigation reply exceeds bound");
        if (!done) {
          scan.expiresAt = now() + L.idleMs;
          cursors.set(token, scan);
          scan.timer = setTimeout(() => {
            cursors.delete(token);
            void stop(scan).catch(() => {
              /* finish retains the failure and reservation. */
            });
          }, L.idleMs);
          scan.timer.unref();
        }
        return result;
      } catch (error) {
        await finish(scan);
        throw error;
      }
    })();
    scan.active = original;
    // Return the tracked original. No detached rejecting finally promise.
    return original.finally(() => {
      if (scan.active === original) scan.active = undefined;
    });
  };
  return {
    tools: definitions.map((tool) => ({
      ...tool,
      label: tool.name,
      execute: (_id, args, signal) => execute(tool.name, args, signal),
    })),
    close() {
      if (closingOriginal) return closingOriginal;
      closing = true;
      for (const scan of cursors.values()) clearTimeout(scan.timer);
      cursors.clear();
      closingOriginal = (async () => {
        const outcomes = await Promise.allSettled([...scans].map(stop));
        if (
          failure ||
          outcomes.some((outcome) => outcome.status === "rejected")
        )
          throw failure ?? new Error("Investigation resource closure failed");
      })();
      return closingOriginal;
    },
  };
}
