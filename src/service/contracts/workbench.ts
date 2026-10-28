/** Finite, authenticated workbench API. Ordinary chat is not task admission. */
import {
  bool,
  canonicalJson,
  closed,
  decodeId,
  integer,
  list,
  nullable,
  oneOf,
  text,
} from "./core.ts";
import { type ChoiceVersion, decodeChoiceVersion } from "./models.ts";

export type WorkbenchRead =
  | { kind: "conversations" }
  | { kind: "task-origin"; taskId: string }
  | { kind: "conversation"; id: string; before: string | null }
  | { kind: "files"; path: string }
  | { kind: "file"; path: string }
  | { kind: "directories"; path: string }
  | { kind: "projects" };
export type WorkbenchCommand =
  | {
      kind: "link-task";
      commandId: string;
      epoch: string;
      taskId: string;
      conversationId: string;
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
}
export interface ChatSummary {
  id: string;
  title: string;
  head: string;
  status: ChatStatus;
  updatedAt: number;
}
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
}
export type WorkbenchResult =
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
  if (kind === "link-task") {
    const o = closed(v, [
      "kind",
      "commandId",
      "epoch",
      "taskId",
      "conversationId",
    ]);
    return {
      kind,
      commandId: decodeId(o.commandId),
      epoch: decodeId(o.epoch),
      taskId: decodeId(o.taskId),
      conversationId: decodeId(o.conversationId),
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
  const o = closed(v, ["id", "epoch", "status", "items", "notice"]);
  return {
    id: decodeId(o.id),
    epoch: decodeId(o.epoch),
    status: oneOf(o.status, statuses),
    notice: text(o.notice, 1024),
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
  const o = closed(v, ["id", "title", "head", "status", "updatedAt"]);
  return {
    id: decodeId(o.id),
    title: text(o.title, 512, true),
    head: decodeId(o.head),
    status: oneOf(o.status, statuses),
    updatedAt: integer(o.updatedAt, 0),
  };
}
export function decodeWorkbenchResult(v: unknown): WorkbenchResult {
  // A complete finite reply fits the existing page ceiling. No arbitrary file body.
  canonicalJson(v, 512 * 1024);
  const kind = Object.getOwnPropertyDescriptor(v ?? {}, "kind")?.value;
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
