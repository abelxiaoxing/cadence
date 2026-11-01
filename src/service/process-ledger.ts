/** Which worker processes an owner epoch started, so that after a crash on the
 * same boot its successor can find and stop the orphans by exact identity.
 * Lives outside the selected service directory: older releases ignore it. */
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  closed,
  decodeId,
  integer,
  list,
  literal,
  text,
} from "./contracts/core.ts";
import { bootId, processStart } from "./liveness.ts";
import {
  encoded,
  type FileSnapshot,
  json,
  type PrivateFiles,
} from "./private-files.ts";

const LEDGER_BYTES = 64 * 1024;
/** Workers one epoch can track at once (their own bound is far lower). */
const LEDGER_WORKERS = 512;
export interface LedgerWorker {
  pid: number;
  started: string | null;
  boot: string | null;
}
interface LedgerFile {
  schema: "cadence-process-ledger/1";
  epoch: string;
  boot: string | null;
  restart: boolean;
  workers: { pid: number; started: string | null }[];
}
function decode(value: unknown): LedgerFile {
  const o = closed(value, ["schema", "epoch", "boot", "restart", "workers"]);
  return {
    schema: literal(o.schema, "cadence-process-ledger/1"),
    epoch: decodeId(o.epoch),
    boot: o.boot === null ? null : text(o.boot, 128, true),
    restart: o.restart === true,
    workers: list(o.workers, LEDGER_WORKERS, (w) => {
      const row = closed(w, ["pid", "started"]);
      return {
        pid: integer(row.pid, 1, 2147483647),
        started: row.started === null ? null : text(row.started, 128, true),
      };
    }),
  };
}
export class ProcessLedger {
  readonly directory: string;
  constructor(readonly files: PrivateFiles) {
    this.directory = join(files.namespace, "process-ledger-v1");
  }
  path(epoch: string): string {
    return join(this.directory, `${decodeId(epoch)}.json`);
  }
  private file(epoch: string): LedgerFile | null {
    try {
      const snapshot = this.files.read(this.path(epoch), LEDGER_BYTES);
      return snapshot ? decode(json(snapshot, LEDGER_BYTES)) : null;
    } catch {
      return null;
    }
  }
  /** Workers still listed for a (dead) epoch. */
  read(epoch: string): LedgerWorker[] {
    const file = this.file(epoch);
    return file ? file.workers.map((w) => ({ ...w, boot: file.boot })) : [];
  }
  restartRequested(epoch: string): boolean {
    return this.file(epoch)?.restart === true;
  }
  remove(epoch: string): void {
    try {
      rmSync(this.path(epoch), { force: true });
    } catch {
      /* evidence only */
    }
  }
  /** The running owner's own ledger. */
  open(epoch: string): LiveLedger {
    return new LiveLedger(this, epoch);
  }
}
export class LiveLedger {
  private snapshot: FileSnapshot | undefined;
  private value: LedgerFile;
  constructor(
    private readonly ledger: ProcessLedger,
    readonly epoch: string,
  ) {
    this.value = {
      schema: "cadence-process-ledger/1",
      epoch: decodeId(epoch),
      boot: bootId(),
      restart: false,
      workers: [],
    };
    this.write();
  }
  private write(): void {
    // Evidence only: a failed write never stops the work it describes.
    try {
      const path = this.ledger.path(this.epoch);
      const bytes = encoded(this.value);
      this.snapshot = this.snapshot
        ? this.ledger.files.replace(path, this.snapshot, bytes, LEDGER_BYTES)
        : this.ledger.files.create(path, bytes, LEDGER_BYTES);
    } catch {
      this.snapshot = undefined;
      try {
        const path = this.ledger.path(this.epoch);
        const current = this.ledger.files.read(path, LEDGER_BYTES);
        this.snapshot = current
          ? this.ledger.files.replace(
              path,
              current,
              encoded(this.value),
              LEDGER_BYTES,
            )
          : this.ledger.files.create(path, encoded(this.value), LEDGER_BYTES);
      } catch {
        this.snapshot = undefined;
      }
    }
  }
  get workers(): readonly { pid: number; started: string | null }[] {
    return this.value.workers;
  }
  add(pid: number): void {
    if (this.value.workers.length >= LEDGER_WORKERS) return;
    this.value.workers = [
      ...this.value.workers.filter((w) => w.pid !== pid),
      { pid, started: processStart(pid) },
    ];
    this.write();
  }
  remove(pid: number): void {
    const before = this.value.workers.length;
    this.value.workers = this.value.workers.filter((w) => w.pid !== pid);
    if (this.value.workers.length !== before) this.write();
  }
  /** Mark that this owner is ending itself to recover from a runtime fault. */
  requestRestart(): void {
    this.value.restart = true;
    this.write();
  }
  /** Orderly release: nothing remains to recover. */
  close(): void {
    this.ledger.remove(this.epoch);
    this.snapshot = undefined;
  }
}
