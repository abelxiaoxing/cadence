/** One target occurrence, represented by a fixed set of original source locators.
 * No message bodies, task prose, event arrays or raw rows enter a checkpoint. */
import {
  ContractError,
  canonicalJson,
  decodeHistoryRecord,
  type HistoryRecord,
  type RecordOwner,
} from "../service-contract.ts";
import { closed, decodeId, integer, oneOf } from "../worker-public.mjs";
import type { LocatedBatch } from "./navigation.ts";
import {
  decodeSourceEvent,
  type SourceEvent,
  type SourceRows,
} from "./source-row.ts";
import type { JournalRow } from "./types.ts";
export type EntityRecord = Extract<
  HistoryRecord,
  { kind: "task" | "message" | "tool" }
>;
export interface EntityState {
  kind: EntityRecord["kind"];
  id: string;
  version: number;
  wanted: number | null;
  first: SourceEvent | null;
  last: SourceEvent | null;
  result: SourceEvent | null;
  detail: SourceEvent | null;
  detailId: string | null;
  stage: "partial" | "final" | null;
  started: boolean;
  done: boolean;
}
export function freshEntity(
  kind: EntityState["kind"],
  id: string,
  wanted: number | null,
): EntityState {
  return {
    kind,
    id,
    wanted,
    version: 0,
    first: null,
    last: null,
    result: null,
    detail: null,
    detailId: null,
    stage: null,
    started: false,
    done: false,
  };
}
export function decodeEntityState(value: unknown): EntityState {
  const o = closed(value, Object.keys(freshEntity("task", "", null)));
  if (typeof o.started !== "boolean" || typeof o.done !== "boolean") bad();
  const locator = (v: unknown) => (v === null ? null : decodeSourceEvent(v));
  return {
    kind: oneOf(o.kind, ["task", "message", "tool"]),
    id: decodeId(o.id),
    wanted: o.wanted === null ? null : integer(o.wanted, 1),
    version: integer(o.version),
    first: locator(o.first),
    last: locator(o.last),
    result: locator(o.result),
    detail: locator(o.detail),
    detailId: o.detailId === null ? null : decodeId(o.detailId),
    stage: o.stage === null ? null : oneOf(o.stage, ["partial", "final"]),
    started: o.started,
    done: o.done,
  };
}
function bad(): never {
  throw new ContractError("corrupt-selected");
}
export function sourceAt(
  batch: LocatedBatch,
  row: number,
  event = 0,
): SourceEvent {
  if (!batch.sourceRow) bad();
  return { ...batch.sourceRow(row), event };
}
export function collectEntity(
  s: EntityState,
  batch: LocatedBatch,
  rowIndex: number,
  eventIndex: number,
): void {
  if (s.done) return;
  const row = batch.rows[rowIndex],
    v = row.value;
  const save = () => {
    const source = sourceAt(batch, rowIndex, eventIndex);
    s.first ??= source;
    s.last = source;
    if (s.wanted === s.version) s.done = true;
  };
  if (
    s.kind === "task" &&
    eventIndex === 0 &&
    v.kind === "admission" &&
    v.intent.identity.kind === "action"
  ) {
    const action = v.intent.identity.action,
      id = v.intent.createdTaskId ?? v.intent.identity.expected.task?.id;
    if (id !== s.id) return;
    if (action.kind === "create") {
      s.version = 1;
      save();
    }
    if (action.kind === "save-plan" && s.first) {
      s.version = (v.intent.identity.expected.task?.revision ?? 0) + 1;
      s.detailId = action.graph.plan.recordId;
      s.detail = null;
      save();
    }
    return;
  }
  if (v.kind !== "capture") return;
  const e = v.events[eventIndex];
  if (e?.kind !== "capture") return;
  const event = e.value.event;
  if (
    s.kind === "message" &&
    event.kind === "message-start" &&
    event.messageId === s.id
  ) {
    s.version = 1;
    save();
  }
  if (
    s.kind === "message" &&
    event.kind === "message-end" &&
    event.messageId === s.id
  ) {
    if (!s.first) bad();
    s.version++;
    s.detailId = event.finalDetailId;
    save();
  }
  if (
    s.kind === "tool" &&
    (event.kind === "call-declaration" ||
      event.kind === "tool-start" ||
      event.kind === "tool-end") &&
    event.callId === s.id
  ) {
    s.version++;
    s.stage =
      event.kind === "call-declaration"
        ? event.stage
        : event.declaration
          ? (s.stage ?? "final")
          : null;
    s.started =
      event.kind === "tool-start"
        ? true
        : event.kind === "tool-end"
          ? event.startObserved
          : s.started;
    if (event.kind === "tool-end")
      s.result = sourceAt(batch, rowIndex, eventIndex);
    save();
  }
}
export function entityDetail(
  s: EntityState,
  row: JournalRow,
  event: number,
): boolean {
  const v = row.value;
  if (v.kind !== "owner" && v.kind !== "capture") return false;
  const e = v.events[event];
  return (
    e?.kind === "end" &&
    e.detail.owner.entity.id === s.id &&
    (s.kind === "task"
      ? e.detail.content.recordId === s.detailId
      : e.detail.detailId === s.detailId)
  );
}
export function materializeEntity(
  s: EntityState,
  sources: SourceRows,
): EntityRecord | undefined {
  if (!s.first || !s.last) return;
  const first = sources.read(s.first).value,
    last = sources.read(s.last).value;
  let record: EntityRecord;
  if (s.kind === "task") {
    if (
      first.kind !== "admission" ||
      first.intent.identity.kind !== "action" ||
      first.intent.identity.action.kind !== "create"
    )
      bad();
    const plan = s.detail ? sources.event(s.detail).event : null;
    if (s.detailId) {
      if (
        last.kind !== "admission" ||
        last.intent.identity.kind !== "action" ||
        last.intent.identity.action.kind !== "save-plan" ||
        plan?.kind !== "end" ||
        canonicalJson(plan.detail.content) !==
          canonicalJson(last.intent.identity.action.graph.plan) ||
        plan.detail.owner.entity.kind !== "task" ||
        plan.detail.owner.entity.version !==
          last.intent.identity.action.graph.planRevision
      )
        bad();
    }
    record = {
      kind: "task",
      owner: {
        taskId: s.id,
        runId: null,
        childRunId: null,
        entity: { kind: "task", id: s.id, version: s.version },
      },
      version: s.version,
      goal: first.intent.identity.action.goal,
      plan: plan?.kind === "end" ? plan.detail.content : null,
    };
  } else {
    if (first.kind !== "capture" || last.kind !== "capture") bad();
    const a = first.events[s.first.event],
      b = last.events[s.last.event];
    if (a?.kind !== "capture" || b?.kind !== "capture") bad();
    const owner: RecordOwner = {
      taskId: last.link.taskId,
      runId: last.link.runId,
      childRunId: last.link.childRunId,
      entity: { kind: s.kind, id: s.id, version: s.version },
    };
    if (s.kind === "message") {
      if (a.value.event.kind !== "message-start") bad();
      const end = b.value.event,
        detail = s.detail ? sources.event(s.detail).event : null;
      if (s.detailId && detail?.kind !== "end") bad();
      record = {
        kind: "message",
        owner,
        version: s.version,
        role: a.value.event.role,
        source: a.value.event.source,
        resultCallId: a.value.event.resultCallId,
        state: end.kind === "message-end" ? "final" : "partial",
        finalBlockCount:
          end.kind === "message-end" ? end.finalBlockCount : null,
        finalText: detail?.kind === "end" ? detail.detail.content : null,
      };
    } else {
      const e = b.value.event,
        result = s.result ? sources.event(s.result).event : null;
      if (
        e.kind !== "call-declaration" &&
        e.kind !== "tool-start" &&
        e.kind !== "tool-end"
      )
        bad();
      if (
        result &&
        (result.kind !== "capture" || result.value.event.kind !== "tool-end")
      )
        bad();
      record = {
        kind: "tool",
        owner,
        version: s.version,
        source: e.source,
        name: e.name,
        declaration: e.declaration,
        declarationStage: s.stage,
        startObserved: s.started,
        result:
          result?.kind === "capture" && result.value.event.kind === "tool-end"
            ? result.value.event
            : null,
      };
    }
  }
  const decoded = decodeHistoryRecord(record);
  if (
    decoded.kind !== "task" &&
    decoded.kind !== "message" &&
    decoded.kind !== "tool"
  )
    bad();
  return decoded;
}
