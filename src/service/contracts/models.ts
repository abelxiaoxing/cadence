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

export interface ChoiceVersion {
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
  ]);
  return {
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
  ]);
  const candidate: ModelCandidate = {
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
export function decodeModelCatalog(value: unknown): ModelCatalog {
  canonicalJson({ kind: "ok", value }, LIMITS.pageBytes);
  const o = closed(value, [
    "version",
    "selected",
    "status",
    "entries",
    "withheld",
  ]);
  const entries = list(o.entries, LIMITS.maxPageEntries, decodeModelCandidate);
  const status = oneOf(o.status, ["complete", "capacity"]);
  const withheld = integer(o.withheld, 0, LIMITS.maxPageEntries);
  if (
    (status === "capacity" && (entries.length || withheld)) ||
    entries.length + withheld > LIMITS.maxPageEntries ||
    new Set(entries.map((e) => canonicalJson([e.provider, e.model]))).size !==
      entries.length
  )
    invalid();
  return {
    version: decodeChoiceVersion(o.version),
    selected: nullable(o.selected, decodeModelSelection),
    status,
    entries,
    withheld,
  };
}
