/** Strict v1 projection only. Rich retained bytes and execution facts never live here. */
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { AdmissionIntent } from "../service/ports.ts";
import {
  type ContentRef,
  ContractError,
  canonicalJson,
  type OwnerFact,
  type OwnerLink,
  settlementOutcome,
} from "../service-contract.ts";
import { savedRecordIdentity, type TaskStore } from "../task-store.ts";
import {
  decodeTask,
  MAX_RECORD_BYTES,
  TASK_SCHEMA,
  type TaskPhase,
  type TaskRecord,
} from "../task-types.ts";
import { safeDirectory } from "../workspace.ts";
import type { HistoryReader } from "./reader.ts";
import type { RunState } from "./run-state.ts";

export interface TaskPublicationRequest {
  operationId: string;
  /** Required for Create, otherwise the literal selected legacy cwd is retained. */
  cwd?: string;
  /** Optional selected committed child final; otherwise all selected child finals are projected. */
  result?: ContentRef;
  baseline?: ContentRef;
}
export interface TaskPublicationResult {
  status: "published" | "conflict" | "uncertain" | "refused";
  publicationId: string | null;
  committedSeq: string | null;
  observed: { revision: number; identity: string } | null;
}
export function summary(
  text: string,
  maximum: number,
  runId: string | null,
): string {
  const label = `[Cadence summary${runId ? `; run ${runId}` : ""}; retained history is separate]\n`;
  const tail = "\n[summary clipped; retained history unchanged]";
  const bytes = Buffer.from(text);
  const room = maximum - Buffer.byteLength(label);
  if (bytes.length <= room) return label + text;
  let end = room - Buffer.byteLength(tail);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return label + bytes.subarray(0, end).toString("utf8") + tail;
}
export function publicationPhase(run: RunState): TaskPhase {
  if (!run.settlement) return "running";
  switch (settlementOutcome(run.settlement)) {
    case "completed":
      return run.admission?.kind === "generate-plan" ? "planning" : "review";
    case "failed":
    case "blocked":
      return "failed";
    case "canceled":
    case "timeout":
    case "unknown":
      return "interrupted";
  }
}
function bad(): never {
  throw new ContractError("conflict");
}
export function publicationRecord(
  store: TaskStore,
  reader: HistoryReader,
  intent: AdmissionIntent,
  link: OwnerLink,
  run: RunState | null,
  request: TaskPublicationRequest,
  expected: { revision: number; identity: string | null },
  facts: { link: OwnerLink; fact: OwnerFact }[],
  snapshotSeq: string,
): TaskRecord {
  const identity = intent.identity;
  if (identity.kind !== "action") bad();
  const current = store.loadSnapshot(link.taskId);
  if (
    (current?.record.revision ?? 0) !== expected.revision ||
    (current?.identity ?? null) !== expected.identity
  )
    bad();
  const action = identity.action;
  if ((action.kind === "create") !== !current) bad();
  let record: TaskRecord;
  if (current) record = structuredClone(current.record);
  else {
    if (action.kind !== "create" || !request.cwd || store.list().length >= 1000)
      bad();
    const cwd = realpathSync(request.cwd),
      within = relative(store.root, cwd);
    if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`))
      bad();
    record = {
      schema: TASK_SCHEMA,
      id: link.taskId,
      revision: 0,
      kind: action.taskKind,
      goal: action.goal,
      plan: "",
      cwd,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    };
  }
  const retained = (ref: ContentRef, mode: "result" | "baseline"): string => {
    const detail = reader.selected({
      storeId: reader.storeId,
      scope: { kind: "task", id: link.taskId },
      snapshotSeq,
      query: null,
      recordId: ref.recordId,
      recordVersion: ref.version,
      field: ref.field,
      offset: 0,
    });
    if (
      canonicalJson(detail.content) !== canonicalJson(ref) ||
      detail.owner.runId !== link.runId
    )
      bad();
    if (mode === "baseline") {
      if (
        !facts.some(
          ({ link: l, fact: f }) =>
            l.taskId === link.taskId &&
            l.runId === link.runId &&
            f.kind === "changes" &&
            f.stage === "before" &&
            canonicalJson(f.content) === canonicalJson(ref),
        )
      )
        bad();
    } else if (
      !run ||
      ![...run.children.values()].some(
        (c) =>
          c.completion?.recording.status === "committed" &&
          canonicalJson(c.completion.recording.detail.content) ===
            canonicalJson(ref),
      )
    )
      bad();
    // Validate the ENTIRE independent retained content while keeping only a bounded preview.
    let preview = "";
    for (const part of reader.parts(detail, snapshotSeq))
      if (Buffer.byteLength(preview) < 32768) {
        let end = Math.min(
          part.bytes.length,
          32768 - Buffer.byteLength(preview),
        );
        while (
          end > 0 &&
          end < part.bytes.length &&
          (part.bytes[end] & 0xc0) === 0x80
        )
          end--;
        preview += part.bytes.subarray(0, end).toString("utf8");
      }
    return preview;
  };
  if (action.kind === "save-plan") {
    const ref = action.graph.plan;
    const detail = reader.selected({
      storeId: reader.storeId,
      scope: { kind: "task", id: link.taskId },
      snapshotSeq,
      query: null,
      recordId: ref.recordId,
      recordVersion: ref.version,
      field: ref.field,
      offset: 0,
    });
    if (
      detail.origin.kind !== "owner" ||
      detail.origin.id !== intent.operationId ||
      detail.owner.runId !== null ||
      detail.owner.childRunId !== null ||
      detail.owner.entity.kind !== "task" ||
      detail.owner.entity.id !== link.taskId ||
      detail.owner.entity.version !== action.graph.planRevision ||
      canonicalJson(detail.content) !== canonicalJson(ref) ||
      ref.bytes > 32768
    )
      bad();
    const bytes = Buffer.concat(
      [...reader.parts(detail, snapshotSeq)].map((p) => p.bytes),
    );
    if (bytes.toString("utf8") !== action.plan) bad();
    record.plan = action.plan;
    record.phase = "planning";
    delete record.review;
  }
  if (run) {
    record.phase = publicationPhase(run);
    delete record.review;
    let result = request.result ? retained(request.result, "result") : "";
    if (!request.result)
      for (const child of run.children.values()) {
        if (child.completion?.recording.status === "committed") {
          const text = retained(
            child.completion.recording.detail.content,
            "result",
          );
          if (Buffer.byteLength(result) < 32768)
            result += `Child ${child.link.childRunId}\n${text}\n`;
        }
      }
    if (run.settlement)
      result = `Execution: ${settlementOutcome(run.settlement)} (checks and human review are separate).\n${result}`;
    if (run.admission?.kind === "generate-plan")
      result = `Advisory plan proposal only; not saved or authorized for Start. Explicitly edit/accept and Save a plan before a separate Start.\n${result}`;
    record.result = summary(result, 16384, link.runId);
    // A planner's genuine final is retained separately. Never overwrite the
    // readable accepted plan (including an empty one) with model-generated text.
    if (
      action.kind === "check" &&
      run.check &&
      run.settlement?.kind === "check"
    ) {
      if (record.checks.length >= 32) bad();
      const s = run.settlement;
      const fact = facts.findLast(
        ({ link: l, fact: f }) =>
          l.runId === link.runId && f.kind === "check-settled",
      )?.fact;
      if (fact?.kind !== "check-settled") bad();
      record.checks.push({
        name: run.check.selection.name,
        command: run.check.selection.command,
        timeoutMs: run.check.selection.timeoutMs,
        cwd: record.cwd,
        exitCode: s.native.exitCode,
        durationMs: s.native.durationMs,
        status: fact.status,
        fingerprint: fact.after.identity,
      });
    }
  }
  if (request.baseline)
    record.baseline = summary(
      retained(request.baseline, "baseline"),
      16384,
      link.runId,
    );
  if (action.kind === "review") {
    const reviewed = facts.findLast(
      ({ link: l, fact: f }) =>
        l.operationId === intent.operationId && f.kind === "review",
    );
    if (reviewed?.fact.kind !== "review") bad();
    record.phase = "done";
    record.review = {
      fingerprint: reviewed.fact.changesIdentity,
      outcome: reviewed.fact.outcome,
    };
  }
  record.revision = expected.revision + 1;
  record.activity = [
    ...record.activity.slice(-63),
    {
      at: new Date().toISOString(),
      text: `Cadence ${action.kind}${link.runId ? `; run ${link.runId}` : ""}; phase ${record.phase}. History/check/review facts remain separate.`,
    },
  ];
  record = decodeTask(record);
  if (
    Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`) > MAX_RECORD_BYTES
  )
    throw new ContractError("capacity");
  return record;
}
export { savedRecordIdentity };

/** TaskStore flushes the original temporary; publication additionally flushes its directory chain on POSIX. */
export function syncTaskPublication(store: TaskStore, taskId: string): void {
  if (process.platform === "win32") return;
  for (let path = join(store.tasks, taskId); ; path = dirname(path)) {
    if (!safeDirectory(path)) throw new ContractError("conflict");
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (path === store.root) return;
    if (dirname(path) === path) throw new ContractError("conflict");
  }
}
