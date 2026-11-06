/** Short-lived, single-writer Pi activity metadata. Readers never repair or delete. */
import { randomUUID } from "node:crypto";
import { opendirSync, renameSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { canonicalAmbientRoot, defaultStateHome } from "../workspace.ts";
import {
  closed,
  decodeHash,
  decodeId,
  integer,
  literal,
  text,
} from "./contracts/core.ts";
import { decodeSessionId } from "./contracts/models.ts";
import { holderState, type ProcessMark } from "./liveness.ts";
import {
  encoded,
  type FileSnapshot,
  hash,
  json,
  PrivateFiles,
} from "./private-files.ts";

export const ACTIVITY_RENEW_MS = 5000;
export const ACTIVITY_FRESH_MS = 15000;
/** Lost observations leave the activity area after two minutes, never as success. */
export const ACTIVITY_RETAIN_MS = 120000;
/** Per configuration/host scan and response bound; overflow is explicitly partial. */
export const ACTIVITY_FILES = 256;
export interface NativeActivity {
  schema: "cadence-pi-activity/1";
  instance: string;
  activity: string;
  scope: string;
  sessionScope: string;
  process: ProcessMark;
  cwd: string;
  sessionId: string;
  leaf: string | null;
  startedAt: number;
  renewedAt: number;
}
export function decodeNativeActivity(value: unknown): NativeActivity {
  const o = closed(value, [
    "schema",
    "instance",
    "activity",
    "scope",
    "sessionScope",
    "process",
    "cwd",
    "sessionId",
    "leaf",
    "startedAt",
    "renewedAt",
  ]);
  const p = closed(o.process, ["pid", "host", "boot", "started"]);
  return {
    schema: literal(o.schema, "cadence-pi-activity/1"),
    instance: decodeId(o.instance),
    activity: decodeId(o.activity),
    scope: decodeHash(o.scope),
    sessionScope: decodeHash(o.sessionScope),
    process: {
      pid: integer(p.pid, 1, 2147483647),
      host: text(p.host, 255, true),
      boot: p.boot === null ? null : text(p.boot, 128, true),
      started: p.started === null ? null : text(p.started, 128, true),
    },
    cwd: text(o.cwd, 4096, true),
    sessionId: decodeSessionId(o.sessionId),
    leaf: o.leaf === null ? null : text(o.leaf, 128, true),
    startedAt: integer(o.startedAt, 0),
    renewedAt: integer(o.renewedAt, 0),
  };
}
export const activityScope = (agentDir: string) =>
  hash(canonicalAmbientRoot(agentDir));
/** Bind the existing reader's configuration without exposing any source path. */
export const activityReaderScope = (agentDir: string, sessionDir?: string) =>
  hash(
    encoded([
      canonicalAmbientRoot(agentDir),
      process.env.PI_CODING_AGENT_SESSION_DIR ?? null,
      sessionDir ?? null,
    ]),
  );
export class ActivityFiles {
  readonly files: PrivateFiles;
  readonly directory: string;
  readonly scope: string;
  constructor(agentDir: string, stateHome = defaultStateHome()) {
    this.files = new PrivateFiles(
      join(canonicalAmbientRoot(stateHome), "cadence-assistant-v1"),
    );
    this.scope = activityScope(agentDir);
    this.directory = join(
      this.files.namespace,
      "pi-activity-v1",
      this.scope,
      hash(hostname()),
    );
  }
  scan(): { records: NativeActivity[]; unavailable: number } {
    const records: NativeActivity[] = [];
    let unavailable = 0;
    if (!this.files.directory(this.directory)) return { records, unavailable };
    const dir = opendirSync(this.directory);
    try {
      let count = 0;
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (++count > ACTIVITY_FILES) {
          unavailable++;
          break;
        }
        try {
          if (!e.isFile() || !/^[0-9a-f-]{36}\.json$/.test(e.name))
            throw new Error();
          const file = this.files.read(join(this.directory, e.name));
          if (!file) continue; // A publisher settled between directory and file reads.
          const record = decodeNativeActivity(json(file));
          if (
            `${record.instance}.json` !== e.name ||
            record.scope !== this.scope ||
            record.process.host !== hostname()
          )
            throw new Error();
          records.push(record);
        } catch {
          unavailable++;
        }
      }
    } finally {
      dir.closeSync();
    }
    return { records, unavailable };
  }
  /** Only a writer starting real work retires provably dead reports. Unknown
   * and corrupt bytes stay untouched. Archived metadata expires with the existing
   * 30-day recovery archive; a readonly discovery never cleans consumer data. */
  retireDead(now: number): void {
    const { records } = this.scan();
    for (const record of records) {
      if (
        now - record.renewedAt <= ACTIVITY_RETAIN_MS ||
        holderState(record.process).state !== "dead"
      )
        continue;
      const path = join(this.directory, `${record.instance}.json`);
      const before = this.files.read(path);
      if (
        !before ||
        encoded(decodeNativeActivity(json(before))) !== encoded(record)
      )
        continue;
      const archive = join(
        this.files.namespace,
        "recovery-archive-v1",
        `${Date.now()}-${randomUUID()}`,
      );
      this.files.directory(archive, true);
      this.files.assert(path, before);
      renameSync(path, join(archive, "pi-activity.json"));
    }
  }
  publish(record: NativeActivity, previous?: FileSnapshot): FileSnapshot {
    if (!previous) {
      const scanned = this.scan();
      if (scanned.records.length + scanned.unavailable >= ACTIVITY_FILES)
        throw new Error("activity-capacity");
    }
    const path = join(this.directory, `${record.instance}.json`);
    const bytes = encoded(decodeNativeActivity(record));
    if (previous) return this.files.replace(path, previous, bytes);
    // Publish the first report atomically too. A failed temporary is preserved,
    // not interpreted as an idle terminal or silently deleted by a reader.
    this.files.directory(this.directory, true);
    const temporary = join(this.directory, `pending-${record.instance}.json`);
    this.files.create(temporary, bytes);
    this.files.assert(path, undefined);
    renameSync(temporary, path);
    const saved = this.files.read(path);
    if (!saved) throw new Error("activity-unavailable");
    return saved;
  }
  withdraw(instance: string, previous: FileSnapshot): void {
    this.files.remove(join(this.directory, `${instance}.json`), previous);
  }
}
