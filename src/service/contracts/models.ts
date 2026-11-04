import {
  bool,
  canonicalJson,
  closed,
  decodeId,
  integer,
  invalid,
  LIMITS,
  list,
  nullable,
  oneOf,
  text,
} from "./core.ts";
import {
  decodeModelSelection,
  decodeModelSelector,
  type ModelSelection,
  type ModelSelector,
  modelApis,
  thinkingLevels,
} from "./domain.ts";

/** A conversation's identity: the Pi session id shared with the terminal. */
export function decodeSessionId(v: unknown): string {
  const s = text(v, 128, true);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(s)) invalid();
  return s;
}

/** A conversation location is not an execution grant or a filesystem sandbox. */
export interface ConversationLocation {
  id: string;
  cwd: string;
}
export interface ConversationContext extends ConversationLocation {
  revision: number;
  model: ModelSelector | null;
}
export interface ExecutionContext {
  cwd: string;
  checkoutRoot: string;
  version: ChoiceVersion;
  model: ModelSelection | null;
}
export function decodeConversationLocation(v: unknown): ConversationLocation {
  const o = closed(v, ["id", "cwd"]);
  return { id: decodeSessionId(o.id), cwd: text(o.cwd, 4096, true) };
}
export function decodeConversationContext(v: unknown): ConversationContext {
  const o = closed(v, ["id", "cwd", "revision", "model"]);
  return {
    id: decodeSessionId(o.id),
    cwd: text(o.cwd, 4096, true),
    revision: integer(o.revision, 0, Number.MAX_SAFE_INTEGER - 1),
    model: nullable(o.model, decodeModelSelector),
  };
}
export function decodeExecutionContext(v: unknown): ExecutionContext {
  const o = closed(v, ["cwd", "checkoutRoot", "version", "model"]);
  return {
    cwd: text(o.cwd, 4096, true),
    checkoutRoot: text(o.checkoutRoot, 4096, true),
    version: decodeChoiceVersion(o.version),
    model: nullable(o.model, decodeModelSelection),
  };
}
export interface ChoiceVersion {
  /** Omitted only by explicit low-level native default-slot requests and retained records. */
  conversation?: ConversationLocation;
  epoch: string;
  accessGeneration: number;
  configRev: number;
  catalogId: string;
}
export interface ModelChoiceState {
  version: ChoiceVersion;
  selected: ModelSelection | null;
}
export interface ModelCandidate {
  images?: boolean;
  provider: string;
  model: string;
  api: ModelSelection["api"] | null;
  thinking: {
    level: ModelSelection["thinking"];
    selectable: boolean;
  }[];
  eligibility: "candidate" | "unsupported" | "auth-unavailable";
}
export interface ModelCatalog extends ModelChoiceState {
  status: "complete" | "capacity";
  entries: ModelCandidate[];
  /** Models left out because a provider/model ID contains a known credential
   * literal or control characters; never their identifiers. */
  withheld: number;
  /** The saved preference that the next Send would install, read only and
   * offered only when it names a selectable entry of this catalog. */
  remembered: ModelSelector | null;
}
export interface ChooseModelRequest {
  expected: ChoiceVersion;
  choice: ModelSelector;
}
export function decodeChoiceVersion(value: unknown): ChoiceVersion {
  const o = closed(value, [
    "epoch",
    "accessGeneration",
    "configRev",
    "catalogId",
    ...(Object.hasOwn(value ?? {}, "conversation") ? ["conversation"] : []),
  ]);
  return {
    ...(o.conversation === undefined
      ? {}
      : { conversation: decodeConversationLocation(o.conversation) }),
    epoch: decodeId(o.epoch),
    accessGeneration: integer(o.accessGeneration, 1),
    configRev: integer(o.configRev, 1),
    catalogId: decodeId(o.catalogId),
  };
}
export function decodeModelChoiceState(value: unknown): ModelChoiceState {
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
  const o = closed(value, ["version", "selected"]);
  return {
    version: decodeChoiceVersion(o.version),
    selected: nullable(o.selected, decodeModelSelection),
  };
}
export function decodeChooseModelRequest(value: unknown): ChooseModelRequest {
  canonicalJson(value);
  const o = closed(value, ["expected", "choice"]);
  return {
    expected: decodeChoiceVersion(o.expected),
    choice: decodeModelSelector(o.choice),
  };
}
export function decodeModelCandidate(value: unknown): ModelCandidate {
  const o = closed(value, [
    "provider",
    "model",
    "api",
    "thinking",
    "eligibility",
    ...(Object.hasOwn(value ?? {}, "images") ? ["images"] : []),
  ]);
  const candidate: ModelCandidate = {
    ...(o.images === undefined ? {} : { images: bool(o.images) }),
    provider: text(o.provider, 128, true),
    model: text(o.model, 256, true),
    api: nullable(o.api, (v) => oneOf(v, modelApis)),
    thinking: list(o.thinking, 7, (v) => {
      const t = closed(v, ["level", "selectable"]);
      return {
        level: oneOf(t.level, thinkingLevels),
        selectable: bool(t.selectable),
      };
    }),
    eligibility: oneOf(o.eligibility, [
      "candidate",
      "unsupported",
      "auth-unavailable",
    ]),
  };
  if (
    new Set(candidate.thinking.map((t) => t.level)).size !==
      candidate.thinking.length ||
    candidate.thinking.some(
      (t) =>
        t.selectable &&
        (candidate.api === null || candidate.eligibility !== "candidate"),
    ) ||
    (candidate.eligibility === "candidate" &&
      !candidate.thinking.some((t) => t.selectable))
  )
    invalid();
  return candidate;
}
/** Whether a catalog offers this exact selector as a selectable choice. */
export function catalogOffers(
  entries: readonly ModelCandidate[],
  selector: ModelSelector,
): boolean {
  return entries.some(
    (e) =>
      e.provider === selector.provider &&
      e.model === selector.model &&
      e.api === selector.api &&
      e.thinking.some((t) => t.selectable && t.level === selector.thinking),
  );
}
export function decodeModelCatalog(value: unknown): ModelCatalog {
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
  const o = closed(value, [
    "version",
    "selected",
    "status",
    "entries",
    "withheld",
    "remembered",
  ]);
  const entries = list(o.entries, LIMITS.maxPageEntries, decodeModelCandidate);
  const remembered = nullable(o.remembered, decodeModelSelector);
  const status = oneOf(o.status, ["complete", "capacity"]);
  const withheld = integer(o.withheld, 0, LIMITS.maxPageEntries);
  if (
    (status === "capacity" && (entries.length || withheld)) ||
    entries.length + withheld > LIMITS.maxPageEntries ||
    new Set(entries.map((e) => canonicalJson([e.provider, e.model]))).size !==
      entries.length ||
    (remembered && !catalogOffers(entries, remembered))
  )
    invalid();
  return {
    version: decodeChoiceVersion(o.version),
    selected: nullable(o.selected, decodeModelSelection),
    status,
    entries,
    withheld,
    remembered,
  };
}
