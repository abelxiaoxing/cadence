// Per-role subagent endpoint resolution from the cadence env file.
// Three-tier whole-layer semantics: role layer, global layer, inherited.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnvFile } from "../skills/_shared/load-config.mjs";
import { ROLES } from "./contracts.ts";

export type SubagentRole = (typeof ROLES)[number];

export type SubagentDialect =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";

const LAYER_FIELDS = [
  "API_URL",
  "API_KEY",
  "MODEL",
  "API",
  "CONTEXT_WINDOW",
  "MAX_TOKENS",
] as const;
type LayerField = (typeof LAYER_FIELDS)[number];
type Layer = Partial<Record<LayerField, string>>;

const GLOBAL_PREFIX = "SUBAGENT_";
const DEFAULT_DIALECT: SubagentDialect = "openai-completions";
const DIALECTS: readonly SubagentDialect[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
];

export const DEFAULT_CONTEXT_WINDOW = 256000;
export const DEFAULT_MAX_TOKENS = 128000;

export interface SubagentEndpoint {
  readonly url: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly dialect: SubagentDialect;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export type SubagentEndpointResolution =
  | { kind: "inherited" }
  | { kind: "custom"; endpoint: Readonly<SubagentEndpoint> }
  | { kind: "invalid"; keys: string[]; file?: string };

export function describeInvalidSubagentEndpoint(
  resolution: Extract<SubagentEndpointResolution, { kind: "invalid" }>,
): string {
  return resolution.keys.length > 0
    ? `invalid subagent endpoint configuration keys: ${resolution.keys.join(", ")}`
    : `invalid subagent endpoint configuration file: ${resolution.file ?? "unknown"}`;
}

function layerOf(values: Record<string, string>, prefix: string): Layer {
  const layer: Layer = {};
  for (const field of LAYER_FIELDS) {
    const value = values[prefix + field];
    if (value !== undefined && value !== "") layer[field] = value;
  }
  return layer;
}

function isCommitted(layer: Layer): boolean {
  return LAYER_FIELDS.some((field) => layer[field] !== undefined);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isPositiveInteger(value: string): boolean {
  const number = Number(value);
  return /^[0-9]+$/.test(value) && Number.isSafeInteger(number) && number > 0;
}

function offendingKeys(prefix: string, layer: Layer): string[] {
  const keys: string[] = [];
  if (layer.API_URL === undefined || !isHttpUrl(layer.API_URL))
    keys.push(`${prefix}API_URL`);
  if (layer.MODEL === undefined) keys.push(`${prefix}MODEL`);
  if (
    layer.API !== undefined &&
    !DIALECTS.includes(layer.API as SubagentDialect)
  )
    keys.push(`${prefix}API`);
  if (
    layer.CONTEXT_WINDOW !== undefined &&
    !isPositiveInteger(layer.CONTEXT_WINDOW)
  )
    keys.push(`${prefix}CONTEXT_WINDOW`);
  if (layer.MAX_TOKENS !== undefined && !isPositiveInteger(layer.MAX_TOKENS))
    keys.push(`${prefix}MAX_TOKENS`);
  return keys;
}

function selectEnvFile(cwd: string, home: string): string | null {
  const projectPath = path.join(cwd, ".pi", "cadence", ".env");
  if (existsSync(projectPath)) return projectPath;
  const userPath = path.join(home, ".pi", "agent", "cadence", ".env");
  if (existsSync(userPath)) return userPath;
  return null;
}

export function resolveSubagentEndpoint(
  role: string,
  options?: { cwd?: string; home?: string },
): SubagentEndpointResolution {
  if (!(ROLES as readonly string[]).includes(role))
    return { kind: "invalid", keys: ["SUBAGENT_ROLE"] };
  const cwd = options?.cwd ?? process.cwd();
  const home = options?.home ?? homedir();
  const file = selectEnvFile(cwd, home);
  if (!file) return { kind: "inherited" };
  let values: Record<string, string>;
  try {
    values = parseEnvFile(readFileSync(file, "utf8"));
  } catch {
    return { kind: "invalid", keys: [], file };
  }
  const rolePrefix = `SUBAGENT_${role.toUpperCase().replaceAll("-", "_")}_`;
  const roleLayer = layerOf(values, rolePrefix);
  let layer: Layer | undefined = isCommitted(roleLayer) ? roleLayer : undefined;
  if (!layer) {
    const globalLayer = layerOf(values, GLOBAL_PREFIX);
    if (isCommitted(globalLayer)) layer = globalLayer;
  }
  if (!layer) return { kind: "inherited" };
  const prefix = layer === roleLayer ? rolePrefix : GLOBAL_PREFIX;
  const keys = offendingKeys(prefix, layer);
  if (keys.length > 0) return { kind: "invalid", keys, file };
  const endpoint: Readonly<SubagentEndpoint> = Object.freeze({
    url: layer.API_URL ?? "",
    ...(layer.API_KEY === undefined ? {} : { apiKey: layer.API_KEY }),
    model: layer.MODEL ?? "",
    dialect: (layer.API as SubagentDialect | undefined) ?? DEFAULT_DIALECT,
    contextWindow:
      layer.CONTEXT_WINDOW === undefined
        ? DEFAULT_CONTEXT_WINDOW
        : Number(layer.CONTEXT_WINDOW),
    maxTokens:
      layer.MAX_TOKENS === undefined
        ? DEFAULT_MAX_TOKENS
        : Number(layer.MAX_TOKENS),
  });
  return { kind: "custom", endpoint };
}
