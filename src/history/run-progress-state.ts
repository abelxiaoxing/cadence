import {
  type CaptureCoverage,
  ContractError,
  decodeCoverage,
  type HistoryRecord,
  LIMITS,
  type StoredCommand,
} from "../service-contract.ts";
import { closed, decodeId, integer, oneOf } from "../worker-public.mjs";
import { sourceAt } from "./entity-state.ts";
import type { LocatedBatch } from "./navigation.ts";
import {
  projectRunObservation,
  type RunObservation,
  uncertainSettlement,
} from "./run-state.ts";
import {
  decodeSourceEvent,
  type SourceEvent,
  type SourceRows,
} from "./source-row.ts";
import { COMPLETE, captureCoverage, combineCoverage } from "./types.ts";
/** Fixed one-run/one-child projection slots, not a per-history map. */
export interface RunProgressState {
  id: string;
  childId: string | null;
  ordinal: number;
  admission: SourceEvent | null;
  settlement: SourceEvent | null;
  gate: SourceEvent | null;
  assignment: SourceEvent | null;
  admissionClosed: SourceEvent | null;
  unknownGate: boolean;
  completion: SourceEvent | null;
  recovered: boolean;
  check: boolean;
  prepared: boolean;
  launched: boolean;
  children: number;
  auth: number;
  closed: number;
  uncertain: boolean;
  publication: StoredCommand["receipt"]["publication"];
  coverage: CaptureCoverage;
  childCoverage: CaptureCoverage;
}
export function freshRun(
  id: string,
  childId: string | null,
  ordinal: number,
): RunProgressState {
  return {
    id,
    childId,
    ordinal,
    admission: null,
    settlement: null,
    gate: null,
    assignment: null,
    admissionClosed: null,
    unknownGate: false,
    completion: null,
    recovered: false,
    check: false,
    prepared: false,
    launched: false,
    children: 0,
    auth: 0,
    closed: 0,
    uncertain: false,
    publication: "pending",
    coverage: { ...COMPLETE, omissions: [] },
    childCoverage: { ...COMPLETE, omissions: [] },
  };
}
function bad(): never {
  throw new ContractError("corrupt-selected");
}
export function decodeRunProgressState(value: unknown): RunProgressState {
  const additions = ["assignment", "admissionClosed", "unknownGate"];
  const o = closed(
    value,
    Object.keys(freshRun("", null, 0)).filter(
      (k) => !additions.includes(k) || Object.hasOwn(value as object, k),
    ),
  );
  const flag = (key: string) => {
    if (typeof o[key] !== "boolean") bad();
    return o[key] as boolean;
  };
  const at = (v: unknown) => (v === null ? null : decodeSourceEvent(v));
  return {
    id: decodeId(o.id),
    childId: o.childId === null ? null : decodeId(o.childId),
    ordinal: integer(o.ordinal, 0, LIMITS.assignments),
    admission: at(o.admission),
    settlement: at(o.settlement),
    gate: at(o.gate),
    assignment: at(o.assignment ?? null),
    admissionClosed: at(o.admissionClosed ?? null),
    unknownGate: o.unknownGate === undefined ? false : flag("unknownGate"),
    completion: at(o.completion),
    recovered: flag("recovered"),
    check: flag("check"),
    prepared: flag("prepared"),
    launched: flag("launched"),
    uncertain: flag("uncertain"),
    children: integer(o.children, 0, LIMITS.assignments),
    auth: integer(o.auth, 0, LIMITS.assignments),
    closed: integer(o.closed, 0, LIMITS.assignments),
    publication: oneOf(o.publication, [
      "pending",
      "published",
      "conflict",
      "uncertain",
    ]),
    coverage: decodeCoverage(o.coverage),
    childCoverage: decodeCoverage(o.childCoverage),
  };
}
export function collectRun(
  s: RunProgressState,
  batch: LocatedBatch,
  row: number,
  index: number,
): void {
  const v = batch.rows[row].value;
  const at = () => sourceAt(batch, row, index);
  if (index === 0) {
    if (v.kind === "recovery" && s.admission) s.recovered = true;
    if (v.kind === "auth-preparation" && v.intent.runId === s.id) {
      s.auth++;
      if (v.intent.childRunId === s.childId) s.prepared = true;
    }
    if (v.kind === "launch" && v.link.runId === s.id) {
      s.children++;
      if (v.link.childRunId === s.childId) s.launched = true;
    }
    if (v.kind === "settlement" && v.link.runId === s.id) {
      s.closed++;
      s.uncertain ||= uncertainSettlement(v.completion);
      s.coverage = combineCoverage(s.coverage, v.completion.native.capture);
      if (v.link.childRunId === s.childId) s.completion = at();
    }
  }
  if (v.kind === "capture" && v.link.runId === s.id) {
    const e = v.events[index],
      coverage =
        e?.kind === "end"
          ? e.detail.coverage
          : e?.kind === "capture"
            ? captureCoverage(e.value.event)
            : null;
    if (coverage) {
      s.coverage = combineCoverage(s.coverage, coverage);
      if (v.link.childRunId === s.childId)
        s.childCoverage = combineCoverage(s.childCoverage, coverage);
    }
  }
  if (v.kind !== "owner" || v.link.runId !== s.id) return;
  const e = v.events[index];
  if (e?.kind !== "owner" || e.value.kind !== "fact") return;
  const f = e.value.fact;
  switch (f.kind) {
    case "parent-admitted":
      s.admission = at();
      break;
    case "parent-settled":
      s.settlement = at();
      break;
    case "check-start":
      s.check = true;
      break;
    case "check-settled":
      s.settlement = at();
      s.coverage = combineCoverage(s.coverage, f.coverage);
      break;
    case "gate":
      if (!f.reservationId) s.gate = at();
      s.unknownGate ||= f.state === "unknown";
      break;
    case "assignment-state":
      if (f.childRunId === s.childId) s.assignment = at();
      break;
    case "admission-closed":
      s.admissionClosed = at();
      break;
    case "publication-intent":
      s.publication = "pending";
      break;
    case "publication-settled":
      s.publication = f.status;
      break;
  }
}
export function materializeRun(
  s: RunProgressState,
  sources: SourceRows,
  epoch: string,
): Extract<HistoryRecord, { kind: "run" }> {
  if (!s.admission) bad();
  const a = sources.event(s.admission).event;
  if (
    a.kind !== "owner" ||
    a.value.kind !== "fact" ||
    a.value.fact.kind !== "parent-admitted"
  )
    bad();
  const observation: RunObservation = {
    admission: a.value.fact.identity,
    recovered: s.recovered,
    publication: s.publication,
    gate: null,
    unknownGate: s.unknownGate,
    settlement: null,
    coverage: s.coverage,
    children: s.children,
    auth: s.auth,
    closed: s.closed,
    uncertain: s.uncertain,
    check: s.check,
  };
  if (s.gate) {
    const e = sources.event(s.gate).event;
    if (
      e.kind !== "owner" ||
      e.value.kind !== "fact" ||
      e.value.fact.kind !== "gate"
    )
      bad();
    observation.gate = e.value.fact;
  }
  let assignmentState = null;
  if (s.assignment) {
    const e = sources.event(s.assignment).event;
    if (
      e.kind !== "owner" ||
      e.value.kind !== "fact" ||
      e.value.fact.kind !== "assignment-state"
    )
      bad();
    assignmentState = e.value.fact;
  }
  if (s.admissionClosed) {
    const e = sources.event(s.admissionClosed).event;
    if (
      e.kind !== "owner" ||
      e.value.kind !== "fact" ||
      e.value.fact.kind !== "admission-closed"
    )
      bad();
    observation.admissionClosed = e.value.fact;
  }
  if (s.settlement) {
    const e = sources.event(s.settlement).event;
    if (e.kind !== "owner" || e.value.kind !== "fact") bad();
    const f = e.value.fact;
    if (f.kind === "parent-settled") observation.settlement = f.settlement;
    else if (f.kind === "check-settled")
      observation.settlement = {
        kind: "check",
        native: f.native,
        capture: f.coverage,
        settlementSeq: s.settlement.seq,
      };
    else bad();
  }
  const c = s.completion ? sources.read(s.completion).value : null;
  if (c && c.kind !== "settlement") bad();
  const assignment = s.childId
    ? observation.admission.assignments.find((a) => a.childRunId === s.childId)
    : null;
  if (s.childId && !assignment) bad();
  return {
    kind: "run",
    projection: projectRunObservation(
      s.id,
      epoch,
      observation,
      assignment
        ? {
            ...assignment,
            state: assignmentState,
            prepared: s.prepared,
            launched: s.launched,
            completion: c?.kind === "settlement" ? c.completion : null,
            settlementSeq: s.completion?.seq ?? null,
            coverage: s.childCoverage,
          }
        : null,
    ),
  };
}
