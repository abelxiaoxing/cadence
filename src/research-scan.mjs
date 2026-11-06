/** One live filesystem observation. The suspended iterator owns real positions,
 * not a page number or a replay of an earlier scan. No shell or spill files. */
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, matchesGlob, relative, resolve, sep } from "node:path";
import { withinRoot } from "./worker-workspace.mjs";

export const RESEARCH_LIMITS = Object.freeze({
  toolMs: 30_000,
  entries: 2000,
  depth: 8,
  results: 100,
  fileBytes: 1024 * 1024, // Per file per page, NOT a permanently invisible suffix.
  scanBytes: 8 * 1024 * 1024,
  outputBytes: 32 * 1024, // Complete JSON-encoded tool result, including metadata.
  chunkBytes: 64 * 1024,
  lineBytes: 8 * 1024,
  scans: 4, // Includes opening, active, suspended and closing originals.
  idleMs: 120_000,
  files: 8,
  ranges: 32,
  patterns: 16,
});
export class SourceChanged extends Error {
  constructor() {
    super("Investigation source changed; start a fresh query explicitly.");
  }
}
const identity = (s) =>
  `${s.dev}:${s.ino}:${s.mode}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const unavailable = (e) =>
  ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(e?.code);
const counters = () => ({
  readBytes: 0,
  inspectedEntries: 0,
  inspectedLines: 0,
});

export class ResearchScan {
  constructor(workspace, query) {
    this.workspace = workspace;
    this.query = query;
    this.omissions = new Map();
    this.total = counters();
    this.page = counters();
    this.fileBytes = new Map();
    this.sources = new Set();
    this.bindings = new Map();
    this.stopping = false;
    this.iterator = this.records();
  }
  begin(signal) {
    this.signal = signal;
    this.page = counters();
    this.fileBytes.clear();
  }
  check() {
    if (this.stopping || this.signal?.aborted)
      throw new Error("Investigation canceled");
  }
  count(key, n = 1) {
    this.page[key] += n;
    this.total[key] += n;
  }
  omit(reason) {
    this.omissions.set(reason, (this.omissions.get(reason) ?? 0) + 1);
  }
  async source(path) {
    this.check();
    if ((await realpath(path)) !== path) throw new SourceChanged();
    this.check();
    const info = await lstat(path, { bigint: true });
    this.check();
    return { path, identity: identity(info), info };
  }
  async validateSource(source) {
    let current;
    try {
      current = await this.source(source.path);
    } catch (e) {
      if (unavailable(e)) throw new SourceChanged();
      throw e;
    }
    if (current.identity !== source.identity) throw new SourceChanged();
    if (
      source.file &&
      identity(await source.file.stat({ bigint: true })) !== source.identity
    )
      throw new SourceChanged();
    this.check();
  }
  async validateBinding(path, selected) {
    this.check();
    try {
      if ((await realpath(path)) !== selected) throw new SourceChanged();
    } catch (e) {
      if (unavailable(e)) throw new SourceChanged();
      throw e;
    }
    this.check();
  }
  async validate() {
    for (const [path, selected] of this.bindings)
      await this.validateBinding(path, selected);
    for (const source of this.sources) await this.validateSource(source);
  }
  async closeHandle(handle) {
    try {
      await handle.close();
    } catch {
      this.closeFailed = true;
      // Never classify a failed close as an ordinary unreadable-file omission.
      throw new Error("Investigation handle closure failed");
    }
  }
  async canonical(path) {
    this.check();
    const selected = await realpath(path);
    this.check();
    return selected;
  }
  bind(path, selected) {
    if (path === selected) return () => {};
    const previous = this.bindings.get(path);
    if (previous !== undefined && previous !== selected)
      throw new SourceChanged();
    this.bindings.set(path, selected);
    return () => {
      if (previous === undefined) this.bindings.delete(path);
    };
  }
  async target(path) {
    const expanded =
      path === "~"
        ? homedir()
        : path?.startsWith("~/")
          ? join(homedir(), path.slice(2))
          : path;
    const requested = resolve(this.roots[0], expanded ?? ".");
    const selected = await this.canonical(requested);
    this.bind(requested, selected);
    // Roots choose the default query scope, not permission to read host files.
    const root = this.roots.findIndex((p) => withinRoot(p, requested));
    return { path: selected, display: requested, root: root < 0 ? null : root };
  }
  location(target) {
    const path = target.display ?? target.path;
    return {
      root: target.root,
      path:
        target.root === null
          ? path
          : relative(this.roots[target.root], path).split(sep).join("/") ||
            basename(path),
    };
  }
  async *records() {
    this.roots = [];
    // No parallel root resolution: an invalid root never abandons sibling I/O.
    for (const root of this.workspace.roots) {
      this.check();
      const path = await realpath(root);
      const source = await this.source(path);
      this.roots.push(path);
      this.sources.add(source);
    }
    if (this.query.kind === "read") {
      const files = new Map();
      for (const request of this.query.files) {
        const target = await this.target(request.path);
        const existing = files.get(target.path);
        if (existing) existing.ranges.push(...request.ranges);
        else files.set(target.path, { ...target, ranges: [...request.ranges] });
      }
      for (const target of files.values()) {
        target.ranges.sort((a, b) => a.start - b.start);
        const ranges = [];
        for (const range of target.ranges) {
          const last = ranges.at(-1);
          if (last && range.start <= last.end + 1)
            last.end = Math.max(last.end, range.end);
          else ranges.push({ ...range });
        }
        yield* this.lines(target, ranges);
      }
      return;
    }
    const target = await this.target(this.query.path);
    const source = await this.source(target.path);
    if (this.query.kind === "ls" && !source.info.isDirectory())
      throw new Error("Select a directory");
    if (!source.info.isDirectory() && !source.info.isFile()) {
      this.omit("special file omitted");
      return;
    }
    const files = source.info.isDirectory()
      ? this.walk(target, this.query.depth)
      : (async function* () {
          yield target;
        })();
    for await (const file of files) {
      if (file === null || file.pause) {
        yield file;
        continue;
      }
      if (this.query.kind === "ls") {
        yield { item: { ...this.location(file), kind: file.kind } };
        continue;
      }
      const glob = this.query.glob;
      const name =
        relative(target.display, file.display).split(sep).join("/") ||
        basename(file.display);
      if (
        glob &&
        !matchesGlob(glob.includes("/") ? name : basename(file.display), glob)
      ) {
        yield null;
        continue;
      }
      if (["find", "glob"].includes(this.query.kind))
        yield { item: { ...this.location(file), kind: "file" } };
      else {
        try {
          yield* this.lines(file);
        } catch (e) {
          if (!unavailable(e)) throw e;
          this.omit("unreadable file omitted");
          yield null;
        }
      }
    }
  }
  async *walk(target, remaining, ancestors = new Set()) {
    if (ancestors.has(target.path)) {
      this.omit("symlink cycle omitted");
      return;
    }
    const branch = new Set(ancestors).add(target.path);
    const source = await this.source(target.path);
    this.check();
    const dir = await opendir(target.path);
    this.sources.add(source);
    try {
      await this.validateSource(source);
      for (;;) {
        this.check();
        if (this.page.inspectedEntries >= RESEARCH_LIMITS.entries) {
          yield { pause: "entry quantum" };
          continue;
        }
        const entry = await dir.read();
        this.check();
        if (!entry) return;
        this.count("inspectedEntries");
        const file = {
          path: join(target.path, entry.name),
          display: join(target.display, entry.name),
          root: target.root,
        };
        if (this.query.kind === "ls") {
          yield {
            ...file,
            kind: entry.isSymbolicLink()
              ? "symlink"
              : entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "special",
          };
          continue;
        }
        let release = () => {};
        const binding = file.path;
        try {
          let info = entry;
          if (entry.isSymbolicLink()) {
            try {
              file.path = await this.canonical(file.path);
              release = this.bind(binding, file.path);
              this.check();
              info = await lstat(file.path);
              this.check();
            } catch (e) {
              if (!unavailable(e)) throw e;
              this.omit("unreadable symlink omitted");
              yield null;
              continue;
            }
          }
          if (info.isDirectory()) {
            if (entry.name === ".git") this.omit(".git omitted");
            else if (!remaining) this.omit("depth limit");
            else {
              yield null;
              try {
                yield* this.walk(file, remaining - 1, branch);
              } catch (e) {
                if (!unavailable(e)) throw e;
                this.omit("unreadable directory omitted");
              }
            }
          } else if (info.isFile()) {
            yield file;
            continue;
          } else this.omit("special file omitted");
        } finally {
          try {
            if (
              entry.isSymbolicLink() &&
              this.bindings.has(binding) &&
              !this.stopping &&
              !this.signal?.aborted
            ) {
              await this.validateBinding(binding, file.path);
            }
          } finally {
            release();
          }
        }
        yield null;
      }
    } finally {
      try {
        if (!this.stopping && !this.signal?.aborted)
          await this.validateSource(source);
      } finally {
        await this.closeHandle(dir);
        this.sources.delete(source);
      }
    }
  }
  async *lines(target, ranges) {
    const source = await this.source(target.path);
    if (!source.info.isFile())
      throw new Error("Only regular text files can be read");
    this.check();
    const file = await open(
      target.path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    source.file = file;
    this.sources.add(source);
    try {
      this.check();
      if (!(await file.stat()).isFile())
        throw new Error("Only regular text files can be read");
      await this.validateSource(source);
      const buffer = Buffer.alloc(RESEARCH_LIMITS.chunkBytes);
      const line = Buffer.alloc(RESEARCH_LIMITS.lineBytes);
      // decode() starts a fresh stream for each line. Preserve U+FEFF rather
      // than treating every line's leading bytes as a new file BOM.
      const decoder = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      });
      let position = 0,
        used = 0,
        number = 1,
        long = false,
        rangeIndex = 0;
      const emit = () => {
        this.count("inspectedLines");
        while (
          ranges &&
          rangeIndex < ranges.length &&
          number > ranges[rangeIndex].end
        )
          rangeIndex++;
        const wanted =
          !ranges ||
          (rangeIndex < ranges.length && number >= ranges[rangeIndex].start);
        if (!wanted) return null;
        if (long) {
          this.omit("long line omitted");
          return null;
        }
        let text;
        try {
          text = decoder.decode(
            line.subarray(0, used && line[used - 1] === 13 ? used - 1 : used),
          );
        } catch {
          this.omit("non-UTF-8 line omitted");
          return null;
        }
        const item = { ...this.location(target), line: number, text };
        if (!ranges) {
          const haystack = this.query.ignoreCase ? text.toLowerCase() : text;
          const matched = this.query.patterns.flatMap((pattern, index) =>
            (
              this.query.literal
                ? haystack.includes(pattern)
                : this.query.regex[index].test(text)
            )
              ? [index]
              : [],
          );
          if (!matched.length) return null;
          item.matchedPatterns = matched;
        }
        return { item };
      };
      for (;;) {
        this.check();
        const allowance = Math.min(
          RESEARCH_LIMITS.chunkBytes,
          RESEARCH_LIMITS.fileBytes - (this.fileBytes.get(target.path) ?? 0),
          RESEARCH_LIMITS.scanBytes - this.page.readBytes,
        );
        if (!allowance) {
          yield { pause: "byte quantum" };
          continue;
        }
        const { bytesRead } = await file.read(buffer, 0, allowance, position);
        this.check();
        this.count("readBytes", bytesRead);
        this.fileBytes.set(
          target.path,
          (this.fileBytes.get(target.path) ?? 0) + bytesRead,
        );
        position += bytesRead;
        if (!bytesRead) {
          if (used || long) yield emit();
          return;
        }
        if (buffer.subarray(0, bytesRead).includes(0)) {
          this.omit("binary file omitted");
          return;
        }
        for (let at = 0; at < bytesRead; ) {
          this.check();
          const newline = buffer.indexOf(10, at);
          const end = newline < 0 || newline >= bytesRead ? bytesRead : newline;
          if (!long) {
            if (used + end - at > line.length) long = true;
            else {
              buffer.copy(line, used, at, end);
              used += end - at;
            }
          }
          at = end;
          if (end < bytesRead) {
            yield emit();
            if (ranges && number >= ranges.at(-1).end) return;
            number++;
            used = 0;
            long = false;
            at++;
          }
        }
        // Even a single huge line makes bounded, observable byte progress.
        yield null;
      }
    } finally {
      try {
        if (!this.stopping && !this.signal?.aborted)
          await this.validateSource(source);
      } finally {
        await this.closeHandle(file);
        this.sources.delete(source);
      }
    }
  }
  async close() {
    this.stopping = true;
    await this.iterator.return();
    if (this.closeFailed)
      throw new Error("Investigation handle closure failed");
  }
}
