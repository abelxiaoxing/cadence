/** Finite, authenticated workbench API. Ordinary chat is not task admission. */
import {
  bool,
  ContractError,
  canonicalJson,
  closed,
  decodeHash,
  decodeId,
  integer,
  list,
  nullable,
  oneOf,
  text,
} from "./core.ts";
import { type ChoiceVersion, decodeChoiceVersion } from "./models.ts";

import {
  decodeWorkflowProposal,
  decodeWorkflowRequest,
  decodeWorkflowResponse,
  decodeWorkflowRun,
  WORKFLOW_LIMITS,
  type WorkflowProposal,
  type WorkflowRequest,
  type WorkflowResponse,
  type WorkflowRun,
} from "./workflow.ts";

export interface CadenceConversation {
  id: string;
  revision: number;
  enabled: boolean;
  head: string | null;
  proposal: WorkflowProposal | null;
  runs: string[];
  /** Present only in a read projection of an unusable retained record: every
   * command for that conversation refuses; nothing is inferred or repaired.
   * Never persisted. */
  notice?: string;
}
export function decodeCadenceConversation(v: unknown): CadenceConversation {
  const degraded =
    v !== null && typeof v === "object" && Object.hasOwn(v, "notice");
  const o = closed(v, [
    "id",
    "revision",
    "enabled",
    "head",
    "proposal",
    "runs",
    ...(degraded ? ["notice"] : []),
  ]);
  return {
    id: decodeId(o.id),
    revision: integer(o.revision, 0),
    enabled: bool(o.enabled),
    head: nullable(o.head, decodeId),
    proposal: nullable(o.proposal, decodeWorkflowProposal),
    runs: list(o.runs, 200, decodeId),
    ...(degraded ? { notice: text(o.notice, 1024, true) } : {}),
  };
}
/** Browser conversation that owns an active workflow; native runs have none. */
export interface WorkflowLink {
  runId: string;
  conversationId: string;
}
export type WorkbenchRead =
  | { kind: "cadence-conversation"; id: string }
  | { kind: "workflow-active" }
  | { kind: "workflow-history"; after: string | null; scan?: string }
  | { kind: "workflow-detail"; id: string; stepId: string }
  | { kind: "workflow-transcript"; id: string; stepId: string }
  | { kind: "workflow"; id: string }
  | { kind: "conversations" }
  | { kind: "task-origin"; taskId: string }
  | { kind: "conversation"; id: string; before: string | null }
  | { kind: "files"; path: string }
  | { kind: "file"; path: string }
  | { kind: "directories"; path: string }
  | { kind: "projects" };
export type WorkbenchCommand =
  | {
      kind: "cadence-exit";
      commandId: string;
      conversationId: string;
      head: string | null;
      revision: number;
    }
  | { kind: "restore-model"; commandId: string; epoch: string }
  | {
      kind: "cadence-send";
      commandId: string;
      conversationId: string;
      head: string | null;
      text: string;
      model: ChoiceVersion;
      revision: number;
      intent: "message" | "enter" | "exit";
    }
  | {
      kind: "cadence-prepare";
      commandId: string;
      conversationId: string;
      revision: number;
      proposalId: string;
      digest: string;
    }
  | {
      kind: "cadence-approve";
      commandId: string;
      conversationId: string;
      revision: number;
      proposalId: string;
      digest: string;
      grant: string;
    }
  | { kind: "workflow-cancel"; commandId: string; epoch: string; runId: string }
  | {
      kind: "workflow";
      commandId: string;
      epoch: string;
      request: WorkflowRequest;
    }
  | {
      kind: "send";
      commandId: string;
      conversationId: string;
      head: string | null;
      text: string;
      model: ChoiceVersion;
    }
  | {
      kind: "interrupt";
      commandId: string;
      conversationId: string;
      turnId: string;
      epoch: string;
    }
  | { kind: "open-project"; commandId: string; path: string; epoch: string };
export type ChatStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "timeout"
  | "unknown";
export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  name: string;
  args: string;
  error: boolean;
}
export interface ChatTurn {
  id: string;
  epoch: string;
  status: ChatStatus;
  items: ChatItem[];
  notice: string;
  /** Content kinds observed and not retained; never written into `notice`.
   * `other` is a block of a type Cadence does not recognize. */
  omitted: { thinking: boolean; media: boolean; other: boolean };
}
export interface ChatSummary {
  id: string;
  title: string;
  head: string;
  status: ChatStatus;
  updatedAt: number;
  cadence?: boolean;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export type WorkbenchResult =
  | { kind: "workflow-history-progress"; after: string | null; scan: string }
  | {
      kind: "workflow-history";
      entries: { id: string; run: WorkflowRun | null }[];
      next: string | null;
    }
  | {
      kind: "workflow-transcript";
      runId: string;
      stepId: string;
      turn: ChatTurn | null;
    }
  | { kind: "cadence-conversation"; state: CadenceConversation }
  | {
      kind: "workflow-active";
      runs: WorkflowRun[];
      /** At most one link per listed run; set by the workbench composition. */
      links?: WorkflowLink[];
    }
  | {
      kind: "cadence-grant";
      commandId: string;
      grant: string;
      expiresAt: number;
      revision: number;
      proposal: WorkflowProposal;
    }
  | { kind: "workflow"; commandId: string | null; response: WorkflowResponse }
  | { kind: "task-origin"; taskId: string; conversationId: string | null }
  | { kind: "conversations"; entries: ChatSummary[] }
  | {
      kind: "conversation";
      summary: ChatSummary | null;
      turns: ChatTurn[];
      before: string | null;
    }
  | {
      kind: "files" | "directories";
      path: string;
      parent: string | null;
      entries: FileEntry[];
      limited: boolean;
    }
  | { kind: "file"; path: string; text: string; limited: boolean }
  | { kind: "projects"; entries: { path: string; current: boolean }[] }
  | { kind: "accepted"; commandId: string }
  | { kind: "project"; commandId: string; path: string; link: string };
export interface WorkbenchPort {
  read(request: WorkbenchRead): WorkbenchResult;
  command(
    request: WorkbenchCommand,
    caller?: {
      attachmentId: string;
      authority: "browser" | "local";
      accessGeneration: number;
    },
  ): WorkbenchResult | Promise<WorkbenchResult>;
}
const statuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "timeout",
  "unknown",
] as const;
export function decodeWorkbenchRead(v: unknown): WorkbenchRead {
  const kind = Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value;
  switch (kind) {
    case "cadence-conversation": {
      const o = closed(v, ["kind", "id"]);
      return { kind, id: decodeId(o.id) };
    }
    case "workflow-history": {
      const continued = Object.hasOwn(v as object, "scan");
      const o = closed(v, ["kind", "after", ...(continued ? ["scan"] : [])]);
      return {
        kind,
        after: nullable(o.after, decodeId),
        ...(continued ? { scan: decodeId(o.scan) } : {}),
      };
    }
    case "workflow-active":
      closed(v, ["kind"]);
      return { kind };
    case "workflow-transcript":
    case "workflow-detail": {
      const o = closed(v, ["kind", "id", "stepId"]);
      return { kind, id: decodeId(o.id), stepId: text(o.stepId, 160, true) };
    }
    case "workflow": {
      const o = closed(v, ["kind", "id"]);
      return { kind, id: decodeId(o.id) };
    }
    case "conversations":
    case "projects":
      closed(v, ["kind"]);
      return { kind };
    case "task-origin": {
      const o = closed(v, ["kind", "taskId"]);
      return { kind, taskId: decodeId(o.taskId) };
    }
    case "conversation": {
      const o = closed(v, ["kind", "id", "before"]);
      return { kind, id: decodeId(o.id), before: nullable(o.before, decodeId) };
    }
    default: {
      const o = closed(v, ["kind", "path"]);
      return {
        kind: oneOf(o.kind, ["files", "file", "directories"]),
        path: text(o.path, 4096),
      };
    }
  }
}
export function decodeWorkbenchCommand(v: unknown): WorkbenchCommand {
  const kind = Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value;
  if (kind === "restore-model" || kind === "workflow-cancel") {
    const o = closed(
      v,
      kind === "restore-model"
        ? ["kind", "commandId", "epoch"]
        : ["kind", "commandId", "epoch", "runId"],
    );
    const base = { commandId: decodeId(o.commandId), epoch: decodeId(o.epoch) };
    return kind === "restore-model"
      ? { kind, ...base }
      : { kind, ...base, runId: decodeId(o.runId) };
  }
  if (kind === "cadence-exit") {
    const o = closed(v, [
      "kind",
      "commandId",
      "conversationId",
      "head",
      "revision",
    ]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      conversationId: decodeId(o.conversationId),
      head: nullable(o.head, decodeId),
      revision: integer(o.revision, 0),
    };
  }
  if (kind === "cadence-send") {
    const o = closed(v, [
      "kind",
      "commandId",
      "conversationId",
      "head",
      "text",
      "model",
      "revision",
      "intent",
    ]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      conversationId: decodeId(o.conversationId),
      head: nullable(o.head, decodeId),
      text: text(o.text, 16384, true),
      model: decodeChoiceVersion(o.model),
      revision: integer(o.revision, 0),
      intent: oneOf(o.intent, ["message", "enter", "exit"]),
    };
  }
  if (kind === "cadence-prepare" || kind === "cadence-approve") {
    const keys = [
      "kind",
      "commandId",
      "conversationId",
      "revision",
      "proposalId",
      "digest",
    ];
    const o = closed(v, kind === "cadence-approve" ? [...keys, "grant"] : keys);
    const base = {
      commandId: decodeId(o.commandId),
      conversationId: decodeId(o.conversationId),
      revision: integer(o.revision, 0),
      proposalId: decodeId(o.proposalId),
      digest: decodeHash(o.digest),
    };
    return kind === "cadence-prepare"
      ? { kind, ...base }
      : { kind, ...base, grant: decodeId(o.grant) };
  }
  if (kind === "workflow") {
    const o = closed(v, ["kind", "commandId", "epoch", "request"]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      epoch: decodeId(o.epoch),
      request: decodeWorkflowRequest(o.request),
    };
  }

  if (kind === "send") {
    const o = closed(v, [
      "kind",
      "commandId",
      "conversationId",
      "head",
      "text",
      "model",
    ]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      conversationId: decodeId(o.conversationId),
      head: nullable(o.head, decodeId),
      text: text(o.text, 16 * 1024, true),
      model: decodeChoiceVersion(o.model),
    };
  }
  if (kind === "interrupt") {
    const o = closed(v, [
      "kind",
      "commandId",
      "conversationId",
      "turnId",
      "epoch",
    ]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      conversationId: decodeId(o.conversationId),
      turnId: decodeId(o.turnId),
      epoch: decodeId(o.epoch),
    };
  }
  const o = closed(v, ["kind", "commandId", "path", "epoch"]);
  return {
    kind: oneOf(o.kind, ["open-project"]),
    commandId: decodeId(o.commandId),
    path: text(o.path, 4096, true),
    epoch: decodeId(o.epoch),
  };
}
export function decodeChatTurn(v: unknown): ChatTurn {
  // Turns saved before `omitted` existed lack it; their flags read as unobserved.
  const keys = ["id", "epoch", "status", "items", "notice"];
  const current =
    v !== null && typeof v === "object" && Object.hasOwn(v, "omitted");
  const o = closed(v, current ? [...keys, "omitted"] : keys);
  const omitted = current
    ? closed(o.omitted, ["thinking", "media", "other"])
    : null;
  return {
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    status: oneOf(o.status, statuses),
    notice: text(o.notice, 1024),
    omitted: {
      thinking: omitted ? bool(omitted.thinking) : false,
      media: omitted ? bool(omitted.media) : false,
      other: omitted ? bool(omitted.other) : false,
    },
    items: list(o.items, 256, (v) => {
      const i = closed(v, ["id", "role", "text", "name", "args", "error"]);
      return {
        id: text(i.id, 160, true),
        role: oneOf(i.role, ["user", "assistant", "tool"]),
        text: text(i.text, 256 * 1024),
        name: text(i.name, 128),
        args: text(i.args, 64 * 1024),
        error: bool(i.error),
      };
    }),
  };
}
export function decodeChatSummary(v: unknown): ChatSummary {
  const modern =
    v !== null && typeof v === "object" && Object.hasOwn(v, "cadence");
  const o = closed(v, [
    "id",
    "title",
    "head",
    "status",
    "updatedAt",
    ...(modern ? ["cadence"] : []),
  ]);
  return {
    id: decodeId(o.id),
    title: text(o.title, 512, true),
    head: decodeId(o.head),
    status: oneOf(o.status, statuses),
    updatedAt: integer(o.updatedAt, 0),
    ...(modern ? { cadence: bool(o.cadence) } : {}),
  };
}
export function decodeWorkbenchResult(v: unknown): WorkbenchResult {
  canonicalJson(v, 512 * 1024);
  const k = Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value;
  if (k === "workflow-transcript") {
    const o = closed(v, ["kind", "runId", "stepId", "turn"]);
    return {
      kind: k,
      runId: decodeId(o.runId),
      stepId: text(o.stepId, 160, true),
      turn: nullable(o.turn, decodeChatTurn),
    };
  }
  if (k === "cadence-conversation") {
    const o = closed(v, ["kind", "state"]);
    return { kind: k, state: decodeCadenceConversation(o.state) };
  }
  if (k === "workflow-history-progress") {
    const o = closed(v, ["kind", "after", "scan"]);
    return {
      kind: k,
      after: nullable(o.after, decodeId),
      scan: decodeId(o.scan),
    };
  }
  if (k === "workflow-history") {
    const o = closed(v, ["kind", "entries", "next"]);
    const entries = list(o.entries, WORKFLOW_LIMITS.historyPage, (v) => {
      const e = closed(v, ["id", "run"]);
      const id = decodeId(e.id),
        run = nullable(e.run, decodeWorkflowRun);
      if (run && run.id !== id) throw new ContractError("invalid");
      return { id, run };
    });
    const next = nullable(o.next, decodeId);
    if (
      new Set(entries.map((e) => e.id)).size !== entries.length ||
      (next !== null && next !== entries.at(-1)?.id)
    )
      throw new ContractError("invalid");
    return { kind: k, entries, next };
  }
  if (k === "workflow-active") {
    const linked =
      v !== null && typeof v === "object" && Object.hasOwn(v, "links");
    const o = closed(v, ["kind", "runs", ...(linked ? ["links"] : [])]);
    const runs = list(o.runs, 4, decodeWorkflowRun);
    const links = linked
      ? list(o.links, 4, (value) => {
          const l = closed(value, ["runId", "conversationId"]);
          return {
            runId: decodeId(l.runId),
            conversationId: decodeId(l.conversationId),
          };
        })
      : [];
    if (
      new Set(links.map((l) => l.runId)).size !== links.length ||
      links.some((l) => !runs.some((r) => r.id === l.runId))
    )
      throw new ContractError("invalid");
    return { kind: k, runs, links };
  }
  if (k === "cadence-grant") {
    const o = closed(v, [
      "kind",
      "commandId",
      "grant",
      "expiresAt",
      "revision",
      "proposal",
    ]);
    return {
      kind: k,
      commandId: decodeId(o.commandId),
      grant: decodeId(o.grant),
      expiresAt: integer(o.expiresAt, 0),
      revision: integer(o.revision, 0),
      proposal: decodeWorkflowProposal(o.proposal),
    };
  }
  // A complete finite reply fits the existing page ceiling. No arbitrary file body.
  const kind = Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value;
  if (kind === "workflow") {
    const o = closed(v, ["kind", "commandId", "response"]);
    return {
      kind,
      commandId: nullable(o.commandId, decodeId),
      response: decodeWorkflowResponse(o.response),
    };
  }
  if (kind === "task-origin") {
    const o = closed(v, ["kind", "taskId", "conversationId"]);
    return {
      kind,
      taskId: decodeId(o.taskId),
      conversationId: nullable(o.conversationId, decodeId),
    };
  }
  if (kind === "conversations") {
    const o = closed(v, ["kind", "entries"]);
    return { kind, entries: list(o.entries, 200, decodeChatSummary) };
  }
  if (kind === "conversation") {
    const o = closed(v, ["kind", "summary", "turns", "before"]);
    return {
      kind,
      summary: nullable(o.summary, decodeChatSummary),
      turns: list(o.turns, 20, decodeChatTurn),
      before: nullable(o.before, decodeId),
    };
  }
  if (kind === "files" || kind === "directories") {
    const o = closed(v, ["kind", "path", "parent", "entries", "limited"]);
    return {
      kind,
      path: text(o.path, 4096),
      parent: nullable(o.parent, (p) => text(p, 4096)),
      limited: bool(o.limited),
      entries: list(o.entries, 200, (v) => {
        const e = closed(v, ["name", "path", "directory"]);
        return {
          name: text(e.name, 1024, true),
          path: text(e.path, 4096, true),
          directory: bool(e.directory),
        };
      }),
    };
  }
  if (kind === "file") {
    const o = closed(v, ["kind", "path", "text", "limited"]);
    return {
      kind,
      path: text(o.path, 4096),
      text: text(o.text, 256 * 1024),
      limited: bool(o.limited),
    };
  }
  if (kind === "projects") {
    const o = closed(v, ["kind", "entries"]);
    return {
      kind,
      entries: list(o.entries, 128, (v) => {
        const e = closed(v, ["path", "current"]);
        return { path: text(e.path, 4096, true), current: bool(e.current) };
      }),
    };
  }
  if (kind === "accepted") {
    const o = closed(v, ["kind", "commandId"]);
    return { kind, commandId: decodeId(o.commandId) };
  }
  const o = closed(v, ["kind", "commandId", "path", "link"]);
  return {
    kind: oneOf(o.kind, ["project"]),
    commandId: decodeId(o.commandId),
    path: text(o.path, 4096, true),
    link: text(o.link, 8192, true),
  };
}
