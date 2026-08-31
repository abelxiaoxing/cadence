import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ROLES } from "./contracts.ts";

export const ROUTE_DIALECTS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
] as const;

export type WorkerRole = (typeof ROLES)[number];
export type RouteDialect = (typeof ROUTE_DIALECTS)[number];

export interface RouteCapabilities {
  roles: WorkerRole[];
  dialects: RouteDialect[];
  contextWindow: number;
  maxTokens: number;
}

export interface ParentModelCapabilities {
  contextWindow: number;
  maxTokens: number;
}

interface RouteBase {
  id: string;
  kind: "inherited" | "custom";
  capabilities: RouteCapabilities;
  fingerprint: string;
}

export interface InheritedRoutePolicy extends RouteBase {
  kind: "inherited";
}

export interface CustomRoutePolicy extends RouteBase {
  kind: "custom";
  url: string;
  model: string;
  dialect: RouteDialect;
  apiKeyEnv?: string;
}

export type WorkerRoutePolicy = InheritedRoutePolicy | CustomRoutePolicy;

export interface RoutePolicy {
  routes: Readonly<Record<string, WorkerRoutePolicy>>;
  roles: Readonly<Record<WorkerRole, readonly string[]>>;
}

export type RoutePolicySource =
  | { kind: "project" | "user"; path: string }
  | { kind: "default" };

export type RoutePolicyDiagnosticCode =
  | "policy-unreadable"
  | "policy-invalid-json"
  | "policy-invalid"
  | "route-invalid"
  | "route-duplicate"
  | "role-invalid"
  | "route-reference-invalid";

export interface RoutePolicyDiagnostic {
  code: RoutePolicyDiagnosticCode;
  field?: string;
  routeId?: string;
  role?: WorkerRole;
}

export type ParsedRoutePolicy =
  | { ok: true; policy: RoutePolicy }
  | { ok: false; diagnostics: RoutePolicyDiagnostic[] };

export type RoutePolicyResolution =
  | {
      ok: true;
      source: RoutePolicySource;
      policy: RoutePolicy;
    }
  | {
      ok: false;
      source: RoutePolicySource;
      diagnostics: RoutePolicyDiagnostic[];
    };

/**
 * Internal fail-closed policy used while a selected explicit policy is
 * invalid. It deliberately contains no inherited-parent route:
 * the broker therefore reports endpoint-unavailable without making a Worker
 * request, while the local durable control plane remains available.
 *
 * This value is not accepted by parseRoutePolicy and is never persisted as a
 * user policy. A corrected external policy replaces it before the next
 * control operation.
 */
export function unavailableRoutePolicy(): RoutePolicy {
  return {
    routes: Object.freeze({}),
    roles: Object.freeze(
      Object.fromEntries(
        ROLES.map((role) => [role, Object.freeze([] as string[])]),
      ),
    ) as unknown as RoutePolicy["roles"],
  };
}

const ROUTE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/iu;
const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{0,255}$/iu;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const MAX_POLICY_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function uniqueStringArray(
  value: unknown,
  allowed?: readonly string[],
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        ROUTE_ID.test(entry) &&
        (!allowed || allowed.includes(entry)),
    ) &&
    new Set(value).size === value.length
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function routeFingerprint(route: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(route)).digest("hex");
}

function parseCapabilities(value: unknown): RouteCapabilities | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["roles", "dialects", "contextWindow", "maxTokens"]) ||
    !uniqueStringArray(value.roles, ROLES) ||
    !uniqueStringArray(value.dialects, ROUTE_DIALECTS) ||
    !positiveInteger(value.contextWindow) ||
    !positiveInteger(value.maxTokens) ||
    value.maxTokens > value.contextWindow
  ) {
    return null;
  }
  return {
    roles: [...value.roles] as WorkerRole[],
    dialects: [...value.dialects] as RouteDialect[],
    contextWindow: value.contextWindow,
    maxTokens: value.maxTokens,
  };
}

function parseRoute(
  id: string,
  value: unknown,
): WorkerRoutePolicy | RoutePolicyDiagnostic {
  if (!ROUTE_ID.test(id) || !isRecord(value)) {
    return {
      code: "route-invalid",
      routeId: ROUTE_ID.test(id) ? id : undefined,
    };
  }
  const capabilities = parseCapabilities(value.capabilities);
  if (!capabilities) {
    return { code: "route-invalid", routeId: id, field: "capabilities" };
  }
  if (value.kind === "inherited") {
    if (!hasExactKeys(value, ["kind", "capabilities"])) {
      return { code: "route-invalid", routeId: id };
    }
    const raw = { kind: "inherited" as const, capabilities };
    return {
      id,
      ...raw,
      fingerprint: routeFingerprint(raw),
    };
  }
  if (value.kind !== "custom") {
    return { code: "route-invalid", routeId: id, field: "kind" };
  }
  if (
    !hasExactKeys(
      value,
      ["kind", "url", "model", "dialect", "capabilities"],
      ["apiKeyEnv"],
    ) ||
    !httpUrl(value.url) ||
    typeof value.model !== "string" ||
    !MODEL_ID.test(value.model) ||
    !(ROUTE_DIALECTS as readonly unknown[]).includes(value.dialect) ||
    !capabilities.dialects.includes(value.dialect as RouteDialect) ||
    (value.apiKeyEnv !== undefined &&
      (typeof value.apiKeyEnv !== "string" || !ENV_NAME.test(value.apiKeyEnv)))
  ) {
    const field = !httpUrl(value.url)
      ? "url"
      : typeof value.model !== "string" || !MODEL_ID.test(value.model)
        ? "model"
        : !(ROUTE_DIALECTS as readonly unknown[]).includes(value.dialect)
          ? "dialect"
          : value.apiKeyEnv !== undefined &&
              (typeof value.apiKeyEnv !== "string" ||
                !ENV_NAME.test(value.apiKeyEnv))
            ? "apiKeyEnv"
            : undefined;
    return { code: "route-invalid", routeId: id, ...(field ? { field } : {}) };
  }
  const raw = {
    kind: "custom" as const,
    url: value.url,
    model: value.model,
    dialect: value.dialect as RouteDialect,
    ...(typeof value.apiKeyEnv === "string"
      ? { apiKeyEnv: value.apiKeyEnv }
      : {}),
    capabilities,
  };
  return { id, ...raw, fingerprint: routeFingerprint(raw) };
}

export function parseRoutePolicy(value: unknown): ParsedRoutePolicy {
  if (!isRecord(value) || !hasExactKeys(value, ["routes", "roles"])) {
    return { ok: false, diagnostics: [{ code: "policy-invalid" }] };
  }
  if (!isRecord(value.routes) || !isRecord(value.roles)) {
    return { ok: false, diagnostics: [{ code: "policy-invalid" }] };
  }

  const diagnostics: RoutePolicyDiagnostic[] = [];
  const routes: Record<string, WorkerRoutePolicy> = {};
  for (const [id, candidate] of Object.entries(value.routes)) {
    const parsed = parseRoute(id, candidate);
    if ("code" in parsed) diagnostics.push(parsed);
    else routes[id] = parsed;
  }
  if (Object.keys(routes).length !== Object.keys(value.routes).length) {
    return { ok: false, diagnostics };
  }
  const fingerprints = new Map<string, string>();
  for (const route of Object.values(routes)) {
    const prior = fingerprints.get(route.fingerprint);
    if (prior) {
      diagnostics.push({
        code: "route-duplicate",
        routeId: route.id,
        field: prior,
      });
    } else {
      fingerprints.set(route.fingerprint, route.id);
    }
  }
  const roleMap = value.roles as Record<string, unknown>;
  if (
    Object.keys(value.roles).length !== ROLES.length ||
    !ROLES.every((role) => Object.hasOwn(roleMap, role))
  ) {
    diagnostics.push({ code: "role-invalid" });
  } else {
    for (const role of ROLES) {
      const routeIds = roleMap[role];
      if (!uniqueStringArray(routeIds)) {
        diagnostics.push({ code: "role-invalid", role });
        continue;
      }
      for (const routeId of routeIds) {
        const route = routes[routeId];
        if (!route?.capabilities.roles.includes(role)) {
          diagnostics.push({
            code: "route-reference-invalid",
            role,
            routeId,
          });
        }
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    policy: {
      routes: Object.freeze(structuredClone(routes)),
      roles: Object.freeze(
        Object.fromEntries(
          ROLES.map((role) => [
            role,
            Object.freeze([...(roleMap[role] as string[])]),
          ]),
        ),
      ) as unknown as RoutePolicy["roles"],
    },
  };
}

/** Default parent-model route used when no explicit policy file exists. */
export function parentRoutePolicy(
  parentModel?: ParentModelCapabilities,
): RoutePolicy {
  const contextWindow = positiveInteger(parentModel?.contextWindow)
    ? parentModel.contextWindow
    : 1;
  const maxTokens = positiveInteger(parentModel?.maxTokens)
    ? Math.min(parentModel.maxTokens, contextWindow)
    : 1;
  const parsed = parseRoutePolicy({
    routes: {
      parent: {
        kind: "inherited",
        capabilities: {
          roles: [...ROLES],
          dialects: [...ROUTE_DIALECTS],
          contextWindow,
          maxTokens,
        },
      },
    },
    roles: Object.fromEntries(ROLES.map((role) => [role, ["parent"]])),
  });
  if (!parsed.ok) throw new Error("parent route policy is invalid");
  return parsed.policy;
}

function selectedSource(
  cwd: string,
  home: string,
): { kind: "project" | "user"; path: string } | { kind: "none" } {
  const mayExist = (candidate: string): boolean => {
    try {
      return lstatSync(candidate, { throwIfNoEntry: false }) !== undefined;
    } catch {
      // Permission and path-observation failures are explicit unreadable
      // policy candidates, not proof that the policy is absent.
      return true;
    }
  };
  const projectPath = path.join(cwd, ".pi", "cadence", "routes.json");
  if (mayExist(projectPath)) return { kind: "project", path: projectPath };
  const userPath = path.join(home, ".pi", "agent", "cadence", "routes.json");
  if (mayExist(userPath)) return { kind: "user", path: userPath };
  return { kind: "none" };
}

export function loadRoutePolicy(
  options: {
    cwd?: string;
    home?: string;
    parentModel?: ParentModelCapabilities;
  } = {},
): RoutePolicyResolution {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const home = path.resolve(options.home ?? homedir());
  const source = selectedSource(cwd, home);
  if (source.kind === "none") {
    return {
      ok: true,
      source: { kind: "default" },
      policy: parentRoutePolicy(options.parentModel),
    };
  }
  let bytes: string;
  try {
    const stat = lstatSync(source.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_POLICY_BYTES
    ) {
      throw new Error("unsafe policy file");
    }
    bytes = readFileSync(source.path, "utf8");
  } catch {
    return {
      ok: false,
      source,
      diagnostics: [{ code: "policy-unreadable" }],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    return {
      ok: false,
      source,
      diagnostics: [{ code: "policy-invalid-json" }],
    };
  }
  const parsed = parseRoutePolicy(value);
  return parsed.ok
    ? { ok: true, source, policy: parsed.policy }
    : { ok: false, source, diagnostics: parsed.diagnostics };
}

export function inspectRoutePolicy(
  resolution: RoutePolicyResolution,
  health: Readonly<Record<string, { state: string; retryAt?: number }>> = {},
): Record<string, unknown> {
  if (!resolution.ok) {
    return {
      ok: false,
      source: { kind: resolution.source.kind },
      diagnostics: structuredClone(resolution.diagnostics),
    };
  }
  return {
    ok: true,
    source: { kind: resolution.source.kind },
    routes: Object.values(resolution.policy.routes).map((route) => ({
      id: route.id,
      kind: route.kind,
      fingerprint: route.fingerprint,
      capabilities: structuredClone(route.capabilities),
      health: health[route.id]?.state ?? "healthy",
      ...(health[route.id]?.retryAt === undefined
        ? {}
        : { retryAt: health[route.id]?.retryAt }),
    })),
    roles: structuredClone(resolution.policy.roles),
  };
}

export interface ResolvedCustomRoute {
  url: string;
  model: string;
  dialect: RouteDialect;
  contextWindow: number;
  maxTokens: number;
  apiKey?: string;
}

export function resolveCustomRoute(
  route: CustomRoutePolicy,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedCustomRoute {
  const apiKey = route.apiKeyEnv ? environment[route.apiKeyEnv] : undefined;
  if (route.apiKeyEnv && !apiKey) {
    throw new Error("route-credential-unavailable:apiKeyEnv");
  }
  return {
    url: route.url,
    model: route.model,
    dialect: route.dialect,
    contextWindow: route.capabilities.contextWindow,
    maxTokens: route.capabilities.maxTokens,
    ...(apiKey ? { apiKey } : {}),
  };
}
