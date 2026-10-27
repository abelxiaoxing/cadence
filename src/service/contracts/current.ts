/** Current owner observations, never retained-content or execution authority by inference. */

import { role } from "../../worker-public.mjs";
import {
  bool,
  canonicalJson,
  closed,
  decodeHash,
  decodeId,
  decodePublicError,
  decodeSequence,
  integer,
  invalid,
  LIMITS,
  list,
  literal,
  nullable,
  oneOf,
  type PublicError,
  text,
} from "./core.ts";
import {
  type CaptureCoverage,
  decodeCoverage,
  type RoleSelection,
  type TaskKind,
} from "./domain.ts";
import {
  type ControlContext,
  controlTask,
  controlWorkspace,
  decodeControlContext,
  decodeGraphReadRequest,
  type GraphReadRequest,
  type ObservationFact,
} from "./history.ts";

export interface CurrentRequest {
  storeId: string;
  taskId: string | null;
}
export interface CurrentTask {
  id: string;
  kind: TaskKind;
  revision: number;
  identity: string;
}
export type SavedGraphSelection =
  | { status: "none" }
  | { status: "saved"; request: GraphReadRequest; planRevision: number }
  | { status: "unavailable"; error: PublicError };
export interface CurrentView {
  request: CurrentRequest;
  workspaceId: string;
  epoch: string;
  committedSeq: string;
  context: ControlContext;
  /** Null when no live record is available, even for a non-null request.taskId.
   * This conveys no retained membership or permission to recreate the task. */
  task: CurrentTask | null;
  roles: RoleSelection[];
  readablePlan: null | {
    source: "current-v1";
    text: string;
    editable: boolean;
    coverage: CaptureCoverage;
  };
  savedGraph: SavedGraphSelection;
}
export interface CurrentChanges {
  request: CurrentRequest;
  workspaceId: string;
  epoch: string;
  committedSeq: string;
  context: ControlContext;
  task: CurrentTask;
  observation: ObservationFact;
  text: string;
  git: boolean;
  coverage: CaptureCoverage;
}
const noEffect = (v: unknown) => {
  const error = decodePublicError(v);
  literal(error.effect, "none");
  return error;
};
export function decodeCurrentRequest(v: unknown): CurrentRequest {
  const o = closed(v, ["storeId", "taskId"]);
  return { storeId: decodeId(o.storeId), taskId: nullable(o.taskId, decodeId) };
}
export function decodeCurrentChangesRequest(v: unknown): CurrentRequest {
  const request = decodeCurrentRequest(v);
  if (request.taskId === null) invalid();
  return request;
}
function currentTask(v: unknown): CurrentTask {
  const o = closed(v, ["id", "kind", "revision", "identity"]);
  return {
    id: decodeId(o.id),
    kind: oneOf(o.kind, ["code", "research", "diagnosis"]),
    revision: integer(o.revision, 1),
    identity: decodeHash(o.identity),
  };
}
export function decodeCurrentRoles(v: unknown): RoleSelection[] {
  const roles = list(v, 3, role);
  if (roles.length !== 3 || new Set(roles.map((r) => r.role)).size !== 3)
    invalid();
  return roles;
}
function savedGraph(v: unknown): SavedGraphSelection {
  const status = Object.getOwnPropertyDescriptor(v ?? {}, "status")?.value;
  if (status === "none") {
    closed(v, ["status"]);
    return { status };
  }
  if (status === "saved") {
    const o = closed(v, ["status", "request", "planRevision"]);
    return {
      status,
      request: decodeGraphReadRequest(o.request),
      planRevision: integer(o.planRevision, 1),
    };
  }
  const o = closed(v, ["status", "error"]);
  literal(o.status, "unavailable");
  return { status: "unavailable", error: noEffect(o.error) };
}
function correlate(v: {
  request: CurrentRequest;
  workspaceId: string;
  epoch: string;
  context: ControlContext;
  task: CurrentTask | null;
}) {
  // A requested task without a live record (retained-only history) may answer
  // with task: null while its context reports unavailable for that same task.
  const taskMatches = v.task
    ? v.task.id === v.request.taskId
    : v.request.taskId === null || v.context.status === "unavailable";
  if (
    !taskMatches ||
    controlWorkspace(v.context) !== v.workspaceId ||
    controlTask(v.context) !== v.request.taskId
  )
    invalid();
  if (v.context.status === "available") {
    const c = v.context.version;
    if (
      c.epoch !== v.epoch ||
      !!c.task !== !!v.task ||
      (v.task &&
        (c.task?.revision !== v.task.revision ||
          c.task.identity !== v.task.identity ||
          c.task.kind !== v.task.kind))
    )
      invalid();
  }
}
export function decodeCurrentView(v: unknown): CurrentView {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, [
    "request",
    "workspaceId",
    "epoch",
    "committedSeq",
    "context",
    "task",
    "roles",
    "readablePlan",
    "savedGraph",
  ]);
  const result: CurrentView = {
    request: decodeCurrentRequest(o.request),
    workspaceId: decodeId(o.workspaceId),
    epoch: decodeId(o.epoch),
    committedSeq: decodeSequence(o.committedSeq),
    context: decodeControlContext(o.context),
    task: nullable(o.task, currentTask),
    roles: decodeCurrentRoles(o.roles),
    savedGraph: savedGraph(o.savedGraph),
    readablePlan: nullable(o.readablePlan, (v) => {
      const p = closed(v, ["source", "text", "editable", "coverage"]);
      const coverage = decodeCoverage(p.coverage),
        editable = bool(p.editable);
      if (
        editable &&
        (coverage.redacted ||
          coverage.observed !== "complete" ||
          coverage.source !== "complete" ||
          coverage.omissions.length)
      )
        invalid();
      return {
        source: literal(p.source, "current-v1"),
        text: text(p.text, 32768),
        editable,
        coverage,
      };
    }),
  };
  correlate(result);
  if (!!result.task !== !!result.readablePlan) invalid();
  const saved = result.savedGraph;
  if (
    saved.status === "saved" &&
    (saved.request.storeId !== result.request.storeId ||
      saved.request.scope.kind !== "task" ||
      saved.request.scope.id !== result.task?.id ||
      saved.request.snapshotSeq !== result.committedSeq ||
      (result.context.status === "available" &&
        (saved.request.graph.sha256 !==
          result.context.version.task?.graphIdentity ||
          saved.request.graph.revision !==
            result.context.version.task?.graphRevision)))
  )
    invalid();
  if (saved.status === "unavailable" && result.context.status === "available")
    invalid();
  return result;
}
export function decodeCurrentChanges(v: unknown): CurrentChanges {
  canonicalJson({ kind: "ok", value: v }, LIMITS.pageBytes);
  const o = closed(v, [
    "request",
    "workspaceId",
    "epoch",
    "committedSeq",
    "context",
    "task",
    "observation",
    "text",
    "git",
    "coverage",
  ]);
  const f = closed(o.observation, [
    "identity",
    "complete",
    "checkoutGeneration",
  ]);
  const result: CurrentChanges = {
    request: decodeCurrentChangesRequest(o.request),
    workspaceId: decodeId(o.workspaceId),
    epoch: decodeId(o.epoch),
    committedSeq: decodeSequence(o.committedSeq),
    context: decodeControlContext(o.context),
    task: currentTask(o.task),
    observation: {
      identity: decodeHash(f.identity),
      complete: bool(f.complete),
      checkoutGeneration: integer(f.checkoutGeneration, 0),
    },
    text: text(o.text, 128 * 1024),
    git: bool(o.git),
    coverage: decodeCoverage(o.coverage),
  };
  correlate(result);
  if (result.context.status === "available") {
    const c = result.context.version;
    if (
      c.observation.identity !== result.observation.identity ||
      c.observation.complete !== result.observation.complete ||
      c.checkoutGeneration !== result.observation.checkoutGeneration
    )
      invalid();
  }
  return result;
}
