/** Cooperative, bounded readonly investigation. No shell, downloads, raw spill,
 * or abandoned Promise.race: every original filesystem operation is joined.
 * Not a sandbox. The parent process deadline remains the hard stop for stuck I/O. */
import { constants } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  resolve,
  sep,
} from "node:path";
import { Type } from "typebox";

export const RESEARCH_LIMITS = {
  calls: 64,
  toolMs: 30_000,
  finishReserveMs: 120_000,
  entries: 2000,
  depth: 8,
  results: 100,
  fileBytes: 1024 * 1024,
  scanBytes: 8 * 1024 * 1024,
  outputBytes: 32 * 1024,
};
const within = (root, path) => {
  const p = relative(root, path);
  return (
    p === "" || (!isAbsolute(p) && p !== ".." && !p.startsWith(`..${sep}`))
  );
};
class Bound extends Error {}
const STOP =
  "Investigation budget reached. Do not retry the same search. Summarize retained evidence, missing coverage and a narrower follow-up for the user.";

/** Node's same-host monotonic clock, not a child-local performance origin. */
export const researchClock = () => Number(process.hrtime.bigint() / 1_000_000n);

export function researchTools(cwd, roots, budget, now = researchClock) {
  const finishAt =
    budget.deadlineMs -
    Math.min(RESEARCH_LIMITS.finishReserveMs, budget.timeoutMs / 10);
  let calls = 0;
  // Resolve only when explicitly used, never during resource discovery.
  let selected;
  const scope = async () => {
    selected ??= (async () => {
      const paths = [];
      // Sequential originals: a rejected root cannot abandon sibling realpaths.
      for (const p of roots.length ? roots : [cwd])
        paths.push(await realpath(resolve(cwd, p)));
      return paths;
    })();
    return selected;
  };
  const pathSchema = Type.Optional(
    Type.String({
      description:
        "Path inside the supplied investigation roots; omitted and relative paths use the first root. Never start at / or a parent directory.",
    }),
  );
  const limitSchema = Type.Optional(
    Type.Integer({ minimum: 1, maximum: RESEARCH_LIMITS.results }),
  );
  const tools = [
    {
      name: "ls",
      description:
        "List one directory without per-entry stat calls. Filesystem order, at most 100 entries; use a specific subdirectory to narrow. No recursive listing.",
      parameters: Type.Object({ path: pathSchema, limit: limitSchema }),
    },
    {
      name: "find",
      description:
        "Bounded simple filename glob search (*, **, ?, brackets; no braces/extglobs) inside an investigation root. At most 2000 entries, depth 8, 100 results and 30s cooperative work. Does not follow symlinks; skips .git/node_modules, not backup trees. Does not interpret .gitignore. Partial coverage is explicit; narrow the path rather than repeating.",
      parameters: Type.Object({
        pattern: Type.String({ minLength: 1, maxLength: 256 }),
        path: pathSchema,
        limit: limitSchema,
        depth: Type.Optional(
          Type.Integer({ minimum: 0, maximum: RESEARCH_LIMITS.depth }),
        ),
      }),
    },
    {
      name: "grep",
      description:
        "Bounded literal text search (not regex). Search a specific file or narrow directory; optional simple filename glob (no braces/extglobs). At most 1MiB per file, 8MiB total, 2000 entries, depth 8, 100 matching lines. Binary files, symlinks and .git/node_modules are not searched; .gitignore is not interpreted. Reports incomplete coverage.",
      parameters: Type.Object({
        pattern: Type.String({ minLength: 1, maxLength: 256 }),
        path: pathSchema,
        glob: Type.Optional(Type.String({ maxLength: 256 })),
        ignoreCase: Type.Optional(Type.Boolean()),
        literal: Type.Optional(Type.Boolean()),
        limit: limitSchema,
        depth: Type.Optional(
          Type.Integer({ minimum: 0, maximum: RESEARCH_LIMITS.depth }),
        ),
      }),
    },
    {
      name: "read",
      description:
        "Read a bounded UTF-8 text file within the investigation roots. At most the first 1MiB, 100 requested lines and 32KiB output. Binary/media are not decoded; partial coverage is explicit.",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: limitSchema,
      }),
    },
  ];
  return tools.map((tool) => ({
    ...tool,
    label: tool.name,
    async execute(_id, args, signal) {
      if (++calls > RESEARCH_LIMITS.calls || now() >= finishAt)
        throw new Error(STOP);
      const startedAt = now();
      const deadline = Math.min(finishAt, now() + RESEARCH_LIMITS.toolMs);
      const check = () => {
        if (signal?.aborted) throw new Error("Investigation canceled");
        if (now() >= deadline) throw new Bound("cooperative time limit");
      };
      const limits = new Set();
      const lines = [];
      let entries = 0,
        bytes = 0,
        outputBytes = 0;
      const limit = args.limit ?? RESEARCH_LIMITS.results;
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > RESEARCH_LIMITS.results
      )
        throw new Error("Invalid result limit");
      const depth = args.depth ?? RESEARCH_LIMITS.depth;
      if (
        !Number.isSafeInteger(depth) ||
        depth < 0 ||
        depth > RESEARCH_LIMITS.depth
      )
        throw new Error("Invalid search depth");
      const add = (line) => {
        if (lines.length >= limit) throw new Bound("result limit");
        if (
          outputBytes + Buffer.byteLength(line) + 1 >
          RESEARCH_LIMITS.outputBytes
        )
          throw new Bound("output limit");
        outputBytes += Buffer.byteLength(line) + 1;
        lines.push(line);
      };
      const read = async (path) => {
        check();
        const file = await open(
          path,
          constants.O_RDONLY |
            constants.O_NONBLOCK |
            (constants.O_NOFOLLOW ?? 0),
        );
        try {
          check();
          const info = await file.stat();
          if (!info.isFile())
            throw new Error("Only regular text files can be read");
          const size = Math.min(
            RESEARCH_LIMITS.fileBytes,
            RESEARCH_LIMITS.scanBytes - bytes,
          );
          if (!size) throw new Bound("aggregate byte limit");
          const buffer = Buffer.alloc(size);
          let offset = 0;
          while (offset < size) {
            check();
            const result = await file.read(
              buffer,
              offset,
              Math.min(65536, size - offset),
              offset,
            );
            bytes += result.bytesRead;
            if (!result.bytesRead) break;
            offset += result.bytesRead;
          }
          check();
          // Read actual EOF, not stat.size (virtual/growing files can report zero).
          if (offset === size) limits.add("file/aggregate byte limit");
          const content = buffer.subarray(0, offset);
          if (content.includes(0)) {
            limits.add("binary file omitted");
            return null;
          }
          try {
            return new TextDecoder("utf-8", { fatal: true }).decode(content);
          } catch {
            limits.add("non-UTF-8 or cut UTF-8 file omitted");
            return null;
          }
        } finally {
          await file.close();
        }
      };
      const walk = async function* (path, remaining, root) {
        check();
        const dir = await opendir(path);
        try {
          for (;;) {
            check();
            const e = await dir.read();
            check();
            if (!e) break;
            if (++entries > RESEARCH_LIMITS.entries)
              throw new Bound("entry limit");
            const full = join(path, e.name);
            if (e.isSymbolicLink()) {
              limits.add("symlink omitted");
              continue;
            }
            if (e.isDirectory()) {
              if (e.name === ".git" || e.name === "node_modules") {
                limits.add(".git/node_modules omitted");
                continue;
              }
              if (remaining === 0) {
                limits.add("depth limit");
                continue;
              }
              try {
                yield* walk(full, remaining - 1, root);
              } catch (error) {
                if (error instanceof Bound || signal?.aborted) throw error;
                limits.add("unreadable directory omitted");
              }
            } else if (e.isFile())
              yield {
                path: full,
                name: relative(root, full).split(sep).join("/"),
              };
            else limits.add("special file omitted");
          }
        } finally {
          await dir.close();
        }
      };
      try {
        check();
        const allowed = await scope();
        check();
        const target = await realpath(
          args.path === undefined ? allowed[0] : resolve(allowed[0], args.path),
        );
        check();
        if (!allowed.some((p) => within(p, target)))
          throw new Error(
            "Path outside investigation roots. Ask the coordinator to select the specific intended root; do not enumerate parent directories.",
          );
        const info = await stat(target);
        check();
        if (tool.name === "ls") {
          if (!info.isDirectory()) throw new Error("Select a directory");
          const dir = await opendir(target);
          try {
            for (;;) {
              check();
              const e = await dir.read();
              check();
              if (!e) break;
              entries++;
              add(
                `${e.name}${e.isDirectory() ? "/" : e.isSymbolicLink() ? " [symlink; not followed]" : ""}`,
              );
            }
          } finally {
            await dir.close();
          }
        } else if (tool.name === "read") {
          const content = await read(target);
          const offset = args.offset ?? 1;
          if (!Number.isSafeInteger(offset) || offset < 1)
            throw new Error("Invalid line offset");
          if (content !== null)
            for (const line of content.split("\n").slice(offset - 1)) {
              check();
              add(line);
            }
        } else {
          if (tool.name === "grep" && args.literal === false)
            throw new Error(
              "Research grep supports literal text only. Supply a literal pattern, not a regex.",
            );
          const glob = tool.name === "find" ? args.pattern : args.glob;
          if (
            glob !== undefined &&
            (typeof glob !== "string" ||
              !glob ||
              glob.length > 256 ||
              /[{}()]/u.test(glob))
          )
            throw new Error("Use a simple glob without braces or extglobs");
          const pattern = args.ignoreCase
            ? args.pattern.toLowerCase()
            : args.pattern;
          const files = info.isDirectory()
            ? walk(target, depth, target)
            : [{ path: target, name: basename(target) }];
          for await (const file of files) {
            check();
            if (
              glob &&
              !matchesGlob(
                glob.includes("/") ? file.name : basename(file.name),
                glob,
              )
            )
              continue;
            if (tool.name === "find") add(file.name);
            else {
              let content;
              try {
                content = await read(file.path);
              } catch (e) {
                if (e instanceof Bound || signal?.aborted) throw e;
                limits.add("unreadable file omitted");
                continue;
              }
              if (content === null) continue;
              let n = 0;
              for (const line of content.split("\n")) {
                check();
                n++;
                if (
                  (args.ignoreCase ? line.toLowerCase() : line).includes(
                    pattern,
                  )
                )
                  add(`${file.name}:${n}: ${line}`);
              }
            }
          }
        }
      } catch (e) {
        if (!(e instanceof Bound)) throw e;
        limits.add(e.message);
      }
      // A bounded prefix is evidence, never proof that the unsearched tree has no match.
      const partial = limits.size > 0;
      return {
        content: [
          {
            type: "text",
            text: `${lines.join("\n") || (partial ? "No results in the inspected portion." : "No results in the requested scope.")}\n\n${partial ? `[Partial coverage: ${[...limits].join(", ")}. Narrow the path; do not infer absence.]` : "[Requested scope inspected.]"}${now() >= finishAt || calls >= RESEARCH_LIMITS.calls ? `\n${STOP}` : ""}`,
          },
        ],
        details: {
          elapsedMs: Math.max(0, now() - startedAt),
          inspectedEntries: entries,
          readBytes: bytes,
          ...(partial ? { truncation: { reason: [...limits] } } : {}),
        },
      };
    },
  }));
}
