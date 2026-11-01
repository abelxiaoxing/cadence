/** W3 recording continuation after an owner ended without its orderly Stop.
 * The new owner holds the lease, so nothing else can still write this history:
 * a torn final batch or unsettled facts of the dead epoch are closed by one
 * explicit recovery bridge in a new segment (the old bytes stay untouched).
 * History that cannot be read at all is archived and started afresh. */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, opendirSync } from "node:fs";
import { join, relative } from "node:path";
import type { OwnerLease } from "../service/coordination.ts";
import { encoded, hash } from "../service/private-files.ts";
import type { RecoveryLog } from "../service/recovery-log.ts";
import { ContractError, LIMITS } from "../service-contract.ts";
import { HistoryFiles, type WriteObserver } from "./files.ts";
import type { JournalRow, RecoveryBridge } from "./types.ts";
import { HistoryWriter } from "./writer.ts";

/** Read exact bounded safe files incrementally; includes orphan/temp/index metadata. */
export function digestHistory(files: HistoryFiles, exclude?: string): string {
  files.assertFormat();
  const digest = createHash("sha256");
  let count = 0;
  const walk = (path: string, depth: number) => {
    if (depth > 8 || !files.files.directory(path))
      throw new ContractError("corrupt-selected");
    const directory = lstatSync(path);
    digest.update(`incarnation:${directory.dev}:${directory.ino}\n`);
    const dir = opendirSync(path),
      names: string[] = [];
    try {
      for (let e = dir.readSync(); e; e = dir.readSync()) {
        if (++count > LIMITS.dataFrames) throw new ContractError("capacity");
        names.push(e.name);
      }
    } finally {
      dir.closeSync();
    }
    for (const name of names.sort()) {
      const selected = join(path, name);
      if (selected === exclude) continue;
      const rel = relative(files.directory, selected);
      if (lstatSync(selected).isDirectory()) {
        digest.update(`directory:${Buffer.byteLength(rel)}:${rel}\n`);
        walk(selected, depth + 1);
      } else {
        const value = files.files.read(selected, LIMITS.segmentBytes);
        if (!value) throw new ContractError("conflict");
        digest
          .update(
            `file:${Buffer.byteLength(rel)}:${rel}:${value.stamp}:${value.bytes.length}:`,
          )
          .update(value.bytes);
      }
    }
  };
  walk(files.directory, 0);
  files.assertFormat();
  return digest.digest("hex");
}
/** Append one recovery bridge under the current owner's lease. */
export async function appendRecoveryBridge(
  lease: OwnerLease,
  files: HistoryFiles,
  observeWrite?: WriteObserver,
): Promise<{ committedSeq: string; segment: number }> {
  lease.assert();
  files.assertWritable();
  const state = files.inspect();
  const bridge: RecoveryBridge = {
    kind: "recovery",
    recoveryId: randomUUID(),
    epoch: lease.registration.epoch,
    coordinationDigest: hash(
      encoded({ automatic: true, epoch: lease.registration.epoch }),
    ),
    historyDigest: digestHistory(files),
    previous: {
      segment: state.segment,
      bytes: state.bytes,
      sha256: state.identity ?? hash(""),
      committedBytes: state.committedBytes ?? state.bytes,
      committedSeq: state.committedSeq,
      highSeq: state.highSeq ?? state.committedSeq,
    },
    acknowledgments: { processes: true, credentials: true, storage: true },
  };
  const row: JournalRow = {
    kind: "record",
    id: randomUUID(),
    seq: String(BigInt(bridge.previous.highSeq) + 1n),
    value: bridge,
  };
  const encodedBatch = files.encodeBatch(state, [row]);
  const bytes = Buffer.byteLength(encodedBatch.body + encodedBatch.trailer);
  if (files.freeBytes() < LIMITS.freeSpaceFloorBytes + bytes)
    throw new ContractError("recording-exhausted");
  const after = await files.appendRecovery(
    state,
    row,
    async () => lease.assert(),
    observeWrite,
  );
  return {
    committedSeq: after.state.committedSeq,
    segment: after.state.segment,
  };
}
export type HistoryHeal =
  | "clean"
  | "initialized"
  | "continued-history"
  | "archived-history";
function damaged(error: unknown): boolean {
  return !(error instanceof ContractError) || error.code === "corrupt-selected";
}
/** Make this owner's history writable, whatever its predecessor left. */
export async function healHistory(
  lease: OwnerLease,
  log: RecoveryLog,
): Promise<{ heal: HistoryHeal; archive: string | null }> {
  lease.assert();
  const c = lease.coordination,
    directory = join(c.directory, "history-v2");
  let files: HistoryFiles | undefined;
  let broken = false;
  try {
    files = HistoryFiles.open(c);
    if (files) {
      files.assertWritable();
      // The writer's own reconstruction decides whether it would be fenced.
      if (new HistoryWriter(lease).quarantined) {
        await appendRecoveryBridge(lease, files);
        if (new HistoryWriter(lease).quarantined)
          throw new ContractError("quarantine");
        return { heal: "continued-history", archive: null };
      }
      return { heal: "clean", archive: null };
    }
  } catch (error) {
    if (!damaged(error)) throw error;
    broken = true;
  }
  if (broken) {
    const archive = log.archive();
    archive.keep(directory, "history-v2");
    HistoryFiles.initialize(lease);
    return { heal: "archived-history", archive: archive.name };
  }
  HistoryFiles.initialize(lease);
  return { heal: "initialized", archive: null };
}
