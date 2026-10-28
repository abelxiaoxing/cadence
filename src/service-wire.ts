import { closed, oneOf } from "./service/contracts/core.ts";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
} from "./service/contracts/workbench.ts";
/** Portable finite HTTP/WS route owner. Common DTO semantics stay in service-contract. */
import {
  ContractError,
  canonicalJson,
  decodeActiveRuns,
  decodeCancel,
  decodeCheckObligations,
  decodeChooseModelRequest,
  decodeCommand,
  decodeCurrentChanges,
  decodeCurrentChangesRequest,
  decodeCurrentRequest,
  decodeCurrentView,
  decodeCursor,
  decodeDetailReadResult,
  decodeEntityReadRequest,
  decodeEntityReadResult,
  decodeExportRequest,
  decodeGraphReadRequest,
  decodeGraphReadResult,
  decodeHistoryReadResult,
  decodeId,
  decodeListRequest,
  decodeLiveEvent,
  decodeModelCatalog,
  decodeModelChoiceState,
  decodePreflight,
  decodePreflightRequest,
  decodeReceipt,
  decodeReceiptLookup,
  decodeReply,
  decodeScope,
  decodeSearchPage,
  decodeSessionBootstrap,
  decodeSnapshot,
  decodeWorkspaceBootstrap,
  LIMITS,
  type LiveEvent,
  type Scope,
  type Snapshot,
  utf8Bytes,
} from "./service-contract.ts";

export const HTTP_ROUTES = {
  session: "/api/v1/session",
  workbenchRead: "/api/v1/workbench/read",
  workbenchCommand: "/api/v1/workbench/command",
  current: "/api/v1/current",
  currentChanges: "/api/v1/current-changes",
  activeRuns: "/api/v1/active-runs",
  models: "/api/v1/models",
  chooseModel: "/api/v1/model-choice",
  workspace: "/api/v1/workspace",
  tasks: "/api/v1/tasks",
  runs: "/api/v1/runs",
  messages: "/api/v1/messages",
  tools: "/api/v1/tools",
  contents: "/api/v1/contents",
  events: "/api/v1/history-events",
  checks: "/api/v1/checks",
  changes: "/api/v1/changes",
  reviews: "/api/v1/reviews",
  checkObligations: "/api/v1/check-obligations",
  entity: "/api/v1/entity",
  graph: "/api/v1/graph",
  snapshot: "/api/v1/snapshot",
  detail: "/api/v1/details",
  search: "/api/v1/search",
  export: "/api/v1/export",
  download: "/api/v1/download",
  preflight: "/api/v1/preflight",
  command: "/api/v1/commands",
  cancel: "/api/v1/cancel",
  receipt: "/api/v1/receipt",
  detach: "/api/v1/detach",
} as const;
export const WS_PATH = "/api/v1/events";
export type HttpOperation = keyof typeof HTTP_ROUTES;
const pageReaders = [
  "tasks",
  "runs",
  "messages",
  "tools",
  "contents",
  "events",
  "checks",
  "changes",
  "reviews",
] as const;
/** Encoded HTTP Reply category, including wire whitespace/escaping. Graph data
 * is a control document; only its proof-only branch shares the page ceiling. */
export function httpOutputLimit(
  operation: HttpOperation,
  reply?: unknown,
): number {
  if (
    (pageReaders as readonly string[]).includes(operation) ||
    operation === "detail" ||
    operation === "search" ||
    operation === "entity" ||
    operation === "current" ||
    operation === "currentChanges" ||
    operation === "activeRuns" ||
    operation === "workspace" ||
    operation === "models" ||
    operation === "chooseModel" ||
    operation === "workbenchRead" ||
    operation === "workbenchCommand"
  )
    return LIMITS.pageBytes;
  if (operation === "graph") {
    const kind = Object.getOwnPropertyDescriptor(reply ?? {}, "kind")?.value,
      value = Object.getOwnPropertyDescriptor(reply ?? {}, "value")?.value;
    if (
      kind === "ok" &&
      Object.getOwnPropertyDescriptor(value ?? {}, "kind")?.value === "progress"
    )
      return LIMITS.pageBytes;
  }
  return LIMITS.controlBytes;
}
export function mutation(operation: HttpOperation): boolean {
  return [
    "preflight",
    "command",
    "cancel",
    "detach",
    "chooseModel",
    "workbenchCommand",
  ].includes(operation);
}
export function decodeHttpInput(operation: HttpOperation, value: unknown) {
  switch (operation) {
    case "workbenchRead":
      return decodeWorkbenchRead(value);
    case "workbenchCommand":
      return decodeWorkbenchCommand(value);
    case "session":
    case "models":
    case "activeRuns":
    case "workspace":
    case "detach":
      if (value !== null) throw new ContractError("invalid");
      return null;
    case "tasks":
    case "runs":
    case "messages":
    case "tools":
    case "contents":
    case "events":
    case "checks":
    case "changes":
    case "reviews": {
      const request = decodeListRequest(value);
      if (request.reader !== operation) throw new ContractError("invalid");
      return request;
    }
    case "current":
      return decodeCurrentRequest(value);
    case "currentChanges":
      return decodeCurrentChangesRequest(value);
    case "checkObligations":
    case "receipt":
      return decodeId(value);
    case "entity":
      return decodeEntityReadRequest(value);
    case "graph":
      return decodeGraphReadRequest(value);
    case "snapshot":
      return decodeScope(value);
    case "detail":
    case "search":
      return decodeCursor(value);
    case "export":
    case "download":
      return decodeExportRequest(value);
    case "chooseModel":
      return decodeChooseModelRequest(value);
    case "preflight":
      return decodePreflightRequest(value);
    case "command":
      return decodeCommand(value);
    case "cancel":
      return decodeCancel(value);
  }
}
export function decodeHttpOutput(
  operation: HttpOperation,
  value: unknown,
): unknown {
  if ((pageReaders as readonly string[]).includes(operation))
    return decodeReply(value, decodeHistoryReadResult);
  switch (operation) {
    case "workbenchRead":
    case "workbenchCommand":
      return decodeReply(value, decodeWorkbenchResult);
    case "current":
      return decodeReply(value, decodeCurrentView);
    case "currentChanges":
      return decodeReply(value, decodeCurrentChanges);
    case "activeRuns":
      return decodeReply(value, decodeActiveRuns);
    case "models":
      return decodeReply(value, decodeModelCatalog);
    case "chooseModel":
      return decodeReply(value, decodeModelChoiceState);
    case "session":
      return decodeReply(value, decodeSessionBootstrap);
    case "workspace":
      return decodeReply(value, decodeWorkspaceBootstrap);
    case "checkObligations":
      return decodeReply(value, decodeCheckObligations);
    case "entity":
      return decodeReply(value, decodeEntityReadResult);
    case "graph":
      return decodeReply(value, decodeGraphReadResult);
    case "snapshot":
      return decodeReply(value, decodeSnapshot);
    case "detail":
      return decodeReply(value, decodeDetailReadResult);
    case "search":
      return decodeReply(value, decodeSearchPage);
    case "preflight":
      return decodeReply(value, decodePreflight);
    case "command":
    case "cancel":
      return decodeReply(value, decodeReceipt);
    case "receipt":
      return decodeReceiptLookup(value);
    case "detach":
      return decodeReply(value, (v) => {
        if (v !== null) throw new ContractError("invalid");
        return null;
      });
    default:
      throw new ContractError("invalid");
  }
}
/** Body transport and POST security are independent of execution semantics. */
export function readonlyBody(operation: HttpOperation): boolean {
  const operations: readonly HttpOperation[] = [
    ...pageReaders,
    "workbenchRead",
    "current",
    "currentChanges",
    "checkObligations",
    "entity",
    "graph",
    "snapshot",
    "detail",
    "search",
    "export",
    "download",
    "receipt",
  ];
  return operations.includes(operation);
}
function queryUrl(operation: HttpOperation, input: unknown): string {
  const path = HTTP_ROUTES[operation];
  return input === null || mutation(operation)
    ? path
    : `${path}?request=${encodeURIComponent(canonicalJson(input))}`;
}
export function wireUrl(operation: HttpOperation, value: unknown): string {
  const result = queryUrl(operation, decodeHttpInput(operation, value));
  if (utf8Bytes(result) > LIMITS.headerBytes)
    throw new ContractError("oversize");
  return result;
}
/** Select once BEFORE sending. Reserve header headroom; never retry a failed GET. */
export function wireRequest(
  operation: HttpOperation,
  value: unknown,
): {
  path: string;
  method: "GET" | "POST";
  body?: string;
} {
  const input = decodeHttpInput(operation, value);
  const hasNavigation =
    input !== null &&
    typeof input === "object" &&
    Object.hasOwn(input, "navigation");
  const path = hasNavigation
    ? HTTP_ROUTES[operation]
    : queryUrl(operation, input);
  if (
    mutation(operation) ||
    (readonlyBody(operation) &&
      (hasNavigation || utf8Bytes(path) > LIMITS.headerBytes / 4))
  )
    return {
      path: HTTP_ROUTES[operation],
      method: "POST",
      body: canonicalJson(input),
    };
  return { path, method: "GET" };
}
export function assertRequestTarget(target: string): void {
  // Raw request-target is ASCII with strict UTF-8 percent encoding, never a URL
  // parser's normalized authority/path or replacement-character credential.
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    /[\\#\s\u007f-\uffff]/u.test(target) ||
    utf8Bytes(target) > LIMITS.headerBytes
  )
    throw new ContractError("invalid");
  try {
    decodeURIComponent(target);
  } catch {
    throw new ContractError("invalid");
  }
}
export function readRoute(
  target: string,
  method: string,
):
  | { operation: HttpOperation; input: string | null; source: "query" | "body" }
  | undefined {
  assertRequestTarget(target);
  const [path, query] = target.split("?");
  if (target.split("?").length > 2) throw new ContractError("invalid");
  const operation = (Object.keys(HTTP_ROUTES) as HttpOperation[]).find(
    (key) => HTTP_ROUTES[key] === path,
  );
  if (!operation) return undefined;
  const body =
    method === "POST" && (mutation(operation) || readonlyBody(operation));
  if (!body && (method !== "GET" || mutation(operation)))
    throw new ContractError("invalid");
  if (body && query !== undefined) throw new ContractError("invalid");
  const params = new URLSearchParams(query);
  if (
    [...params.keys()].some((key) => key !== "request") ||
    params.getAll("request").length > 1
  )
    throw new ContractError("invalid");
  if (mutation(operation) && query !== undefined)
    throw new ContractError("invalid");
  // Keep encoded JSON opaque until HTTP authentication succeeds.
  return {
    operation,
    input: params.get("request"),
    source: body ? "body" : "query",
  };
}
export type SocketInput =
  | { kind: "subscribe" | "resync"; scope: Scope }
  | { kind: "ping" };
export type SocketOutput =
  | { kind: "snapshot"; snapshot: Snapshot }
  | { kind: "event"; event: LiveEvent }
  | { kind: "resync" };
export function decodeSocketInput(value: unknown): SocketInput {
  canonicalJson(value, LIMITS.wsClientFrameBytes);
  const kind = oneOf(Object.getOwnPropertyDescriptor(value, "kind")?.value, [
    "subscribe",
    "resync",
    "ping",
  ]);
  if (kind === "ping") {
    closed(value, ["kind"]);
    return { kind };
  }
  const o = closed(value, ["kind", "scope"]);
  return { kind, scope: decodeScope(o.scope) };
}
export function decodeSocketOutput(value: unknown): SocketOutput {
  canonicalJson(value, LIMITS.viewerBytes);
  const kind = oneOf(Object.getOwnPropertyDescriptor(value, "kind")?.value, [
    "snapshot",
    "event",
    "resync",
  ]);
  if (kind === "snapshot")
    return {
      kind,
      snapshot: decodeSnapshot(closed(value, ["kind", "snapshot"]).snapshot),
    };
  if (kind === "event")
    return {
      kind,
      event: decodeLiveEvent(closed(value, ["kind", "event"]).event),
    };
  closed(value, ["kind"]);
  return { kind };
}
