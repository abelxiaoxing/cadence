/** W3 recording boundary only. Never releases/signals/steals W1, v1 or registry locks. */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, opendirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ServiceCoordination } from "../service/coordination.ts";
import { hash } from "../service/private-files.ts";
import {
  inspectRecovery,
  type RecoveryHistoryFacts,
  type RecoveryInspection,
  type RecoveryInspectionPort,
} from "../service/recovery.ts";
import { ContractError, decodeId, LIMITS } from "../service-contract.ts";
import { emptyScan, HistoryFiles, type WriteObserver } from "./files.ts";
import { RunState } from "./run-state.ts";
import type { JournalRow, RecoveryBridge } from "./types.ts";

export interface RecoveryConfirmation {
  expected: RecoveryInspection;
  acknowledgeEscapedProcesses: true;
  processes: "externally-resolved";
  credentials: "independently-resolved";
  storage: "independently-resolved";
  /** REQUIRED W1 local capability + fresh interactive-choice assertion. No default.
   * W3 does not implement or infer management authority from a boolean/token. */
  assertLocalAuthority: (choice: RecoveryInspection) => void | Promise<void>;
}
export interface DurableRecoveryFact {
  recoveryId: string;
  committedSeq: string;
  epoch: string;
  coordinationDigest: string;
  historyDigest: string;
  segmentIdentity: string;
}
/** Read exact bounded safe files incrementally; includes orphan/temp/index metadata.
 * This local administrative inspection is not the public 8MiB read request API. */
function digestHistory(files: HistoryFiles, exclude?: string): string {
  files.assertFormat();
  const digest = createHash("sha256");
  let count = 0;
  const walk = (path: string, depth: number) => {
    if (depth > 8 || !files.files.directory(path))
      throw new ContractError("corrupt-selected");
    // Directory identity, not mutable directory timestamps: our exclusive new
    // recovery segment changes its parent's mtime but cannot replace that parent.
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
export class HistoryRecovery implements RecoveryInspectionPort {
  private readonly committed = new WeakMap<DurableRecoveryFact, () => void>();
  constructor(readonly coordination: ServiceCoordination) {}
  private files(): HistoryFiles {
    const files = HistoryFiles.open(this.coordination);
    if (!files) throw new ContractError("unavailable");
    return files;
  }
  /** Only an original completed append can supply this private release guard.
   * Never adopt a newly inspected digest after the async append/close boundary. */
  assertCommitted(fact: DurableRecoveryFact): void {
    const assert = this.committed.get(fact);
    if (!assert) throw new ContractError("conflict");
    assert();
  }
  async inspect(epoch: string): Promise<RecoveryHistoryFacts> {
    decodeId(epoch);
    const files = this.files(),
      before = digestHistory(files),
      state = emptyScan();
    const auth = new Set<string>(),
      processes = new Set<string>(),
      publication = new Set<string>(),
      unfinished = new Set<string>(),
      metadata = new Set<string>(),
      runs = new Map<string, RunState>();
    for (const batch of files.scan(state))
      for (const row of batch.rows) {
        const v = row.value;
        if (v.kind === "recovery") {
          auth.clear();
          processes.clear();
          publication.clear();
          unfinished.clear();
          metadata.clear();
          runs.clear();
        }
        if (v.kind === "admission" && v.intent.identity.kind === "action") {
          if (v.intent.runId) {
            if (runs.size >= LIMITS.episodes || runs.has(v.intent.runId))
              throw new ContractError("corrupt-selected");
            runs.set(v.intent.runId, new RunState(v.intent.runId));
          } else metadata.add(v.intent.operationId);
        }
        for (const [id, state] of runs) {
          state.apply(row, batch.marker.last);
          if (state.drained) runs.delete(id);
        }
        if (v.kind === "capture" || v.kind === "owner")
          for (const e of v.events) {
            if (
              e.kind === "capture" &&
              e.value.event.kind === "detail-begin" &&
              v.kind === "capture"
            )
              unfinished.add(
                `worker/${v.link.childRunId}/${e.value.event.detailId}`,
              );
            if (
              e.kind === "owner" &&
              e.value.kind === "content-begin" &&
              v.kind === "owner"
            )
              unfinished.add(`owner/${v.link.operationId}/${e.value.detailId}`);
            if (e.kind === "end")
              unfinished.delete(
                `${e.detail.origin.kind}/${e.detail.origin.id}/${e.detail.detailId}`,
              );
          }
        if (v.kind === "auth-preparation") auth.add(v.intent.operationId);
        if (v.kind === "auth-settlement") auth.delete(v.result.operationId);
        if (v.kind === "launch") processes.add(v.link.childRunId);
        if (
          v.kind === "settlement" &&
          v.completion.native.closure !== "unconfirmed"
        )
          processes.delete(v.link.childRunId);
        if (v.kind === "owner")
          for (const e of v.events)
            if (e.kind === "owner" && e.value.kind === "fact") {
              const f = e.value.fact;
              if (f.kind === "check-start") processes.add(f.checkId);
              if (
                f.kind === "check-settled" &&
                f.native.closure !== "unconfirmed"
              )
                processes.delete(f.checkId);
              if (f.kind === "publication-intent")
                publication.add(f.publicationId);
              if (f.kind === "publication-settled") {
                if (f.status === "published") {
                  publication.delete(f.publicationId);
                  metadata.delete(v.link.operationId);
                } else publication.add(f.publicationId);
              }
            }
      }
    if (before !== digestHistory(files)) throw new ContractError("conflict");
    return {
      digest: before,
      processes: processes.size ? "unknown" : "externally-resolved",
      credentials: auth.size ? "unknown" : "independently-resolved",
      storage:
        state.tail ||
        publication.size ||
        unfinished.size ||
        metadata.size ||
        runs.size
          ? "unknown"
          : "independently-resolved",
    };
  }
  async append(
    confirmation: RecoveryConfirmation,
    observeWrite?: WriteObserver,
  ): Promise<DurableRecoveryFact> {
    if (
      typeof confirmation.assertLocalAuthority !== "function" ||
      confirmation.acknowledgeEscapedProcesses !== true ||
      confirmation.processes !== "externally-resolved" ||
      confirmation.credentials !== "independently-resolved" ||
      confirmation.storage !== "independently-resolved"
    )
      throw new ContractError("forbidden");
    const expected = structuredClone(confirmation.expected),
      files = this.files();
    files.assertWritable();
    if (!expected.history || expected.owner !== "absent")
      throw new ContractError("quarantine");
    const current = await inspectRecovery(this.coordination, this);
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new ContractError("conflict");
    const state = files.inspect(),
      recoveryId = randomUUID();
    const bridge: RecoveryBridge = {
      kind: "recovery",
      recoveryId,
      epoch: expected.epoch,
      coordinationDigest: expected.coordinationDigest,
      historyDigest: expected.history.digest,
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
    const path = files.segmentPath(state.segment + 1);
    const assertCurrent = async () => {
      await confirmation.assertLocalAuthority(structuredClone(expected));
      const selected = await inspectRecovery(this.coordination);
      if (selected.owner !== "absent") throw new ContractError("quarantine");
      if (
        selected.epoch !== expected.epoch ||
        selected.coordinationDigest !== expected.coordinationDigest ||
        digestHistory(files, path) !== expected.history?.digest ||
        this.coordination.recoverySnapshot().digest !==
          expected.coordinationDigest
      )
        throw new ContractError("conflict");
    };
    // First guard does not exclude a preexisting conflicting segment.
    await confirmation.assertLocalAuthority(structuredClone(expected));
    if (digestHistory(files) !== expected.history.digest)
      throw new ContractError("conflict");
    const row: JournalRow = {
      kind: "record",
      id: randomUUID(),
      seq: String(BigInt(bridge.previous.highSeq) + 1n),
      value: bridge,
    };
    let quota: number = LIMITS.checkoutQuotaBytes;
    for (const batch of files.scan())
      for (const row of batch.rows)
        if (row.value.kind === "admission" && row.value.policy)
          quota = row.value.policy.quotaBytes;
    const bytes = Buffer.byteLength(
      files.encodeBatch(state, [row]).body +
        files.encodeBatch(state, [row]).trailer,
    );
    if (
      files.usage() + bytes > quota ||
      files.freeBytes() < LIMITS.freeSpaceFloorBytes + bytes
    )
      throw new ContractError("recording-exhausted");
    const after = await files.appendRecovery(
      state,
      row,
      assertCurrent,
      observeWrite,
    );
    const assert = () => {
      files.assertWritable();
      files.assertRecoveryIdle();
      files.files.assert(path, after.snapshot, LIMITS.segmentBytes);
      if (digestHistory(files, path) !== expected.history?.digest)
        throw new ContractError("conflict");
    };
    assert();
    const fact: DurableRecoveryFact = {
      recoveryId,
      committedSeq: after.state.committedSeq,
      epoch: expected.epoch,
      coordinationDigest: expected.coordinationDigest,
      historyDigest: expected.history.digest,
      segmentIdentity: after.state.identity ?? "",
    };
    this.committed.set(fact, assert);
    return fact;
  }
}
