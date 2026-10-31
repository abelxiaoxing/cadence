import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  decodeCheck,
  decodeTask,
  MAX_RECORD_BYTES,
  object,
  type TaskRecord,
  validId,
} from "./task-types.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

export type { CheckoutLock } from "./service/checkout-lock.ts";
export {
  canonicalAmbientRoot,
  defaultStateHome,
  effectiveWorkspace,
  gitArguments,
  gitEnvironment,
  privateWorkspace,
  readBounded,
  resolveWorkspace,
  retryWindowsFileOperation,
  safeDirectory,
  stateHomeInside,
} from "./workspace.ts";

import { type CheckoutLock, CheckoutStore } from "./service/checkout-lock.ts";
import {
  defaultStateHome,
  parseRecord,
  readBounded,
  retryWindowsFileOperation,
  safeDirectory,
} from "./workspace.ts";

/** Canonical bytes written by save; identity is optimistic record concurrency, not consent. */
function recordText(record: TaskRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
function contentIdentity(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}
export function savedRecordIdentity(record: TaskRecord): string {
  return contentIdentity(recordText(record));
}
export class TaskStore extends CheckoutStore {
  readonly tasks: string;
  constructor(root: string, stateHome = defaultStateHome()) {
    super(root, stateHome);
    this.tasks = join(this.root, ".cadence", "assistant", "tasks");
  }
  recover(expected: CheckoutLock, acknowledgeEscapedProcesses: boolean): void {
    if (!acknowledgeEscapedProcesses || expected.host !== hostname())
      throw new Error("Recovery requires informed local-owner confirmation");
    this.assertOwner(expected);
    try {
      process.kill(expected.pid, 0);
    } catch (error) {
      if (!object(error) || error.code !== "ESRCH")
        throw new Error("Owner status unknown");
      this.assertOwner(expected);
      unlinkSync(this.lockPath);
      return;
    }
    throw new Error("Owner is live; stop it first");
  }
  load(id: string): TaskRecord | undefined {
    return this.loadSnapshot(id)?.record;
  }
  loadSnapshot(
    id: string,
  ): { record: TaskRecord; identity: string } | undefined {
    if (!validId(id)) throw new Error("Invalid task id");
    const directory = join(this.tasks, id);
    if (
      safeDirectory(directory) &&
      readdirSync(directory).some((name) => name !== "task.json")
    )
      throw new Error(
        "Unknown task directory content; preserved without reset",
      );
    const data = readBounded(
      join(this.tasks, id, "task.json"),
      MAX_RECORD_BYTES,
    );
    if (!data) return undefined;
    const record = decodeTask(parseRecord(data));
    if (record.id !== id) throw new Error("Task identity mismatch");
    return { record, identity: contentIdentity(data) };
  }
  list(): TaskRecord[] {
    if (!safeDirectory(this.tasks)) return [];
    const entries = readdirSync(this.tasks);
    if (entries.length > 1000) throw new Error("Task listing limit exceeded");
    return entries.map((id) => {
      const task = this.load(id);
      if (!task) throw new Error("Unknown task directory");
      return task;
    });
  }
  save(
    record: TaskRecord,
    expectedRevision: number,
    held?: CheckoutLock,
    expectedIdentity?: string,
  ): TaskRecord {
    const next = decodeTask(record);
    if (next.revision !== expectedRevision + 1)
      throw new Error("Revision conflict");
    const text = recordText(next);
    if (Buffer.byteLength(text) > MAX_RECORD_BYTES)
      throw new Error("Task record limit");
    const lock = held ?? this.acquire();
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Not the lock owner");
    try {
      this.assertOwner(lock);
      const current = this.loadSnapshot(next.id);
      if ((current?.record.revision ?? 0) !== expectedRevision)
        throw new Error("Revision conflict");
      if (current?.identity !== expectedIdentity)
        throw new Error("Task content changed; reopen it");
      const dir = join(this.tasks, next.id);
      safeDirectory(dir, true);
      // Unknown sibling state is not overwritten or cleaned.
      if (!current && readdirSync(dir).length)
        throw new Error("Unknown task directory");
      const temporary = join(dir, `task.${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.assertOwner(lock);
      // Check again after preparing the replacement. External editors do not share our lock;
      // this detects observed conflicts, not an atomic filesystem CAS against hostile writers.
      const latest = readBounded(join(dir, "task.json"), MAX_RECORD_BYTES);
      if ((latest ? contentIdentity(latest) : undefined) !== expectedIdentity)
        throw new Error(
          "Task content changed; replacement preserved without overwrite",
        );
      retryWindowsFileOperation(
        () => renameSync(temporary, join(dir, "task.json")),
        () => {
          this.assertOwner(lock);
          const now = readBounded(join(dir, "task.json"), MAX_RECORD_BYTES);
          if ((now ? contentIdentity(now) : undefined) !== expectedIdentity)
            throw new Error(
              "Task content changed; replacement preserved without overwrite",
            );
        },
      );
      return next;
    } finally {
      if (!held) this.release(lock);
    }
  }
  checks() {
    const data = readBounded(
      join(this.root, ".cadence", "assistant", "config.json"),
      32768,
    );
    if (!data) return [];
    const value: unknown = parseRecord(data);
    if (
      !object(value) ||
      value.schema !== TASK_CONFIG_SCHEMA ||
      !Array.isArray(value.checks) ||
      value.checks.length > 32 ||
      Object.keys(value).some((key) => !["schema", "checks"].includes(key))
    )
      throw new Error("Unknown check configuration");
    const checks = value.checks.map(decodeCheck);
    if (
      new Set(checks.map((check) => check.name)).size !== checks.length ||
      checks.some((check) => check.name === "Manual command")
    )
      throw new Error("Duplicate or reserved check name");
    return checks;
  }
  readLog(name: string): string {
    if (!/^[a-f0-9-]{36}\.log$/.test(name))
      throw new Error("Invalid diagnostic name");
    this.inspectPrivateFile(join(this.privateRoot, name), 65536);
    const data = readBounded(join(this.privateRoot, name), 65536);
    return data
      ? diagnosticText(data.toString("utf8"), 65536)
      : "Private diagnostic unavailable";
  }
  writeLog(lock: CheckoutLock, output: string): string {
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Not the lock owner");
    this.assertOwner(lock);
    const name = `${randomUUID()}.log`;
    writeFileSync(join(this.privateRoot, name), diagnosticText(output, 65536), {
      flag: "wx",
      mode: 0o600,
    });
    return name;
  }
}
export const TASK_CONFIG_SCHEMA = "cadence-assistant-checks/1";

/** Only legacy readers/producers use this adapter; coordination owns no task CRUD. */
const stores = new WeakMap<object, TaskStore>();
export function legacyTaskStore(c: {
  store: { root: string };
  stateHome: string;
}): TaskStore {
  let store = stores.get(c);
  if (!store) {
    store = new TaskStore(c.store.root, c.stateHome);
    stores.set(c, store);
  }
  return store;
}
