// Owner-private selected Pi configuration. Never exported through a client DTO.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { ContractError, parseWireJson } from "../service-contract.ts";
import { type FileSnapshot, json, PrivateFiles } from "./private-files.ts";

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
function keys(value: Data, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) refuse();
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
  // Ambient ancestors may be canonical aliases; the selected directory itself may not.
  const directory = join(
    realpathSync(dirname(selected)),
    selected.slice(dirname(selected).length + 1),
  );
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    refuse();
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
function headers(value: unknown): void {
  for (const [name, entry] of Object.entries(data(value))) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) refuse();
    // Installed 0.84.3 models.json supports string headers only. AuthResult null
    // suppression is separately preserved; never coerce null config to a string.
    if (typeof entry !== "string" || /[\r\n\0]/.test(entry)) refuse();
    if (entry) templateNames(entry);
  }
}
const modelKeys = [
  "id",
  "name",
  "api",
  "baseUrl",
  "reasoning",
  "thinkingLevelMap",
  "input",
  "cost",
  "contextWindow",
  "maxTokens",
  "samplingParams",
  "headers",
  "compat",
];
function compat(value: unknown): void {
  const config = data(value);
  // The installed SDK's permissive object union can validate a malformed field
  // through another member that does not declare it. Close AND type-check these
  // fields here; never trust that union to validate known compatibility values.
  const booleans = [
    "supportsStore",
    "supportsDeveloperRole",
    "supportsReasoningEffort",
    "supportsUsageInStreaming",
    "supportsFinishReason",
    "requiresToolResultName",
    "requiresAssistantAfterToolResult",
    "requiresThinkingAsText",
    "requiresReasoningContentOnAssistantMessages",
    "supportsOpenAIGrammarTools",
    "supportsStrictMode",
    "sendSessionAffinityHeaders",
    "supportsLongCacheRetention",
    "supportsAdditionalTools",
    "supportsToolSearch",
    "supportsEagerToolInputStreaming",
    "supportsCacheControlOnTools",
    "supportsTemperature",
    "forceAdaptiveThinking",
    "allowEmptySignature",
    "supportsStrictTools",
    "supportsToolReferences",
    // Newer Pi (1.x) keeps or collapses mid-conversation system messages. The
    // pinned SDK's messages have no system role, so this flag is inert here.
    // Other newer keys may change requests or thinking and stay refused.
    "supportsMidConvoSystemMessages",
  ];
  const enums: Record<string, readonly string[]> = {
    maxTokensField: ["max_completion_tokens", "max_tokens"],
    thinkingFormat: [
      "openai",
      "openrouter",
      "together",
      "baseten",
      "deepseek",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ],
    cacheControlFormat: ["anthropic"],
    deferredToolsMode: ["kimi"],
    sessionAffinityFormat: ["openai", "openai-nosession", "openrouter"],
  };
  keys(config, [
    ...booleans,
    ...Object.keys(enums),
    "chatTemplateKwargs",
    "chatTemplateArgs",
    "openRouterRouting",
    "vercelGatewayRouting",
  ]);
  for (const key of booleans)
    if (config[key] !== undefined && typeof config[key] !== "boolean") refuse();
  for (const [key, values] of Object.entries(enums))
    if (config[key] !== undefined && !values.includes(config[key] as string))
      refuse();
  for (const key of ["chatTemplateKwargs", "chatTemplateArgs"]) {
    if (config[key] === undefined) continue;
    for (const entry of Object.values(data(config[key]))) {
      if (
        entry === null ||
        ["string", "boolean", "number"].includes(typeof entry)
      )
        continue;
      const variable = data(entry);
      keys(variable, ["$var", "omitWhenOff"]);
      if (
        !["thinking.enabled", "thinking.effort"].includes(
          variable.$var as string,
        ) ||
        (variable.omitWhenOff !== undefined &&
          typeof variable.omitWhenOff !== "boolean")
      )
        refuse();
    }
  }
  const stringArray = (value: unknown) => {
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    )
      refuse();
  };
  if (config.vercelGatewayRouting !== undefined) {
    const routing = data(config.vercelGatewayRouting);
    keys(routing, ["only", "order"]);
    for (const value of Object.values(routing)) stringArray(value);
  }
  if (config.openRouterRouting !== undefined) {
    const routing = data(config.openRouterRouting);
    keys(routing, [
      "allow_fallbacks",
      "require_parameters",
      "data_collection",
      "zdr",
      "enforce_distillable_text",
      "order",
      "only",
      "ignore",
      "quantizations",
      "sort",
      "max_price",
      "preferred_min_throughput",
      "preferred_max_latency",
    ]);
    for (const key of [
      "allow_fallbacks",
      "require_parameters",
      "zdr",
      "enforce_distillable_text",
    ])
      if (routing[key] !== undefined && typeof routing[key] !== "boolean")
        refuse();
    if (
      routing.data_collection !== undefined &&
      !["deny", "allow"].includes(routing.data_collection as string)
    )
      refuse();
    for (const key of ["order", "only", "ignore", "quantizations"])
      stringArray(routing[key]);
    if (routing.sort !== undefined && typeof routing.sort !== "string") {
      const sort = data(routing.sort);
      keys(sort, ["by", "partition"]);
      if (
        (sort.by !== undefined && typeof sort.by !== "string") ||
        (sort.partition !== undefined &&
          sort.partition !== null &&
          typeof sort.partition !== "string")
      )
        refuse();
    }
    if (routing.max_price !== undefined) {
      const price = data(routing.max_price);
      keys(price, ["prompt", "completion", "image", "audio", "request"]);
      for (const value of Object.values(price))
        if (typeof value !== "number" && typeof value !== "string") refuse();
    }
    for (const key of ["preferred_min_throughput", "preferred_max_latency"]) {
      if (routing[key] === undefined || typeof routing[key] === "number")
        continue;
      const cutoffs = data(routing[key]);
      keys(cutoffs, ["p50", "p75", "p90", "p99"]);
      for (const value of Object.values(cutoffs))
        if (typeof value !== "number") refuse();
    }
  }
}
function modelDefinition(value: unknown, override = false): void {
  const model = data(value);
  keys(
    model,
    override
      ? modelKeys.filter((k) => !["id", "api", "baseUrl"].includes(k))
      : modelKeys,
  );
  if (!override) string(model.id);
  if (model.headers !== undefined) headers(model.headers);
  if (model.thinkingLevelMap !== undefined)
    keys(data(model.thinkingLevelMap), [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  if (model.cost !== undefined) {
    const cost = data(model.cost);
    keys(cost, ["input", "output", "cacheRead", "cacheWrite", "tiers"]);
    if (cost.tiers !== undefined) {
      if (!Array.isArray(cost.tiers) || cost.tiers.length > ENTRY_LIMIT)
        refuse();
      for (const tier of cost.tiers)
        keys(data(tier), [
          "inputTokensAbove",
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
        ]);
    }
  }
  if (model.compat !== undefined) compat(model.compat);
  // Public SDK validates value types. Above we close unknown metadata keys too:
  // this peer's TypeBox objects otherwise permit silent additional properties.
  // samplingParams is intentionally a provider-owned free-form JSON record.
}
/** Match the selected peer's documented models syntax (line comments and
 * trailing commas only), without importing its private parser. Retain raw bytes
 * for freshness. Auth remains strict JSON; neither path repairs the file. */
function modelJson(snapshot: FileSnapshot): unknown {
  const input = new TextDecoder("utf-8", { fatal: true }).decode(
    snapshot.bytes,
  );
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
  return parseWireJson(normalized, CONFIG_BYTES);
}
export function readPiSnapshot(source: PiSource): PiSnapshot {
  const { auth, credentials } = readPiAuth(source);
  const { models, providers } = readPiModels(source);
  return { auth, models, credentials, providers };
}
export function readPiAuth(
  source: PiSource,
): Pick<PiSnapshot, "auth" | "credentials"> {
  const auth = source.files.read(source.authPath, CONFIG_BYTES);
  if (!auth) refuse();
  const credentials: Record<string, Credential> = Object.create(null);
  for (const [provider, input] of Object.entries(
    data(json(auth, CONFIG_BYTES)),
  )) {
    const credential = data(input);
    if (credential.type === "api_key") {
      keys(credential, ["type", "key", "env"]);
      if (credential.key !== undefined) templateNames(credential.key);
      if (credential.env !== undefined) environment(credential.env);
    } else if (credential.type === "oauth") {
      string(credential.access);
      string(credential.refresh);
      if (
        typeof credential.expires !== "number" ||
        !Number.isFinite(credential.expires)
      )
        refuse();
      if (credential.env !== undefined) environment(credential.env);
      // OAuth providers own additional account/scope fields. Keep all of them
      // private and compare them across refresh, rather than discarding identity.
    } else refuse();
    credentials[provider] = credential as unknown as Credential;
  }
  return { auth, credentials };
}
export function readPiModels(
  source: PiSource,
): Pick<PiSnapshot, "models" | "providers"> {
  const models = source.files.read(source.modelsPath, CONFIG_BYTES);
  const providers: Record<string, Data> = Object.create(null);
  if (models) {
    const root = data(modelJson(models));
    keys(root, ["providers", "$schema"]);
    for (const [id, value] of Object.entries(data(root.providers))) {
      const provider = data(value);
      keys(provider, [
        "name",
        "baseUrl",
        "apiKey",
        "api",
        "oauth",
        "headers",
        "compat",
        "authHeader",
        "models",
        "modelOverrides",
      ]);
      if (provider.apiKey !== undefined) templateNames(provider.apiKey);
      if (provider.headers !== undefined) headers(provider.headers);
      if (provider.compat !== undefined) compat(provider.compat);
      if (provider.models !== undefined) {
        if (
          !Array.isArray(provider.models) ||
          provider.models.length > ENTRY_LIMIT
        )
          refuse();
        const ids = new Set<unknown>();
        for (const model of provider.models) {
          modelDefinition(model);
          const id = data(model).id;
          if (ids.has(id)) refuse();
          ids.add(id);
        }
      }
      if (provider.modelOverrides !== undefined)
        for (const model of Object.values(data(provider.modelOverrides)))
          modelDefinition(model, true);
      providers[id] = provider;
    }
  }
  return { models, providers };
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
