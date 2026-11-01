/** What self-healing did, and where it moved damaged bytes. Damaged private state
 * is archived (never silently deleted) and the archive expires on its own. */
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  opendirSync,
  renameSync,
  rmSync,
  type Stats,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { retryWindowsFileOperation } from "../workspace.ts";
import {
  ContractError,
  closed,
  decodeId,
  integer,
  list,
  literal,
  oneOf,
  text,
} from "./contracts/core.ts";
import {
  RECOVERY_ACTIONS,
  RECOVERY_CAUSES,
  RECOVERY_SCOPES,
  type RecoveryNotice,
} from "./contracts/gateway.ts";
import { encoded, json, type PrivateFiles } from "./private-files.ts";

export { RECOVERY_ACTIONS, RECOVERY_CAUSES, RECOVERY_SCOPES };
/** Notices shown in the WebUI cover this long. */
export const RECOVERY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/** Newest events kept; older ones are removed when a new one is written. */
export const RECOVERY_EVENTS = 50;
/** Archived damaged state expires after this long... */
export const RECOVERY_ARCHIVE_MS = 30 * 24 * 60 * 60 * 1000;
/** ...or sooner, oldest first, once the archive exceeds this size. */
export const RECOVERY_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const EVENT_BYTES = 16 * 1024;
/** Steps of one recovery (CLI heal, then the new owner's history) share an event. */
const RECOVERY_MERGE_MS = 2 * 60 * 1000;

export interface RecoveryEvent {
  schema: "cadence-recovery-event/1";
  id: string;
  at: number;
  scope: (typeof RECOVERY_SCOPES)[number];
  /** Project root for a project, otherwise null. */
  path: string | null;
  cause: (typeof RECOVERY_CAUSES)[number];
  actions: (typeof RECOVERY_ACTIONS)[number][];
  /** Leftover worker processes that were stopped. */
  workers: number;
  /** Archive entry name under recovery-archive-v1, when bytes were kept. */
  archive: string | null;
}
export function decodeRecoveryEvent(value: unknown): RecoveryEvent {
  const o = closed(value, [
    "schema",
    "id",
    "at",
    "scope",
    "path",
    "cause",
    "actions",
    "workers",
    "archive",
  ]);
  const archive = o.archive === null ? null : text(o.archive, 128, true);
  if (archive !== null && !/^[0-9]{13}-[0-9a-f-]{36}$/.test(archive))
    throw new ContractError("corrupt-selected");
  return {
    schema: literal(o.schema, "cadence-recovery-event/1"),
    id: decodeId(o.id),
    at: integer(o.at, 0),
    scope: oneOf(o.scope, RECOVERY_SCOPES),
    path: o.path === null ? null : text(o.path, 4096, true),
    cause: oneOf(o.cause, RECOVERY_CAUSES),
    actions: list(o.actions, RECOVERY_ACTIONS.length, (a) =>
      oneOf(a, RECOVERY_ACTIONS),
    ),
    workers: integer(o.workers, 0, 1_000_000),
    archive,
  };
}
function entries(path: string, maximum = 4096): string[] {
  const out: string[] = [];
  let dir: ReturnType<typeof opendirSync>;
  try {
    dir = opendirSync(path);
  } catch {
    return out;
  }
  try {
    for (let e = dir.readSync(); e && out.length < maximum; e = dir.readSync())
      out.push(e.name);
  } finally {
    dir.closeSync();
  }
  return out.sort();
}
/** Bounded recursive size, counting at most `limit` entries. */
function size(path: string, limit = { left: 100_000 }): number {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return 0;
  }
  if (--limit.left < 0) return st.size;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const name of entries(path, 100_000))
    total += size(join(path, name), limit);
  return total;
}

/** Account-wide log and archive under `<state-home>/cadence-assistant-v1`. */
export class RecoveryLog {
  readonly logDirectory: string;
  readonly archiveDirectory: string;
  constructor(readonly files: PrivateFiles) {
    this.logDirectory = join(files.namespace, "recovery-log-v1");
    this.archiveDirectory = join(files.namespace, "recovery-archive-v1");
  }
  /** A new archive entry; `keep` moves files or directories into it. */
  archive(): {
    name: string;
    keep(path: string, as?: string): void;
    used(): boolean;
  } {
    const name = `${Date.now()}-${randomUUID()}`;
    const directory = join(this.archiveDirectory, name);
    let used = false;
    return {
      name,
      keep: (path: string, as?: string) => {
        // Only Cadence's own private state can be archived.
        const rel = relative(this.files.namespace, path);
        if (!rel || rel.startsWith("..")) throw new ContractError("forbidden");
        this.files.directory(directory, true);
        const target = join(directory, as ?? rel.split(/[\\/]/).join("--"));
        retryWindowsFileOperation(() => renameSync(path, target));
        used = true;
      },
      used: () => used,
    };
  }
  /** One event per recovery: a later step of the same recovery (the new
   * owner continuing its history) is merged into the event just written. */
  record(event: Omit<RecoveryEvent, "schema" | "id" | "at">): RecoveryEvent {
    try {
      const latest = this.latestFile();
      if (
        latest &&
        latest.value.scope === event.scope &&
        latest.value.path === event.path &&
        Date.now() - latest.value.at < RECOVERY_MERGE_MS
      ) {
        const merged: RecoveryEvent = {
          ...latest.value,
          actions: [...new Set([...latest.value.actions, ...event.actions])],
          workers: latest.value.workers + event.workers,
          archive: latest.value.archive ?? event.archive,
        };
        this.files.replace(
          latest.path,
          latest.snapshot,
          encoded(decodeRecoveryEvent(merged)),
          EVENT_BYTES,
        );
        return merged;
      }
    } catch {
      /* write a separate event below */
    }
    const value: RecoveryEvent = {
      schema: "cadence-recovery-event/1",
      id: randomUUID(),
      at: Date.now(),
      ...event,
    };
    decodeRecoveryEvent(value);
    try {
      this.files.create(
        join(this.logDirectory, `${value.at}-${value.id}.json`),
        encoded(value),
        EVENT_BYTES,
      );
      this.prune();
    } catch {
      // The log is informational; a full disk must not undo a completed heal.
    }
    return value;
  }
  private latestFile() {
    for (const name of entries(this.logDirectory).reverse()) {
      if (!/^[0-9]{13}-[0-9a-f-]{36}\.json$/.test(name)) continue;
      const path = join(this.logDirectory, name);
      const snapshot = this.files.read(path, EVENT_BYTES);
      if (!snapshot) return undefined;
      return {
        path,
        snapshot,
        value: decodeRecoveryEvent(json(snapshot, EVENT_BYTES)),
      };
    }
    return undefined;
  }
  /** Newest first. Unreadable entries are skipped, never repaired here. */
  events(limit = 20): RecoveryEvent[] {
    const out: RecoveryEvent[] = [];
    for (const name of entries(this.logDirectory).reverse()) {
      if (out.length >= limit) break;
      if (!/^[0-9]{13}-[0-9a-f-]{36}\.json$/.test(name)) continue;
      try {
        const file = this.files.read(
          join(this.logDirectory, name),
          EVENT_BYTES,
        );
        if (file) out.push(decodeRecoveryEvent(json(file, EVENT_BYTES)));
      } catch {
        /* skipped */
      }
    }
    return out;
  }
  /** Expire old events and archive entries; never touches anything else. */
  prune(now = Date.now()): void {
    const names = entries(this.logDirectory);
    for (const name of names.slice(
      0,
      Math.max(0, names.length - RECOVERY_EVENTS),
    ))
      rmSync(join(this.logDirectory, name), { force: true });
    const archived = entries(this.archiveDirectory).filter((name) =>
      /^[0-9]{13}-[0-9a-f-]{36}$/.test(name),
    );
    const kept: { name: string; bytes: number }[] = [];
    for (const name of archived) {
      const path = join(this.archiveDirectory, name);
      if (now - Number(name.slice(0, 13)) > RECOVERY_ARCHIVE_MS)
        rmSync(path, { recursive: true, force: true });
      else kept.push({ name, bytes: size(path) });
    }
    let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of kept) {
      if (total <= RECOVERY_ARCHIVE_BYTES) break;
      rmSync(join(this.archiveDirectory, entry.name), {
        recursive: true,
        force: true,
      });
      total -= entry.bytes;
    }
  }
  /** The WebUI's view: recent events without archive locations. */
  notices(limit = 10, now = Date.now()): RecoveryNotice[] {
    return this.events(limit)
      .filter((e) => now - e.at < RECOVERY_NOTICE_MS)
      .map((e) => ({
        id: e.id,
        at: e.at,
        scope: e.scope,
        path: e.path,
        cause: e.cause,
        actions: e.actions,
        workers: e.workers,
        archived: e.archive !== null,
      }));
  }
  usage(): { entries: number; bytes: number } {
    const names = entries(this.archiveDirectory);
    return {
      entries: names.length,
      bytes: names.reduce(
        (sum, name) => sum + size(join(this.archiveDirectory, name)),
        0,
      ),
    };
  }
}
/** Interrupted temporaries a crash left beside atomically replaced files. */
export function strayTemporaries(directory: string): string[] {
  return entries(directory)
    .filter((name) => /^pending-[0-9a-f-]{36}\.json$/.test(name))
    .map((name) => join(directory, name));
}
export function archiveLabel(path: string): string {
  return basename(path);
}
