/** SDK-free startup selection. No import here can construct a Pi runtime. */
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  networkKeys,
  networkSnapshot,
  sameNetwork,
  sdkNetworkEnvironment,
} from "../sdk-network.ts";
import {
  ContractError,
  ERROR_CODES,
  type ErrorCode,
} from "../service-contract.ts";
import { resolveWorkspace } from "../task-store.ts";
import { decodeHttpPolicy, type HttpPolicy, localOrigin } from "./config.ts";
import { closed, integer, literal, oneOf, text } from "./contracts/core.ts";
import { ServiceCoordination } from "./coordination.ts";
import { encoded, hash, json, PrivateFiles } from "./private-files.ts";
import { readServerConfig } from "./server-config.ts";

export const STARTUP_INPUT_BYTES = 16 * 1024;

export interface HostConfig {
  schema: "cadence-service-host/1";
  http: HttpPolicy;
  cwd: string;
  agentDir: string;
  /** `config`: CADENCE_TOKEN of the `.env` at `tokenFile`. */
  tokenSource: "generated" | "environment" | "file" | "config";
  tokenFile: string | null;
}
export interface StartOptions {
  workspace: string;
  stateHome?: string;
  config?: string;
  agentDir?: string;
  host?: HttpPolicy["host"];
  port?: number;
  tokenFile?: string;
  /** The `.env` whose CADENCE_PORT and CADENCE_TOKEN select the endpoint and token. */
  serverConfig?: string;
}
export interface HostInput {
  workspace: string;
  stateHome: string;
  config: HostConfig;
  environmentToken: string | null;
}
function absolute(value: unknown): string {
  const result = text(value, 4096, true);
  if (!isAbsolute(result)) throw new ContractError("invalid");
  return result;
}
export function decodeHostConfig(value: unknown): HostConfig {
  const o = closed(value, [
    "schema",
    "http",
    "cwd",
    "agentDir",
    "tokenSource",
    "tokenFile",
  ]);
  const tokenSource = oneOf(o.tokenSource, [
    "generated",
    "environment",
    "file",
    "config",
  ]);
  const tokenFile = o.tokenFile === null ? null : absolute(o.tokenFile);
  if ((tokenSource === "file" || tokenSource === "config") !== !!tokenFile)
    throw new ContractError("invalid");
  return {
    schema: literal(o.schema, "cadence-service-host/1"),
    http: decodeHttpPolicy(o.http),
    cwd: absolute(o.cwd),
    agentDir: absolute(o.agentDir),
    tokenSource,
    tokenFile,
  };
}
/** A stopped workspace may switch only its port and token source, and only to
 * the server configuration; any other selected difference stays a conflict. */
export function reselectable(old: HostConfig, next: HostConfig): boolean {
  const kept = (c: HostConfig) =>
    encoded({
      ...c,
      http: { ...c.http, port: 0 },
      tokenSource: null,
      tokenFile: null,
    });
  return next.tokenSource === "config" && kept(old) === kept(next);
}
export function readHostConfig(c: ServiceCoordination): HostConfig | undefined {
  const owner = c.configuration();
  if (!owner) return undefined;
  const snapshot = c.files.read(c.path("host-config.json"));
  if (!snapshot) throw new ContractError("corrupt-selected");
  const config = decodeHostConfig(json(snapshot));
  if (
    !config.http.port ||
    owner.endpoint !== localOrigin(config.http, config.http.port) ||
    owner.policyIdentity !== hash(encoded(config))
  )
    throw new ContractError("conflict");
  return config;
}
/** Freeze ordinary launch inputs without access/control injection. The SAME
 * worker route policy validates selected own-data facts; no direct fallback. */
export function hostEnvironment(ambient: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let route: ReturnType<typeof sdkNetworkEnvironment>;
  const facts = networkSnapshot(ambient);
  try {
    // Service startup has always refused preloads, even in DIRECT.
    if (facts.NODE_OPTIONS.present) throw new Error();
    route = sdkNetworkEnvironment(facts, networkSnapshot(undefined));
  } catch {
    throw new ContractError("unsupported-context");
  }
  const result: NodeJS.ProcessEnv = Object.create(null);
  for (const key of Object.keys(ambient)) {
    const d = Object.getOwnPropertyDescriptor(ambient, key);
    if (!d || !("value" in d) || typeof d.value !== "string")
      throw new ContractError("invalid");
    if (
      /^(?:CADENCE_|PI_|ABEL_|TRELLIS_|GIT_)/i.test(key) ||
      networkKeys.some((name) => name === key)
    )
      continue;
    result[key] = d.value;
  }
  if (route.redactionLiterals.length) {
    result.HTTP_PROXY = route.env.HTTP_PROXY;
    result.HTTPS_PROXY = route.env.HTTPS_PROXY;
    result.NODE_USE_ENV_PROXY = "1";
  }
  result.PI_OFFLINE = "1";
  result.NO_COLOR = "1";
  if (!sameNetwork(facts, networkSnapshot(ambient)))
    throw new ContractError("stale");
  return result;
}
export function selectStart(
  options: StartOptions,
  ambient: NodeJS.ProcessEnv,
): HostInput {
  const workspace = resolveWorkspace(options.workspace),
    c = new ServiceCoordination(workspace.root, options.stateHome);
  const old = readHostConfig(c);
  const env = Object.getOwnPropertyDescriptor(ambient, "CADENCE_WEB_TOKEN");
  if (env && (!("value" in env) || typeof env.value !== "string"))
    throw new ContractError("invalid");
  let fromFile: HostConfig | undefined;
  if (options.config) {
    const path = resolve(options.config),
      f = new PrivateFiles(dirname(path));
    const bytes = f.read(path);
    if (!bytes) throw new ContractError("corrupt-selected");
    fromFile = decodeHostConfig(json(bytes));
  }
  const base =
    old ??
    fromFile ??
    decodeHostConfig({
      schema: "cadence-service-host/1",
      cwd: workspace.cwd,
      http: {
        schema: "cadence-service-http/1",
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 17423,
        proxy: null,
      },
      agentDir: resolve(
        options.agentDir ??
          ambient.PI_CODING_AGENT_DIR ??
          join(
            ambient.HOME ?? ambient.USERPROFILE ?? homedir(),
            ".pi",
            "agent",
          ),
      ),
      tokenSource: options.tokenFile
        ? "file"
        : env
          ? "environment"
          : "generated",
      tokenFile: options.tokenFile ? resolve(options.tokenFile) : null,
    });
  // The server configuration is authoritative for the port and token, named
  // explicitly or by a selection that already reads its token from it. A
  // stopped workspace selected otherwise is reselected by the host.
  const server =
    options.serverConfig !== undefined
      ? resolve(options.serverConfig)
      : old?.tokenSource === "config"
        ? old.tokenFile
        : null;
  let selected = base;
  if (server) {
    if (options.tokenFile !== undefined) throw new ContractError("conflict");
    const { port } = readServerConfig(server).config;
    selected = decodeHostConfig({
      ...base,
      http: { ...base.http, port },
      tokenSource: "config",
      tokenFile: server,
    });
  }
  if (
    (fromFile && encoded(fromFile) !== encoded(selected)) ||
    (options.port !== undefined && options.port !== selected.http.port) ||
    (options.host !== undefined && options.host !== selected.http.host) ||
    (options.agentDir !== undefined &&
      resolve(options.agentDir) !== selected.agentDir) ||
    (options.tokenFile !== undefined &&
      resolve(options.tokenFile) !== selected.tokenFile) ||
    (env && selected.tokenSource !== "environment") ||
    (selected.tokenSource === "environment" && !env) ||
    resolveWorkspace(selected.cwd).root !== workspace.root
  )
    throw new ContractError("conflict");
  return {
    workspace: workspace.root,
    stateHome: c.stateHome,
    config: selected,
    environmentToken: env?.value ?? null,
  };
}
export function decodeHostInput(value: unknown): HostInput {
  const o = closed(value, [
    "workspace",
    "stateHome",
    "config",
    "environmentToken",
  ]);
  const config = decodeHostConfig(o.config);
  const environmentToken =
    o.environmentToken === null ? null : text(o.environmentToken, 1024, true);
  if ((config.tokenSource === "environment") !== (environmentToken !== null))
    throw new ContractError("invalid");
  return {
    workspace: absolute(o.workspace),
    stateHome: absolute(o.stateHome),
    config,
    environmentToken,
  };
}
export function portValue(value: string): number {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(value)) throw new ContractError("invalid");
  return integer(Number(value), 0, 65535);
}
/** Where a host refused: fixed labels, never paths, configuration bytes or OS text. */
export const STARTUP_STAGES = [
  "package",
  "pi-agent-directory",
  "pi-auth",
  "pi-models",
  "pi-runtime",
  "service",
] as const;
export type StartupStage = (typeof STARTUP_STAGES)[number];
/** `quarantined`: an owner registration was acquired first and stays fenced
 * for informed recovery; otherwise nothing was registered. */
export class StartupRefusal extends ContractError {
  constructor(
    code: ErrorCode,
    readonly stage: StartupStage,
    readonly quarantined = false,
  ) {
    super(code);
  }
}
export interface StartupReport {
  status: "refused" | "quarantined";
  error: ErrorCode;
  stage: StartupStage;
}
export function startupReport(error: unknown): StartupReport {
  if (error instanceof StartupRefusal)
    return {
      status: error.quarantined ? "quarantined" : "refused",
      error: error.code,
      stage: error.stage,
    };
  return {
    status: "refused",
    error: error instanceof ContractError ? error.code : "unavailable",
    stage: "service",
  };
}
export function decodeStartupReport(value: unknown): StartupReport {
  const o = closed(value, ["status", "error", "stage"]);
  return {
    status: oneOf(o.status, ["refused", "quarantined"]),
    error: oneOf(o.error, ERROR_CODES),
    stage: oneOf(o.stage, STARTUP_STAGES),
  };
}
