/** Pi session files of one project: the conversation history the terminal and
 * the browser share. Pi writes them (in the terminal, or in a browser turn's
 * SDK worker); this module only reads them, incrementally, and never repairs,
 * rewrites or deletes one. Credentials are redacted from what it returns. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  decodeImageBase64,
  IMAGE_LIMITS,
  IMAGE_TYPES,
  validateImageBytes,
} from "../image-content.mjs";
import {
  BROWSER_COMMAND_ENTRY,
  CADENCE_MODE_ENTRY,
  WEBUI_SESSION_ENTRY,
} from "../session-entries.mjs";
import { sanitizeText } from "../worker-redaction.mjs";
import { withinWorkspace } from "../workspace.ts";
import { ContractError } from "./contracts/core.ts";
import type { ChatImage, WorkbenchResult } from "./contracts/workbench.ts";
import {
  type ChatItem,
  type ChatStatus,
  type ChatStep,
  type ChatTreeNode,
  type ChatTurn,
  chatStep,
  clipText,
  TREE_NODES,
} from "./contracts/workbench.ts";

/** A session larger than this is listed by name but not opened. */
export const SESSION_BYTES = 64 * 1024 * 1024;
/** Session files one listing considers, newest names first. */
const LISTED_FILES = 10_000;
/** Parsed sessions and built turns kept in memory: read caches only. */
const OPEN_SESSIONS = 8;
const BUILT_TURNS = 64;
/** Checkout session sources, not a retained-conversation quota. */
const SESSION_DIRECTORIES = 256;
const KNOWN_DIRECTORIES = 128;
/** Only the identity header is needed to list an oversized session. */
const HEADER_BYTES = 16 * 1024;
const SETTINGS_BYTES = 1024 * 1024;
const TITLE_CHARS = 100;
const NOTICE_BYTES = 1024;
/** Encoded bytes of one step-detail part: both fields fit one 512 KiB reply. */
const PART_TEXT_BYTES = 200 * 1024;
const PART_ARGS_BYTES = 48 * 1024;
/** Arguments parsed to name a tool's target; longer ones name nothing. */
const TARGET_ARGS = 1024 * 1024;

/** Where Pi keeps this project's sessions, with Pi's own precedence: the
 * PI_CODING_AGENT_SESSION_DIR environment variable, then `sessionDir` in the
 * project's or the agent directory's settings.json, then the per-directory default. */
export function sessionDirectory(
  cwd: string,
  agentDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const expand = (value: string) => {
    const home =
      value === "~"
        ? homedir()
        : value.startsWith("~/")
          ? join(homedir(), value.slice(2))
          : value;
    return isAbsolute(home) ? resolve(home) : resolve(cwd, home);
  };
  const fromEnv = env.PI_CODING_AGENT_SESSION_DIR;
  if (fromEnv) return expand(fromEnv);
  let configured: string | undefined;
  for (const file of [
    join(agentDir, "settings.json"),
    join(cwd, ".pi", "settings.json"),
  ]) {
    const value = settingsSessionDir(file);
    if (value) configured = value;
  }
  if (configured) return expand(configured);
  return join(
    agentDir,
    "sessions",
    `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`,
  );
}
function settingsSessionDir(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > SETTINGS_BYTES) return undefined;
    const buffer = Buffer.alloc(st.size);
    readSync(fd, buffer, 0, st.size, 0);
    const value: unknown = JSON.parse(buffer.toString("utf8"));
    const dir =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).sessionDir
        : undefined;
    return typeof dir === "string" && dir.trim() ? dir.trim() : undefined;
  } catch {
    // Pi ignores unreadable settings the same way.
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** One line of a session file after the header. */
export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  /** Byte offset of the line: the order in which it was appended. */
  pos: number;
  raw: Record<string, unknown>;
}
interface Header {
  id: string;
  cwd: string;
  version: number;
  timestamp: string;
}
type Line =
  | { kind: "header"; header: Header }
  | { kind: "entry"; entry: SessionEntry };
const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(o, key) ? o[key] : undefined;
function parseLine(text: string, pos: number): Line | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Pi skips a malformed line too, including a torn final one.
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const o = value as Record<string, unknown>;
  const type = own(o, "type");
  if (type === "session") {
    const id = own(o, "id"),
      cwd = own(o, "cwd"),
      version = own(o, "version"),
      timestamp = own(o, "timestamp");
    if (typeof id !== "string" || !id) return undefined;
    return {
      kind: "header",
      header: {
        id,
        cwd: typeof cwd === "string" ? cwd : "",
        version: typeof version === "number" ? version : 1,
        timestamp: typeof timestamp === "string" ? timestamp : "",
      },
    };
  }
  const id = own(o, "id"),
    parentId = own(o, "parentId"),
    timestamp = own(o, "timestamp");
  if (
    typeof type !== "string" ||
    typeof id !== "string" ||
    !id ||
    id.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(id) ||
    !(parentId === null || typeof parentId === "string")
  )
    return undefined;
  return {
    kind: "entry",
    entry: {
      type,
      id,
      parentId,
      timestamp: typeof timestamp === "string" ? timestamp : "",
      pos,
      raw: o,
    },
  };
}
interface Read {
  ino: number;
  size: number;
  mtimeMs: number;
  /** Offset after the last complete line read. */
  end: number;
}
/** A service account never adopts another account's sessions, even if a
 * configured sessionDir makes them readable (notably under uid 0). */
function assertSessionFile(st: Stats): void {
  if (
    !st.isFile() ||
    (typeof process.getuid === "function" && st.uid !== process.getuid())
  )
    throw new ContractError("forbidden");
}
/** Reads the complete lines from `from`, or from 0 when the file was replaced
 * or shortened. A final line without its newline is left for the next read. */
function readLines(
  path: string,
  from: { ino: number; end: number } | undefined,
  onLine: (text: string, pos: number) => void,
): Read & { restarted: boolean } {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    assertSessionFile(st);
    if (st.size > SESSION_BYTES) throw new ContractError("capacity");
    const restarted = !from || from.ino !== st.ino || st.size < from.end;
    const start = restarted ? 0 : from.end;
    const length = st.size - start;
    let end = start;
    if (length > 0) {
      const buffer = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) {
        const n = readSync(fd, buffer, read, length - read, start + read);
        if (n === 0) break;
        read += n;
      }
      let line = 0;
      for (let i = buffer.indexOf(10); i >= 0 && i < read; ) {
        const text = buffer.toString("utf8", line, i);
        if (text.trim()) onLine(text, start + line);
        line = i + 1;
        i = buffer.indexOf(10, line);
      }
      end = start + line;
    }
    return { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, end, restarted };
  } finally {
    closeSync(fd);
  }
}

/** Bounded identity read, independent of the transcript open ceiling. */
function sessionHeader(path: string): Header {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    assertSessionFile(st);
    const buffer = Buffer.alloc(Math.min(st.size, HEADER_BYTES));
    let read = 0;
    while (read < buffer.length) {
      const size = readSync(fd, buffer, read, buffer.length - read, read);
      if (!size) break;
      read += size;
      if (buffer.subarray(0, read).includes(10)) break;
    }
    const end = buffer.subarray(0, read).indexOf(10);
    if (end < 0 && st.size >= HEADER_BYTES) throw new ContractError("capacity");
    const line = parseLine(buffer.toString("utf8", 0, end < 0 ? read : end), 0);
    if (line?.kind !== "header") throw new ContractError("corrupt-selected");
    return line.header;
  } finally {
    closeSync(fd);
  }
}

const message = (entry: SessionEntry): Record<string, unknown> | undefined => {
  if (entry.type !== "message") return undefined;
  const m = own(entry.raw, "message");
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : undefined;
};
const role = (entry: SessionEntry): unknown => {
  const m = message(entry);
  return m ? own(m, "role") : undefined;
};
const isUser = (entry: SessionEntry) => role(entry) === "user";
function imageDescriptors(entry: SessionEntry): ChatImage[] {
  const content = message(entry)?.content;
  if (!isUser(entry) || !Array.isArray(content)) return [];
  return content
    .flatMap((b, index) =>
      b?.type === "image" &&
      IMAGE_TYPES.includes(b.mimeType) &&
      typeof b.data === "string" &&
      b.data.length > 0 &&
      b.data.length <= 4 * Math.ceil(IMAGE_LIMITS.bytes / 3) &&
      index <= 1024
        ? [{ entry: entry.id, index, mimeType: b.mimeType }]
        : [],
    )
    .slice(0, IMAGE_LIMITS.count);
}
/** Read only one supported image on the exact selected branch. Never exposes a
 * session path, remote URL, or base64 in the regular conversation projection. */
export function sessionImage(
  session: ParsedSession,
  leaf: string | null,
  entry: string,
  index: number,
  offset: number,
): WorkbenchResult {
  if (!session.contains(leaf, entry)) throw new ContractError("stale");
  const row = session.byId.get(entry);
  const descriptor =
    row && imageDescriptors(row).find((image) => image.index === index);
  if (!row || !descriptor) throw new ContractError("invalid");
  const content = message(row)?.content;
  if (!Array.isArray(content)) throw new ContractError("invalid");
  const block = content[index] as { data: string };
  return imagePart(block.data, descriptor.mimeType, offset);
}
/** Same bounded bytes for a retained Pi image and a not-yet-flushed live input. */
export function imagePart(
  encoded: string,
  mimeType: string,
  offset: number,
): WorkbenchResult {
  try {
    validateImageBytes(decodeImageBase64(encoded), mimeType);
  } catch {
    throw new ContractError("corrupt-selected");
  }
  if (
    offset < 0 ||
    offset >= encoded.length ||
    offset % IMAGE_LIMITS.chunkChars
  )
    throw new ContractError("invalid");
  const data = encoded.slice(offset, offset + IMAGE_LIMITS.chunkChars);
  return {
    kind: "conversation-image",
    mimeType,
    data,
    next: offset + data.length < encoded.length ? offset + data.length : null,
  };
}

function contentText(content: unknown, omitted?: ChatTurn["omitted"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b =
      block && typeof block === "object"
        ? (block as Record<string, unknown>)
        : {};
    const kind = own(b, "type");
    const value = own(b, "text");
    if (kind === "text" && typeof value === "string") parts.push(value);
    else if (omitted && kind === "image") omitted.media = true;
    else if (omitted) omitted.other = true;
  }
  return parts.join("\n");
}
const firstLine = (value: string) =>
  [...(value.trim().split("\n", 1)[0] ?? "")].slice(0, TITLE_CHARS).join("");
const time = (value: string) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};
/** Status from an assistant message's stop reason, as Pi records it. */
function stopStatus(m: Record<string, unknown>): {
  status: ChatStatus;
  notice: string;
} {
  const reason = own(m, "stopReason");
  if (reason === "error") {
    const error = own(m, "errorMessage");
    return {
      status: "failed",
      notice: typeof error === "string" ? error : "The model request failed.",
    };
  }
  if (reason === "aborted") return { status: "canceled", notice: "" };
  return { status: "completed", notice: "" };
}

/** What a listing needs, folded line by line so a long session is read once. */
export interface SessionSummary {
  id: string;
  cwd: string;
  version: number;
  created: number;
  name: string | null;
  firstUser: string | null;
  /** The last appended entry: Pi's current leaf when it opens the file. */
  leaf: string | null;
  webui: boolean;
  /** Workflows the terminal recorded in this session, oldest first. */
  runs: string[];
  /** Native Cadence mode as last recorded. */
  cadence: boolean;
  stop: { status: ChatStatus; notice: string } | null;
}
function emptySummary(): SessionSummary {
  return {
    id: "",
    cwd: "",
    version: 0,
    created: 0,
    name: null,
    firstUser: null,
    leaf: null,
    webui: false,
    runs: [],
    cadence: false,
    stop: null,
  };
}
function fold(summary: SessionSummary, line: Line): void {
  if (line.kind === "header") {
    summary.id = line.header.id;
    summary.cwd = line.header.cwd;
    summary.version = line.header.version;
    summary.created = time(line.header.timestamp);
    return;
  }
  const entry = line.entry;
  summary.leaf = entry.id;
  if (entry.type === "session_info") {
    const name = own(entry.raw, "name");
    summary.name = typeof name === "string" && name.trim() ? name : null;
  } else if (entry.type === "custom") {
    const kind = own(entry.raw, "customType");
    if (kind === WEBUI_SESSION_ENTRY) summary.webui = true;
    if (kind === CADENCE_MODE_ENTRY) {
      const data = own(entry.raw, "data");
      const d =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {};
      const runId = own(d, "runId");
      summary.cadence = own(d, "enabled") === true;
      if (
        typeof runId === "string" &&
        /^[0-9a-f-]{36}$/.test(runId) &&
        !summary.runs.includes(runId) &&
        summary.runs.length < 200
      )
        summary.runs.push(runId);
    }
  } else {
    const m = message(entry);
    if (m && own(m, "role") === "user" && summary.firstUser === null) {
      const text = firstLine(contentText(own(m, "content")));
      if (text) summary.firstUser = text;
    }
    if (m && own(m, "role") === "assistant") summary.stop = stopStatus(m);
  }
}

/** A whole session in memory, extended as Pi appends to it. */
export class ParsedSession {
  readonly entries: SessionEntry[] = [];
  readonly byId = new Map<string, SessionEntry>();
  readonly children = new Map<string, SessionEntry[]>();
  header: Header | null = null;
  read: Read | undefined;
  constructor(readonly path: string) {}
  refresh(): this {
    const lines: Line[] = [];
    const next = readLines(this.path, this.read, (text, pos) => {
      const line = parseLine(text, pos);
      if (line) lines.push(line);
    });
    if (next.restarted) {
      this.entries.length = 0;
      this.byId.clear();
      this.children.clear();
      this.header = null;
    }
    for (const line of lines) {
      if (line.kind === "header") {
        this.header ??= line.header;
        continue;
      }
      const entry = line.entry;
      // Pi never reuses an id; a duplicate line is ignored rather than trusted.
      if (this.byId.has(entry.id)) continue;
      this.entries.push(entry);
      this.byId.set(entry.id, entry);
      const key = entry.parentId ?? "";
      const siblings = this.children.get(key);
      if (siblings) siblings.push(entry);
      else this.children.set(key, [entry]);
    }
    this.read = next;
    return this;
  }
  /** Pi's current leaf: the entry appended last. */
  current(): string | null {
    return this.entries.at(-1)?.id ?? null;
  }
  /** Root-to-leaf entries of one branch. */
  branch(leaf: string | null): SessionEntry[] {
    const out: SessionEntry[] = [];
    let entry = leaf === null ? undefined : this.byId.get(leaf);
    if (leaf !== null && !entry) throw new ContractError("stale");
    for (let n = 0; entry && n <= this.entries.length; n++) {
      out.push(entry);
      entry =
        entry.parentId === null ? undefined : this.byId.get(entry.parentId);
    }
    return out.reverse();
  }
  /** Whether `ancestor` is on the branch that ends at `leaf`. */
  contains(leaf: string | null, ancestor: string): boolean {
    let entry = leaf === null ? undefined : this.byId.get(leaf);
    for (let n = 0; entry && n <= this.entries.length; n++) {
      if (entry.id === ancestor) return true;
      entry =
        entry.parentId === null ? undefined : this.byId.get(entry.parentId);
    }
    return false;
  }
  /** Entries nothing continues from: more than one means the session branched. */
  leaves(): number {
    let count = 0;
    for (const entry of this.entries) if (!this.children.has(entry.id)) count++;
    return count;
  }
  /** Exact browser ownership, recorded by the worker through Pi's public
   * manager after each finalized message. Equal text is never identity. */
  commandEntries(
    commandId: string,
    parent: string | null,
    offset: number,
  ): SessionEntry[] {
    const markers = this.entries.filter(
      (entry) =>
        entry.type === "custom" &&
        entry.raw.customType === BROWSER_COMMAND_ENTRY &&
        (entry.raw.data as Record<string, unknown> | undefined)?.commandId ===
          commandId,
    );
    if (!markers.length) return [];
    const marker = markers[0],
      data = marker.raw.data as Record<string, unknown>;
    const user =
      typeof data.userId === "string" ? this.byId.get(data.userId) : undefined;
    if (
      !user ||
      !isUser(user) ||
      marker.parentId !== user.id ||
      user.pos < offset ||
      marker.pos <= user.pos
    )
      throw new ContractError("corrupt-selected");
    let entry: SessionEntry | undefined = user;
    let reaches = false;
    for (
      let n = 0;
      entry && n <= this.entries.length && entry.pos >= offset;
      n++
    ) {
      if (entry.parentId === parent) {
        reaches = true;
        break;
      }
      entry =
        entry.parentId === null ? undefined : this.byId.get(entry.parentId);
    }
    if (!reaches) throw new ContractError("stale");
    const branch = this.branch(markers[markers.length - 1].id);
    const start = branch.findIndex((entry) => entry.id === user.id);
    const entries = new Set(branch.slice(start).map((entry) => entry.id));
    if (
      start < 0 ||
      markers.some(
        (boundary) =>
          !entries.has(boundary.id) ||
          (boundary.raw.data as Record<string, unknown>).userId !== user.id,
      )
    )
      throw new ContractError("corrupt-selected");
    return branch.slice(start);
  }

  /** User messages as a tree, each naming the newest entry below it and
   * whether it is on the branch that ends at `leaf`. */
  tree(
    leaf: string | null,
    secrets: readonly string[],
  ): {
    nodes: ChatTreeNode[];
    truncated: boolean;
  } {
    // Newest first: the first descendant to reach an ancestor is its newest.
    const newest = new Map<string, SessionEntry>();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      let entry: SessionEntry | undefined = this.entries[i];
      const leaf = entry;
      for (let n = 0; entry && !newest.has(entry.id) && n <= i; n++) {
        newest.set(entry.id, leaf);
        entry =
          entry.parentId === null ? undefined : this.byId.get(entry.parentId);
      }
    }
    const onBranch = new Set(this.branch(leaf).map((entry) => entry.id));
    const users = this.entries.filter(isUser);
    const kept = users.slice(-TREE_NODES);
    const keep = new Set(kept.map((entry) => entry.id));
    const nodes = kept.map((entry) => {
      let parent: SessionEntry | undefined =
        entry.parentId === null ? undefined : this.byId.get(entry.parentId);
      for (
        let n = 0;
        parent && !keep.has(parent.id) && n <= this.entries.length;
        n++
      )
        parent =
          parent.parentId === null ? undefined : this.byId.get(parent.parentId);
      const m = message(entry) ?? {};
      return {
        id: entry.id,
        parent: parent?.id ?? null,
        text: clipText(
          sanitizeText(firstLine(contentText(own(m, "content"))), secrets),
          512,
        ),
        at: time(entry.timestamp),
        leaf: (newest.get(entry.id) ?? entry).id,
        current: onBranch.has(entry.id),
      };
    });
    return { nodes, truncated: kept.length < users.length };
  }
}

/** A branch split into turns: each starts at a user message. Entries before
 * the first user message form a turn of their own only when one is shown. */
export function turnSpans(path: SessionEntry[]): SessionEntry[][] {
  const turns: SessionEntry[][] = [];
  for (const entry of path) {
    if (isUser(entry) || !turns.length) turns.push([entry]);
    else turns[turns.length - 1].push(entry);
  }
  if (turns.length && !isUser(turns[0][0]) && !turns[0].some(shown))
    turns.shift();
  return turns;
}
function shown(entry: SessionEntry): boolean {
  if (entry.type === "message")
    return ["user", "assistant", "toolResult", "bashExecution"].includes(
      role(entry) as string,
    );
  if (entry.type === "custom_message")
    return own(entry.raw, "display") === true;
  return entry.type === "compaction" || entry.type === "branch_summary";
}

/** One turn as listed steps, with every item redacted and split into the parts
 * a step-detail read returns. */
export interface BuiltTurn {
  id: string;
  entry: string | null;
  at: number;
  status: ChatStatus;
  notice: string;
  omitted: ChatTurn["omitted"];
  items: ChatItem[];
  steps: ChatStep[];
  parts: ChatItem[][];
}
const clip = (value: string, bytes: number) => clipText(value, bytes);
/** Pi's entries of one turn as chat items: user and assistant text, tool calls
 * paired with their results, terminal `!` commands, summaries and extension
 * messages shown in the terminal. Thinking and images are flagged, not shown. */
export function turnItems(
  entries: SessionEntry[],
  secrets: readonly string[],
): Omit<BuiltTurn, "steps" | "parts"> {
  const omitted = { thinking: false, media: false, other: false };
  const items: ChatItem[] = [];
  const tools = new Map<string, ChatItem>();
  let status: ChatStatus = "completed",
    notice = "";
  const add = (item: ChatItem) => {
    items.push({
      ...item,
      id: clip(item.id, 160) || "item",
      name: clip(sanitizeText(item.name, secrets), 128),
      text: sanitizeText(item.text, secrets),
      args: sanitizeText(item.args, secrets),
    });
    return items[items.length - 1];
  };
  const tool = (
    id: string,
    name: string,
    args: string,
    text = "",
    error = false,
  ) => add({ id, role: "tool", name, args, text, error });
  for (const entry of entries) {
    const m = message(entry);
    if (m) {
      const kind = own(m, "role");
      if (kind === "user") {
        const images = imageDescriptors(entry);
        const content = own(m, "content");
        const flags = { thinking: false, media: false, other: false };
        const text = contentText(content, flags);
        omitted.other ||= flags.other;
        omitted.media ||=
          flags.media &&
          (!Array.isArray(content) ||
            content.filter((b) => b?.type === "image").length > images.length);
        add({
          ...(images.length ? { images } : {}),
          id: entry.id,
          role: "user",
          text,
          name: "",
          args: "",
          error: false,
        });
      } else if (kind === "assistant") {
        let text: ChatItem | undefined;
        const content = own(m, "content");
        for (const block of Array.isArray(content) ? content : []) {
          const b =
            block && typeof block === "object"
              ? (block as Record<string, unknown>)
              : {};
          const type = own(b, "type");
          if (type === "text" && typeof own(b, "text") === "string") {
            const value = own(b, "text") as string;
            if (text && items[items.length - 1] === text)
              text.text += sanitizeText(`\n\n${value}`, secrets);
            else
              text = add({
                id: `${entry.id}:${items.length}`,
                role: "assistant",
                text: value,
                name: "",
                args: "",
                error: false,
              });
          } else if (type === "toolCall") {
            const id = own(b, "id"),
              name = own(b, "name");
            let args = "";
            try {
              args = JSON.stringify(own(b, "arguments") ?? {}) ?? "";
            } catch {
              omitted.other = true;
            }
            const call = tool(
              typeof id === "string" && id ? id : `${entry.id}:${items.length}`,
              typeof name === "string" ? name : "tool",
              args,
            );
            if (typeof id === "string") tools.set(id, call);
          } else if (type === "thinking" || type === "redactedThinking")
            omitted.thinking = true;
          else if (type === "image") omitted.media = true;
          else omitted.other = true;
        }
        ({ status, notice } = stopStatus(m));
      } else if (kind === "toolResult") {
        const id = own(m, "toolCallId"),
          name = own(m, "toolName");
        const output = sanitizeText(
          contentText(own(m, "content"), omitted),
          secrets,
        );
        const call = typeof id === "string" ? tools.get(id) : undefined;
        if (call) {
          call.text = output;
          call.error = own(m, "isError") === true;
        } else
          tool(
            typeof id === "string" && id ? id : entry.id,
            typeof name === "string" ? name : "tool",
            "",
            output,
            own(m, "isError") === true,
          );
      } else if (kind === "bashExecution") {
        const command = own(m, "command"),
          output = own(m, "output"),
          code = own(m, "exitCode");
        tool(
          entry.id,
          "bash",
          JSON.stringify({
            command: typeof command === "string" ? command : "",
          }),
          typeof output === "string" ? output : "",
          own(m, "cancelled") === true ||
            (typeof code === "number" && code !== 0),
        );
      }
    } else if (
      entry.type === "custom_message" &&
      own(entry.raw, "display") === true
    ) {
      const kind = own(entry.raw, "customType");
      tool(
        entry.id,
        typeof kind === "string" ? kind : "message",
        "",
        contentText(own(entry.raw, "content"), omitted),
      );
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      const summary = own(entry.raw, "summary");
      tool(
        entry.id,
        entry.type === "compaction" ? "compaction" : "branch-summary",
        "",
        typeof summary === "string" ? summary : "",
      );
    }
  }
  const first = entries.find(isUser) ?? entries[0];
  return {
    id: first?.id ?? "",
    entry: entries.at(-1)?.id ?? null,
    at: first ? time(first.timestamp) : 0,
    status,
    notice: clip(sanitizeText(notice, secrets), NOTICE_BYTES),
    omitted,
    items,
  };
}
/** Exact UTF-8 bytes of a string's JSON encoding, one code unit at a time. */
function encodedChunks(value: string, bytes: number): string[] {
  const chunks: string[] = [];
  let start = 0,
    size = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < value.length;
    const unit =
      c === 0x22 || c === 0x5c
        ? 2
        : c < 0x20
          ? [8, 9, 10, 12, 13].includes(c)
            ? 2
            : 6
          : c < 0x80
            ? 1
            : c < 0x800
              ? 2
              : pair
                ? 4
                : c >= 0xd800 && c <= 0xdfff
                  ? 6
                  : 3;
    if (size + unit > bytes && i > start) {
      chunks.push(value.slice(start, i));
      start = i;
      size = 2;
    }
    size += unit;
    if (pair) i++;
  }
  if (start < value.length) chunks.push(value.slice(start));
  return chunks;
}
/** The parts one item's step-detail reads return, in order. */
export function itemParts(item: ChatItem): ChatItem[] {
  const text = encodedChunks(item.text, PART_TEXT_BYTES),
    args = encodedChunks(item.args, PART_ARGS_BYTES);
  const count = Math.max(text.length, args.length, 1);
  return Array.from({ length: count }, (_, i) => ({
    ...item,
    text: text[i] ?? "",
    args: args[i] ?? "",
  }));
}
/** A built turn's listed steps and detail parts. `live` items may still change. */
export function listTurn(turn: Omit<BuiltTurn, "steps" | "parts">): BuiltTurn {
  const parts = turn.items.map(itemParts);
  const steps = turn.items.map((item, index) => {
    const listed = chatStep(
      item.role === "tool" && item.args.length > TARGET_ARGS
        ? { ...item, args: "" }
        : item,
      0,
    );
    const more =
      listed.clipped || (item.role === "tool" && !!(item.args || item.text));
    return { ...listed, parts: more ? parts[index].length : 0 };
  });
  return { ...turn, steps, parts };
}

interface Listed {
  path: string;
  ino: number;
  size: number;
  mtimeMs: number;
  end: number;
  summary: SessionSummary;
}
/** The project's sessions as Pi stores them, listed and opened on demand. */
export class PiSessions {
  private readonly listed = new Map<string, Listed>();
  private readonly open = new Map<string, ParsedSession>();
  private readonly built = new Map<string, BuiltTurn>();
  private incomplete: ContractError | undefined;
  constructor(
    readonly directory: string,
    private readonly cwd: string,
    private readonly project?: {
      defaultCwd: string;
      agentDir: string;
      sessionDir?: string;
    },
  ) {}
  private readonly directories = new Map<string, string>();
  directoryFor(cwd: string): string {
    if (!this.project) {
      if (cwd !== this.cwd) throw new ContractError("stale");
      return this.directory;
    }
    if (resolve(cwd) !== cwd || !withinWorkspace(this.cwd, cwd))
      throw new ContractError("forbidden");
    const path =
      this.project.sessionDir ?? sessionDirectory(cwd, this.project.agentDir);
    this.directories.delete(cwd);
    this.directories.set(cwd, path);
    if (this.directories.size > KNOWN_DIRECTORIES)
      this.directories.delete(this.directories.keys().next().value as string);
    return path;
  }
  private includes(cwd: string): boolean {
    return this.project
      ? resolve(cwd) === cwd && withinWorkspace(this.cwd, cwd)
      : cwd === this.cwd;
  }
  private roots(): string[] {
    const paths = new Set([this.directory]);
    if (this.project) {
      paths.add(this.directoryFor(this.project.defaultCwd));
      for (const path of this.directories.values()) paths.add(path);
      // Discover Pi's normal per-directory groups, never the checkout tree or
      // another account. Header cwd, not the flattened name, proves membership.
      const home = join(this.project.agentDir, "sessions");
      const prefix = `--${this.cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}`;
      try {
        for (const entry of readdirSync(home, { withFileTypes: true }))
          if (entry.isDirectory() && entry.name.startsWith(`${prefix}-`))
            paths.add(join(home, entry.name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new ContractError("unavailable");
      }
    }
    if (paths.size > SESSION_DIRECTORIES) throw new ContractError("capacity");
    return [...paths];
  }
  close(): void {
    this.listed.clear();
    this.open.clear();
    this.built.clear();
    this.directories.clear();
    this.incomplete = undefined;
  }
  /** Every session of this project, most recently written first. Unreadable
   * files are left out of the listing, never changed. */
  list(): Listed[] {
    this.incomplete = undefined;
    const names: string[] = [];
    const seenDirectories = new Set<string>();
    for (const directory of this.roots()) {
      try {
        if (
          !lstatSync(directory).isDirectory() ||
          lstatSync(directory).isSymbolicLink()
        )
          throw new ContractError("forbidden");
        // A configured parent alias and Pi's default group can name the same
        // directory. They are one source, not conflicting session identities.
        const canonical = realpathSync(directory);
        if (seenDirectories.has(canonical)) continue;
        seenDirectories.add(canonical);
        for (const d of readdirSync(canonical, { withFileTypes: true }))
          if (d.isFile() && d.name.endsWith(".jsonl"))
            names.push(join(canonical, d.name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new ContractError("unavailable");
      }
    }
    names.sort((a, b) => basename(b).localeCompare(basename(a)));
    names.splice(LISTED_FILES);
    const seen = new Set<string>();
    const out: Listed[] = [];
    for (const path of names) {
      seen.add(path);
      try {
        const listed = this.summary(path);
        if (this.includes(listed.summary.cwd) && listed.summary.version >= 3)
          out.push(listed);
      } catch (error) {
        this.listed.delete(path);
        this.incomplete =
          error instanceof ContractError
            ? error
            : new ContractError("unavailable");
      }
    }
    for (const path of this.listed.keys())
      if (!seen.has(path)) this.listed.delete(path);
    // A session ID is the cross-surface conversation identity. Multiple files
    // must not make a selected directory silently choose another transcript.
    if (new Set(out.map((row) => row.summary.id)).size !== out.length)
      throw new ContractError("conflict");
    return out.sort(
      (a, b) => b.mtimeMs - a.mtimeMs || (a.summary.id < b.summary.id ? -1 : 1),
    );
  }
  private summary(path: string): Listed {
    const st = lstatSync(path);
    assertSessionFile(st);
    const cached = this.listed.get(path);
    if (st.size > SESSION_BYTES) {
      // A later readable replacement must not revive an old parsed/body cache.
      this.open.delete(path);
      for (const key of this.built.keys())
        if (key.startsWith(`${path}|`)) this.built.delete(key);
      const summary = emptySummary();
      fold(summary, { kind: "header", header: sessionHeader(path) });
      const listed = {
        path,
        ino: st.ino,
        size: st.size,
        mtimeMs: st.mtimeMs,
        end: 0,
        summary,
      };
      this.listed.set(path, listed);
      return listed;
    }
    if (cached && cached.ino === st.ino && cached.size === st.size) {
      cached.mtimeMs = st.mtimeMs;
      return cached;
    }
    const prior = cached && cached.size <= SESSION_BYTES ? cached : undefined;
    let summary =
      prior && prior.ino === st.ino && st.size >= prior.end
        ? { ...prior.summary, runs: [...prior.summary.runs] }
        : emptySummary();
    const lines: Line[] = [];
    const read = readLines(path, prior, (text, pos) => {
      const line = parseLine(text, pos);
      if (line) lines.push(line);
    });
    if (read.restarted) summary = emptySummary();
    for (const line of lines) {
      if (line.kind === "header" && summary.id)
        throw new ContractError("corrupt-selected");
      fold(summary, line);
    }
    if (!summary.id) throw new ContractError("corrupt-selected");
    const listed = { path, ...read, summary };
    this.listed.set(path, listed);
    return listed;
  }
  /** The listed session with this id, if Pi has written it. */
  find(id: string): Listed | undefined {
    const candidates = () =>
      [...this.listed.values()].filter(
        (listed) =>
          listed.summary.id === id && this.includes(listed.summary.cwd),
      );
    let matches = candidates();
    if (matches.length !== 1) {
      this.list();
      matches = candidates();
    }
    if (matches.length > 1) throw new ContractError("conflict");
    const known = matches[0];
    if (!known) {
      // An unidentifiable file might hold this ID. Neither unreadability nor
      // an unsupported format can authorize a new same-ID file.
      if (this.incomplete) throw this.incomplete;
      return undefined;
    }
    // Failed revalidation of a known identity is never treated as absence.
    const listed = this.summary(known.path);
    if (listed.summary.id !== id || !this.includes(listed.summary.cwd))
      throw new ContractError("stale");
    if (listed.summary.version < 3) {
      this.listed.delete(listed.path); // Re-observe a possible external upgrade.
      throw new ContractError("unsupported-context");
    }
    return listed;
  }

  /** The parsed session, brought up to date with what Pi has appended. */
  session(id: string): ParsedSession | undefined {
    const listed = this.find(id);
    if (!listed) return undefined;
    let parsed = this.open.get(listed.path);
    this.open.delete(listed.path);
    parsed ??= new ParsedSession(listed.path);
    parsed.refresh();
    if (parsed.header?.id !== id) throw new ContractError("corrupt-selected");
    this.open.set(listed.path, parsed);
    if (this.open.size > OPEN_SESSIONS)
      this.open.delete(this.open.keys().next().value as string);
    return parsed;
  }
  /** One turn of a settled branch, built once per content and secret set. */
  turn(
    session: ParsedSession,
    entries: SessionEntry[],
    secrets: readonly string[],
  ): BuiltTurn {
    const key = [
      session.path,
      entries[0]?.id,
      entries.at(-1)?.id,
      entries.length,
      createHash("sha256").update(secrets.join("\0")).digest("hex"),
    ].join("|");
    const hit = this.built.get(key);
    this.built.delete(key);
    const turn = hit ?? listTurn(turnItems(entries, secrets));
    this.built.set(key, turn);
    if (this.built.size > BUILT_TURNS)
      this.built.delete(this.built.keys().next().value as string);
    return turn;
  }
  /** Run ids recorded by the terminal, by session. */
  nativeRuns(): Map<string, string> {
    const out = new Map<string, string>();
    for (const listed of this.list())
      for (const run of listed.summary.runs)
        if (!out.has(run)) out.set(run, listed.summary.id);
    return out;
  }
}
export function summaryTitle(summary: SessionSummary): string {
  return summary.name ?? summary.firstUser ?? "Conversation";
}

/** Same reader/cache for live and cold views; constructing it never writes or imports the SDK. */
export function checkoutSessions(
  root: string,
  cwd: string,
  agentDir: string,
  sessionDir?: string,
): PiSessions {
  return new PiSessions(sessionDir ?? sessionDirectory(cwd, agentDir), root, {
    defaultCwd: cwd,
    agentDir,
    sessionDir,
  });
}
