// Owner-private selected Pi configuration. Never exported through a client DTO.
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import {
  ContractError,
  type ErrorCode,
  LIMITS,
  parseWireJson,
} from "../service-contract.ts";
import { type FileSnapshot, PrivateFiles } from "./private-files.ts";

const CONFIG_BYTES = 1024 * 1024;
const ENTRY_LIMIT = 256;
type Data = Record<string, unknown>;
export type LaunchEnvironment = Readonly<Record<string, string | undefined>>;
export interface PiSource {
  directory: string;
  authPath: string;
  modelsPath: string;
  files: PrivateFiles;
}
export interface PiSnapshot {
  auth: FileSnapshot;
  models?: FileSnapshot;
  credentials: Record<string, Credential>;
  providers: Record<string, Data>;
}
function refuse(): never {
  throw new ContractError("corrupt-selected");
}
export function data(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  if (![null, Object.prototype].includes(Object.getPrototypeOf(value)))
    refuse();
  const out: Data = Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (keys.length > ENTRY_LIMIT) refuse();
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !d || !("value" in d) || !d.enumerable)
      refuse();
    if (["__proto__", "constructor", "prototype"].includes(key)) refuse();
    out[key] = d.value;
  }
  return out;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0")) refuse();
  return value;
}
export function environment(value: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [name, entry] of Object.entries(data(value))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) refuse();
    if (/(?:_FILE|_PATH|_CREDENTIALS)$/.test(name))
      throw new ContractError("unsupported-context");
    // Values are literal, not config templates.
    if (typeof entry !== "string" || entry.includes("\0")) refuse();
    out[name] = entry;
  }
  return out;
}
/** Finite own-data copy; never invokes an environment getter or retains caller mutation. */
export function captureEnvironment(
  value: LaunchEnvironment,
): LaunchEnvironment {
  const out: Record<string, string | undefined> = Object.create(null);
  const names = Reflect.ownKeys(value);
  if (names.length > 4096) throw new ContractError("oversize");
  let bytes = 0;
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(value, name);
    if (
      typeof name !== "string" ||
      !d ||
      !("value" in d) ||
      (d.value !== undefined && typeof d.value !== "string")
    )
      refuse();
    bytes += Buffer.byteLength(name) + Buffer.byteLength(d.value ?? "");
    if (bytes > CONFIG_BYTES) throw new ContractError("oversize");
    out[name] = d.value;
  }
  return Object.freeze(out);
}
export function piSource(
  agentDir: string | undefined,
  home: string,
  cwd: string,
  env: LaunchEnvironment,
): PiSource {
  if (!isAbsolute(home) || !isAbsolute(cwd)) refuse();
  let selected =
    agentDir ?? env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
  if (!selected || selected.includes("\0")) refuse();
  if (selected === "~" || selected.startsWith("~/"))
    selected = home + selected.slice(1);
  selected = resolve(cwd, selected);
  try {
    // Ambient ancestors may be canonical aliases; the selected directory itself may not.
    const directory = join(
      realpathSync(dirname(selected)),
      selected.slice(dirname(selected).length + 1),
    );
    const st = lstatSync(directory);
    if (!st.isDirectory() || st.isSymbolicLink()) refuse();
    // Pi creates its agent directory with the user's umask (0755, or 0775 under
    // umask 002), so its mode is not a Cadence premise; ownership still is.
    const files = new PrivateFiles(directory, false);
    if (!files.directory(directory)) refuse();
    return {
      directory,
      files,
      authPath: join(directory, "auth.json"),
      modelsPath: join(directory, "models.json"),
    };
  } catch (error) {
    throw new PiSourceRefusal(
      {
        file: "agent-directory",
        check: "file",
        field: null,
        reason: fileReason(selected, true),
      },
      error instanceof ContractError ? error.code : "unavailable",
    );
  }
}
/** Validate only inert templates. SDK remains the interpolation owner. */
export function templateNames(value: unknown): string[] {
  const text = string(value);
  if (text.startsWith("!")) throw new ContractError("unsupported-context");
  const names = new Set<string>();
  // Match the installed SDK's template grammar, including invalid braced
  // literals. A regex search would incorrectly discover $NAME inside ${bad$NAME}.
  for (let i = 0; i < text.length; ) {
    const dollar = text.indexOf("$", i);
    if (dollar < 0) break;
    const next = text[dollar + 1];
    if (next === "$" || next === "!") {
      i = dollar + 2;
    } else if (next === "{") {
      const end = text.indexOf("}", dollar + 2);
      if (end < 0) {
        i = dollar + 1;
        continue;
      }
      const name = text.slice(dollar + 2, end);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name);
      i = end + 1;
    } else {
      const name = text.slice(dollar + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
      if (name) names.add(name);
      i = dollar + 1 + (name?.length ?? 0);
    }
  }
  return [...names];
}
/** Which check refused a selected Pi source: the file itself (kind, links,
 * size, owner), its JSON syntax, Cadence's closed schema of the pinned SDK's
 * fields, or the pinned SDK's own model loading. */
export type PiSourceCheck = "file" | "json" | "schema" | "sdk";
export type PiSourceFile = "agent-directory" | "auth.json" | "models.json";
export interface PiSourceProblem {
  file: PiSourceFile;
  check: PiSourceCheck;
  /** A path of JSON keys such as `providers.zai.models[0].compat`, never a value. */
  field: string | null;
  /** Fixed words; never configuration bytes, credentials or OS/SDK text. */
  reason: string;
}
/** A refused Pi source and why, in words that carry none of its values. */
export class PiSourceRefusal extends ContractError {
  constructor(
    readonly problem: PiSourceProblem,
    code: ErrorCode = "corrupt-selected",
  ) {
    super(code);
  }
}
/** A schema refusal at a field, before its file is attached. */
class FieldRefusal extends ContractError {
  constructor(
    readonly field: string,
    readonly reason: string,
    code: ErrorCode = "corrupt-selected",
  ) {
    super(code);
  }
}
function fail(field: string, reason: string, code?: ErrorCode): never {
  throw new FieldRefusal(field, reason, code);
}
/** One key of a refusal's field path. Keys are names (provider and model IDs,
 * header names), not values; a key that is not short printable ASCII is elided. */
function child(at: string, key: string | number): string {
  if (typeof key === "number") return `${at}[${key}]`;
  if (/^[A-Za-z_$][\w$]{0,63}$/.test(key)) return at ? `${at}.${key}` : key;
  return /^[\x21-\x7e]{1,64}$/.test(key) && !/["\\]/.test(key)
    ? `${at}["${key}"]`
    : `${at}[…]`;
}
/** A field check. Shapes stay inspectable so a test can compare them with the
 * pinned SDK's published models.json schema. */
export interface FieldCheck {
  (value: unknown, at: string): void;
  fields?: Readonly<Record<string, FieldCheck>>;
  entries?: FieldCheck;
  items?: FieldCheck;
}
const UNSUPPORTED = "is not a field Cadence's pinned Pi SDK supports";
function object(value: unknown, at: string): Data {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(at, "must be an object");
  if (Reflect.ownKeys(value).length > ENTRY_LIMIT)
    fail(at, `has more than ${ENTRY_LIMIT} entries`);
  try {
    return data(value);
  } catch {
    return fail(at, "must be a plain object without reserved keys");
  }
}
/** A closed object: only the pinned SDK's fields, each with its own check. */
function shape(
  fields: Record<string, FieldCheck>,
  required: readonly string[] = [],
  retired: Readonly<Record<string, string>> = {},
): FieldCheck {
  const check: FieldCheck = (value, at) => {
    const o = object(value, at);
    for (const key of Object.keys(o))
      if (!Object.hasOwn(fields, key))
        fail(
          child(at, key),
          Object.hasOwn(retired, key) ? retired[key] : UNSUPPORTED,
        );
    for (const key of required)
      if (o[key] === undefined) fail(child(at, key), "is required");
    for (const [key, field] of Object.entries(fields))
      if (o[key] !== undefined) field(o[key], child(at, key));
  };
  check.fields = fields;
  return check;
}
function record(entries: FieldCheck): FieldCheck {
  const check: FieldCheck = (value, at) => {
    for (const [key, entry] of Object.entries(object(value, at)))
      entries(entry, child(at, key));
  };
  check.entries = entries;
  return check;
}
function list(items: FieldCheck, maximum = ENTRY_LIMIT): FieldCheck {
  const check: FieldCheck = (value, at) => {
    if (!Array.isArray(value)) fail(at, "must be a list");
    if (value.length > maximum) fail(at, `has more than ${maximum} entries`);
    for (const [i, item] of value.entries()) items(item, child(at, i));
  };
  check.items = items;
  return check;
}
/** A scalar the predicate accepts, or else the object shape. */
function scalarOr(
  scalar: (value: unknown) => boolean,
  objectShape: FieldCheck,
  reason: string,
): FieldCheck {
  const check: FieldCheck = (value, at) => {
    if (scalar(value)) return;
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(at, reason);
    objectShape(value, at);
  };
  check.fields = objectShape.fields;
  return check;
}
const scalar =
  (test: (value: unknown) => boolean, reason: string): FieldCheck =>
  (value, at) => {
    if (!test(value)) fail(at, reason);
  };
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown) => typeof v === "string";
const boolean = scalar((v) => typeof v === "boolean", "must be true or false");
const number = scalar(isNumber, "must be a number");
const positive = scalar(
  (v) => isNumber(v) && (v as number) > 0,
  "must be a number greater than 0",
);
const whole = (maximum = Number.MAX_SAFE_INTEGER) =>
  scalar(
    (v) =>
      Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= maximum,
    maximum === Number.MAX_SAFE_INTEGER
      ? "must be a whole number of at least 1"
      : `must be a whole number from 1 to ${maximum}`,
  );
const nonEmpty = scalar(
  (v) => typeof v === "string" && v !== "" && !v.includes("\0"),
  "must be a non-empty string",
);
const anyString = scalar(isString, "must be a string");
const stringOrNull = scalar(
  (v) => v === null || isString(v),
  "must be a string or null",
);
const numberOrString = scalar(
  (v) => isNumber(v) || isString(v),
  "must be a number or a string",
);
const oneOf = (...values: string[]) =>
  scalar(
    (v) => values.includes(v as string),
    `must be ${values.length === 1 ? "" : "one of "}${values.map((v) => JSON.stringify(v)).join(", ")}`,
  );
/** Free-form provider request JSON, merged by the SDK as given. */
const freeform = scalar(
  (v) => !!v && typeof v === "object" && !Array.isArray(v),
  "must be an object",
);
/** Inert templates only; the SDK remains the interpolation owner. */
const template: FieldCheck = (value, at) => {
  nonEmpty(value, at);
  if ((value as string).startsWith("!"))
    fail(
      at,
      'runs a command ("!…"), which Cadence never runs; use a literal value or $VARIABLE',
      "unsupported-context",
    );
};
const headerValue: FieldCheck = (value, at) => {
  // Selected models.json accepts string headers only. AuthResult null
  // suppression is separately preserved; never coerce null config to a string.
  if (typeof value !== "string" || /[\r\n\0]/.test(value))
    fail(at, "must be a single-line string");
  if (value) template(value, at);
};
const headers: FieldCheck = (value, at) => {
  for (const [name, entry] of Object.entries(object(value, at))) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
      fail(child(at, name), "is not a valid HTTP header name");
    headerValue(entry, child(at, name));
  }
};
headers.entries = headerValue;
const variableValue: FieldCheck = (value, at) => {
  if (typeof value !== "string" || value.includes("\0"))
    fail(at, "must be a string");
};
/** Literal values for named variables; never a file or credentials path. */
const variables: FieldCheck = (value, at) => {
  for (const [name, entry] of Object.entries(object(value, at))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      fail(child(at, name), "is not a valid environment variable name");
    if (/(?:_FILE|_PATH|_CREDENTIALS)$/.test(name))
      fail(
        child(at, name),
        "names a file (*_FILE, *_PATH or *_CREDENTIALS), which Cadence does not pass on",
        "unsupported-context",
      );
    variableValue(entry, child(at, name));
  }
};
variables.entries = variableValue;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const levels = (each: FieldCheck) =>
  shape(Object.fromEntries(LEVELS.map((level) => [level, each])));
const RATES = ["input", "output", "cacheRead", "cacheWrite"];
const rates = Object.fromEntries(RATES.map((rate) => [rate, number]));
const costTiers = list(
  shape({ inputTokensAbove: number, ...rates }, ["inputTokensAbove", ...RATES]),
);
const cost = shape({ ...rates, tiers: costTiers }, RATES);
const strings = list(anyString);
const percentiles = shape(
  Object.fromEntries(["p50", "p75", "p90", "p99"].map((p) => [p, number])),
);
const chatTemplate = record(
  scalarOr(
    (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
    shape(
      {
        $var: oneOf("thinking.enabled", "thinking.effort", "thinking.budget"),
        omitWhenOff: boolean,
      },
      ["$var"],
    ),
    'must be a string, number, true/false, null or a {"$var": …} object',
  ),
);
// The installed SDK's open objects keep any unknown key silently. Close AND
// type-check every field here, exactly the pinned SDK's ProviderCompat set.
const compat = shape(
  {
    ...Object.fromEntries(
      [
        "supportsStore",
        "supportsDeveloperRole",
        "supportsReasoningEffort",
        "supportsUsageInStreaming",
        "supportsFinishReason",
        "requiresToolResultName",
        "requiresAssistantAfterToolResult",
        "requiresThinkingAsText",
        "requiresReasoningContentOnAssistantMessages",
        "zaiToolStream",
        "supportsThinkingTokenBudget",
        "supportsOpenAIGrammarTools",
        "supportsMidConvoSystemMessages",
        "supportsMidConvoToolAdditions",
        "supportsStrictMode",
        "sendSessionAffinityHeaders",
        "supportsLongCacheRetention",
        "supportsAdditionalTools",
        "supportsToolSearch",
        "supportsExplicitPromptCacheMode",
        "supportsMidConvoEffort",
        "supportsMaxOutputTokens",
        "supportsEagerToolInputStreaming",
        "supportsCacheControlOnTools",
        "supportsTemperature",
        "forceAdaptiveThinking",
        "allowEmptySignature",
        "supportsStrictTools",
        "supportsMidConvoToolChanges",
        "sendImageOptInHeader",
      ].map((key) => [key, boolean]),
    ),
    maxTokensField: oneOf("max_completion_tokens", "max_tokens"),
    thinkingFormat: oneOf(
      "openai",
      "openrouter",
      "deepseek",
      "together",
      "baseten",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ),
    thinkingTokenBudgetField: oneOf(
      "thinking_token_budget",
      "thinking_budget",
      "thinking_budget_tokens",
    ),
    cacheControlFormat: oneOf("anthropic"),
    sessionAffinityFormat: oneOf("openai", "openai-nosession", "openrouter"),
    imageInput: oneOf("assets", "images", "state-image-urls"),
    vllmPriority: number,
    chatTemplateKwargs: chatTemplate,
    chatTemplateArgs: chatTemplate,
    openRouterRouting: shape({
      allow_fallbacks: boolean,
      require_parameters: boolean,
      data_collection: oneOf("deny", "allow"),
      zdr: boolean,
      enforce_distillable_text: boolean,
      order: strings,
      only: strings,
      ignore: strings,
      quantizations: strings,
      sort: scalarOr(
        isString,
        shape({ by: anyString, partition: stringOrNull }),
        "must be a string or an object",
      ),
      max_price: shape(
        Object.fromEntries(
          ["prompt", "completion", "image", "audio", "request"].map((k) => [
            k,
            numberOrString,
          ]),
        ),
      ),
      preferred_min_throughput: scalarOr(
        isNumber,
        percentiles,
        "must be a number or an object",
      ),
      preferred_max_latency: scalarOr(
        isNumber,
        percentiles,
        "must be a number or an object",
      ),
    }),
    vercelGatewayRouting: shape({ only: strings, order: strings }),
    allowedFallbackModels: list(
      shape({ provider: nonEmpty, model: nonEmpty, cost }, [
        "provider",
        "model",
        "cost",
      ]),
      3,
    ),
  },
  [],
  {
    // Pi 0.72 replaced this with model-level thinkingLevelMap; the pinned SDK
    // would keep it as an inert key, so the user would lose the mapping silently.
    reasoningEffortMap:
      "was replaced in Pi 0.72 by each model's own thinkingLevelMap; move these mappings there (null hides a level the model does not support)",
  },
);
const modelFields = {
  id: nonEmpty,
  name: nonEmpty,
  api: nonEmpty,
  baseUrl: nonEmpty,
  reasoning: boolean,
  thinkingLevelMap: levels(stringOrNull),
  input: list(oneOf("text", "image")),
  inputLimits: shape({
    maxRequestBytes: whole(),
    images: shape({
      resize: shape({
        maxWidth: whole(),
        maxHeight: whole(),
        maxBytes: whole(),
        jpegQuality: whole(100),
      }),
      maxPerMessage: whole(),
      maxPerRequest: whole(),
    }),
  }),
  cost,
  promptCache: shape({ short: positive, long: positive }),
  contextWindow: positive,
  maxTokens: positive,
  samplingParams: freeform,
  samplingParamsByThinkingLevel: levels(freeform),
  headers,
  compat,
};
const {
  id: _id,
  api: _api,
  baseUrl: _baseUrl,
  ...overrideFields
} = modelFields;
const model = shape(modelFields, ["id"]);
const models = list(model);
const uniqueModels: FieldCheck = (value, at) => {
  models(value, at);
  const ids = new Set<unknown>();
  (value as Data[]).forEach((entry, i) => {
    if (ids.has(entry.id))
      fail(
        child(child(at, i), "id"),
        "repeats the id of an earlier model of this provider",
      );
    ids.add(entry.id);
  });
};
uniqueModels.items = model;
/** The pinned SDK's models.json schema, closed. Exported for its conformance test. */
export const MODELS_JSON: FieldCheck = shape(
  {
    $schema: anyString,
    providers: record(
      shape({
        name: nonEmpty,
        baseUrl: nonEmpty,
        apiKey: template,
        api: nonEmpty,
        oauth: oneOf("radius"),
        headers,
        compat,
        authHeader: boolean,
        models: uniqueModels,
        modelOverrides: record(
          shape({
            ...overrideFields,
            cost: shape({ ...rates, tiers: costTiers }),
          }),
        ),
      }),
    ),
  },
  ["providers"],
);
const credential: FieldCheck = (value, at) => {
  const o = object(value, at);
  if (o.type === "api_key") {
    for (const key of Object.keys(o))
      if (!["type", "key", "env"].includes(key))
        fail(child(at, key), "is not a field of an api_key credential");
    if (o.key !== undefined) template(o.key, child(at, "key"));
    if (o.env !== undefined) variables(o.env, child(at, "env"));
  } else if (o.type === "oauth") {
    nonEmpty(o.access, child(at, "access"));
    nonEmpty(o.refresh, child(at, "refresh"));
    number(o.expires, child(at, "expires"));
    if (o.env !== undefined) variables(o.env, child(at, "env"));
    // OAuth providers own additional account/scope fields. Keep all of them
    // private and compare them across refresh, rather than discarding identity.
  } else fail(child(at, "type"), 'must be "api_key" or "oauth"');
};
const AUTH_JSON = record(credential);
/** Match the selected peer's documented models syntax (line comments and
 * trailing commas only), without importing its private parser. Retain raw bytes
 * for freshness. Auth remains strict JSON; neither path repairs the file. */
function piJsonc(input: string): string {
  let stripped = "";
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (!quoted && char === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      stripped += "\n";
      continue;
    }
    stripped += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
  }
  let normalized = "";
  quoted = false;
  escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i];
    if (!quoted && char === ",") {
      let next = i + 1;
      while (/\s/.test(stripped[next] ?? "") && next < stripped.length) next++;
      if (stripped[next] === "}" || stripped[next] === "]") continue;
    }
    normalized += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
  }
  return normalized;
}
/** Why a selected file or directory was refused, from its metadata alone. */
function fileReason(path: string, directory: boolean): string {
  let st: Stats;
  try {
    st = lstatSync(path);
  } catch {
    return directory
      ? "does not exist; run pi once to create it, or select another --agent-dir"
      : "cannot be read";
  }
  if (st.isSymbolicLink())
    return "is a symbolic link; Cadence reads only the real file or directory, not a link to it";
  if (directory ? !st.isDirectory() : !st.isFile())
    return directory ? "is not a directory" : "is not a regular file";
  if (!directory && st.nlink !== 1)
    return `has ${st.nlink} hard links; Cadence reads only a file with a single link`;
  if (!directory && st.size > CONFIG_BYTES) return "is larger than 1 MiB";
  if (
    process.platform !== "win32" &&
    process.getuid &&
    st.uid !== process.getuid()
  )
    return "is owned by another user";
  return directory
    ? "has a parent directory Cadence cannot use (a symbolic link loop or another user's directory)"
    : "changed while Cadence was reading it; try again";
}
function readSource(
  source: PiSource,
  file: "auth.json" | "models.json",
): FileSnapshot | undefined {
  const path = file === "auth.json" ? source.authPath : source.modelsPath;
  try {
    return source.files.read(path, CONFIG_BYTES);
  } catch (error) {
    throw new PiSourceRefusal(
      { file, check: "file", field: null, reason: fileReason(path, false) },
      error instanceof ContractError ? error.code : "unavailable",
    );
  }
}
/** Strict JSON (models.json: Pi's comments and trailing commas), refused with
 * at most a line number: a parser message would quote the file's bytes. */
function parseSource(
  snapshot: FileSnapshot,
  file: "auth.json" | "models.json",
): unknown {
  const refuse = (reason: string): never => {
    throw new PiSourceRefusal({ file, check: "json", field: null, reason });
  };
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
  } catch {
    refuse("is not valid UTF-8 text");
  }
  if (file === "models.json") text = piJsonc(text);
  try {
    return parseWireJson(text, CONFIG_BYTES);
  } catch {
    const extra =
      file === "models.json"
        ? " (beyond JSON, models.json allows only // line comments and trailing commas)"
        : "";
    try {
      JSON.parse(text);
    } catch (error) {
      const line = /\(line (\d+) column \d+\)$/.exec(
        error instanceof Error ? error.message : "",
      )?.[1];
      return refuse(
        `is not valid JSON${line ? ` near line ${line}` : ""}${extra}`,
      );
    }
    return refuse(
      "has a duplicate key, a NUL character, an unpaired surrogate or nesting deeper than 64 levels",
    );
  }
}
function schemaCheck(
  file: "auth.json" | "models.json",
  check: FieldCheck,
  value: unknown,
): void {
  try {
    check(value, "");
  } catch (error) {
    if (!(error instanceof FieldRefusal)) throw error;
    throw new PiSourceRefusal(
      {
        file,
        check: "schema",
        field: error.field || null,
        reason: error.reason,
      },
      error.code,
    );
  }
}
export function readPiSnapshot(source: PiSource): PiSnapshot {
  const { auth, credentials } = readPiAuth(source);
  const { models, providers } = readPiModels(source);
  return { auth, models, credentials, providers };
}
export function readPiAuth(
  source: PiSource,
): Pick<PiSnapshot, "auth" | "credentials"> {
  const auth = readSource(source, "auth.json");
  if (!auth)
    throw new PiSourceRefusal({
      file: "auth.json",
      check: "file",
      field: null,
      reason: "does not exist; sign in with Pi first (pi, then /login)",
    });
  const value = parseSource(auth, "auth.json");
  schemaCheck("auth.json", AUTH_JSON, value);
  const credentials: Record<string, Credential> = Object.create(null);
  for (const [provider, credential] of Object.entries(data(value)))
    credentials[provider] = data(credential) as unknown as Credential;
  return { auth, credentials };
}
export function readPiModels(
  source: PiSource,
): Pick<PiSnapshot, "models" | "providers"> {
  const models = readSource(source, "models.json");
  const providers: Record<string, Data> = Object.create(null);
  if (models) {
    const value = parseSource(models, "models.json");
    schemaCheck("models.json", MODELS_JSON, value);
    for (const [id, provider] of Object.entries(data(data(value).providers)))
      providers[id] = data(provider);
  }
  return { models, providers };
}
/** The owner's pre-bind check of its selected Pi sources, which doctor runs
 * too: the agent directory, then auth.json, then models.json. */
export function checkPiSources(
  agentDir: string | undefined,
  home: string,
  cwd: string,
  env: LaunchEnvironment,
): PiSource {
  const source = piSource(agentDir, home, cwd, env);
  readPiAuth(source);
  readPiModels(source);
  return source;
}
/** The pinned SDK's own refusal (ModelRuntime.getError), reduced to a field
 * path and fixed words. Its text is never passed on: it can quote file bytes. */
export function sdkRefusal(message: string): PiSourceRefusal {
  const problem = (field: string | null, reason: string) =>
    new PiSourceRefusal({ file: "models.json", check: "sdk", field, reason });
  const schema =
    /^Invalid models\.json schema:\n {2}- ([A-Za-z0-9_$.:@/+-]{1,200}): (must [A-Za-z0-9 ,'"_=<>.-]{1,120})$/m.exec(
      message,
    );
  if (schema) return problem(schema[1], schema[2]);
  const provider = /^Provider "?([A-Za-z0-9_.:@/+-]{1,64})"?[:,]/m.exec(
    message,
  )?.[1];
  const known: [RegExp, string][] = [
    [
      /no "api" specified/,
      'has a model with no "api"; set it on the provider or on the model',
    ],
    [
      /"baseUrl" is required when defining custom models/,
      'defines models but has no "baseUrl"',
    ],
    [
      /"baseUrl" is required when "oauth" is set/,
      'sets "oauth" but has no "baseUrl"',
    ],
    [
      /must specify "baseUrl"/,
      "must set baseUrl, headers, compat, modelOverrides or models",
    ],
    [/invalid contextWindow/, "has a model with an invalid contextWindow"],
    [/invalid maxTokens/, "has a model with an invalid maxTokens"],
  ];
  for (const [pattern, reason] of known)
    if (pattern.test(message))
      return problem(provider ? child("providers", provider) : null, reason);
  return problem(
    null,
    "was refused by the Pi SDK; run pi in a terminal to see its own message",
  );
}
/** Private equality only, not a public hash/selection ID. */
export function sourceIdentity(snapshot: PiSnapshot, provider: string): string {
  const credential = snapshot.credentials[provider];
  if (credential?.type === "oauth") {
    const { access: _a, refresh: _r, expires: _e, ...identity } = credential;
    return stablePrivate(identity);
  }
  return stablePrivate(credential ?? null);
}
export function selectedEnvironment(
  snapshot: PiSnapshot,
  provider: string,
  model: string,
  launch: LaunchEnvironment,
): Record<string, string> {
  const credential = snapshot.credentials[provider];
  const scoped =
    credential?.env === undefined ? {} : environment(credential.env);
  const config = snapshot.providers[provider];
  const values: unknown[] = [];
  if (credential?.type === "api_key" && credential.key !== undefined)
    values.push(credential.key);
  if (config?.apiKey !== undefined) values.push(config.apiKey);
  if (config?.headers) values.push(...Object.values(data(config.headers)));
  const definition = Array.isArray(config?.models)
    ? config.models.find((m) => data(m).id === model)
    : undefined;
  const override = config?.modelOverrides
    ? data(config.modelOverrides)[model]
    : undefined;
  for (const entry of [definition, override])
    if (entry && data(entry).headers)
      values.push(...Object.values(data(data(entry).headers)));
  const env = { ...scoped };
  for (const value of values) {
    if (value === "") continue;
    for (const name of templateNames(value)) {
      if (/(?:_FILE|_PATH|_CREDENTIALS)$/.test(name))
        throw new ContractError("unsupported-context");
      const selected = scoped[name] || launch[name];
      if (!selected) throw new ContractError("auth-unavailable");
      env[name] = selected;
    }
  }
  return env;
}
export function sameModels(a: PiSnapshot, b: PiSnapshot): boolean {
  return (
    a.models?.identity === b.models?.identity &&
    a.models?.stamp === b.models?.stamp
  );
}
export function stablePrivate(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(data(v))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, entry]) => [k, sorted(entry)]),
      );
    return v;
  };
  return JSON.stringify(sorted(value));
}
export function clonePrivate<T>(value: T): T {
  // Bound traversal and reject getters/functions/toJSON before serialization.
  let count = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++count > 16384 || depth > 32) throw new ContractError("oversize");
    if (
      v === undefined ||
      v === null ||
      typeof v === "boolean" ||
      typeof v === "string"
    )
      return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) {
      if (v.length > 16384 || Reflect.ownKeys(v).length !== v.length + 1)
        refuse();
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d)) refuse();
        out.push(visit(d.value, depth + 1));
      }
      return out;
    }
    const out: Data = Object.create(null);
    for (const [k, entry] of Object.entries(data(v)))
      out[k] = visit(entry, depth + 1);
    return out;
  };
  const encoded = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(encoded) > CONFIG_BYTES)
    throw new ContractError("oversize");
  return parseWireJson(encoded, CONFIG_BYTES) as T;
}

/** Readonly known-secret collection, shared with stopped-session reads; no SDK/auth operation. */
export function snapshotLiterals(
  snapshot: PiSnapshot,
  launch: LaunchEnvironment,
  routes: readonly string[] = [],
): readonly string[] {
  // Visit the already validated private snapshot without first flattening or
  // spreading an uncharged literal list. Charge each UNIQUE value before retain.
  const strings = (v: unknown, visit: (value: string) => void): void => {
    if (typeof v === "string") {
      if (v) visit(v);
    } else if (v && typeof v === "object") {
      for (const key of Object.keys(v))
        strings((v as Record<string, unknown>)[key], visit);
    }
  };
  const literals = new Set<string>();
  let literalBytes = 0;
  const add = (value: string) => {
    if (literals.has(value)) return;
    const size = Buffer.byteLength(value);
    if (literalBytes + size > LIMITS.workerRequestBytes * 2)
      throw new ContractError("oversize");
    literalBytes += size;
    literals.add(value);
  };
  for (const route of routes) add(route);
  const templates = (value: unknown, provider: string) => {
    const scoped = environment(snapshot.credentials[provider]?.env ?? {});
    strings(value, (literal) => {
      add(literal);
      for (const name of templateNames(literal)) {
        const resolved = scoped[name] || launch[name];
        if (resolved) add(resolved);
      }
    });
  };
  for (const [provider, credential] of Object.entries(snapshot.credentials)) {
    strings(
      credential.type === "api_key" ? credential.key : credential.access,
      add,
    );
    strings(credential.type === "oauth" ? credential.refresh : null, add);
    strings(credential.env, add);
    if (credential.type === "api_key") templates(credential.key, provider);
  }
  for (const [provider, config] of Object.entries(snapshot.providers)) {
    templates(config.apiKey, provider);
    templates(config.headers, provider);
    for (const model of Array.isArray(config.models) ? config.models : [])
      templates(data(model).headers, provider);
    if (config.modelOverrides)
      for (const model of Object.values(data(config.modelOverrides)))
        templates(data(model).headers, provider);
  }
  for (const [key, value] of Object.entries(launch))
    if (/(?:KEY|TOKEN|SECRET|PASS|AUTH|COOKIE)/i.test(key) && value) add(value);
  return [...literals];
}
