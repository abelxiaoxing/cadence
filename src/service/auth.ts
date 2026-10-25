// Token/cookie/digest admission adapted from xing-shuyin/pi-web-ui (MIT),
// e8bab487af208bc9a1ab60a821652323f598127f. See provenance/auth-reuse.json.
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { dirname, isAbsolute, join } from "node:path";
import {
  ContractError,
  decodeId,
  LIMITS,
  utf8Bytes,
} from "../service-contract.ts";
import { type HttpPolicy, loopbackAddress } from "./config.ts";
import { closed, integer, literal, oneOf } from "./contracts/core.ts";
import type { Caller } from "./ports.ts";
import {
  encoded,
  type FileSnapshot,
  json,
  PrivateFiles,
} from "./private-files.ts";
import {
  CONFIG_BYTES,
  readServerConfig,
  type ServerConfigFile,
  TOKEN_BYTES,
  accessToken as token,
  withToken,
} from "./server-config.ts";

/** `serverConfig`: the path of the user's `.env` and the CADENCE_TOKEN the
 * host read from it once, before binding, like an environment token. */
export type TokenSource =
  | {
      environment: string;
      tokenFile?: never;
      serverConfig?: never;
      token?: never;
    }
  | {
      tokenFile: string;
      environment?: never;
      serverConfig?: never;
      token?: never;
    }
  | {
      serverConfig: string;
      token: string;
      environment?: never;
      tokenFile?: never;
    }
  | {
      environment?: never;
      tokenFile?: never;
      serverConfig?: never;
      token?: never;
    };
export function sameSecret(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
export function buildTokenCookie(
  name: string,
  encodedValue: string,
  maxAge: number,
  secure: boolean,
): string {
  return `${name}=${encodedValue}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export function decodeCookieToken(raw: string): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
function cookieTokens(header: string | undefined, name: string): string[] {
  if (!header) return [];
  let found = false;
  const out: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    if (found) throw new ContractError("invalid");
    found = true;
    const raw = rest.join("=").trim();
    out.push(raw, decodeCookieToken(raw));
  }
  return out;
}
interface AccessConfig {
  schema: "cadence-service-access-config/1";
  source: "generated" | "environment" | "file" | "config";
  path: string | null;
}
interface AccessRecord {
  schema: "cadence-service-access/1";
  generation: number;
  token: string | null;
}
function sourceConfig(source: TokenSource): AccessConfig {
  const given = [source.environment, source.tokenFile, source.serverConfig];
  if (given.filter((v) => v !== undefined).length > 1)
    throw new ContractError("invalid");
  if (source.environment !== undefined) token(source.environment);
  if (source.serverConfig !== undefined) token(source.token);
  const path = source.tokenFile ?? source.serverConfig;
  if (path !== undefined && (!isAbsolute(path) || path.includes("\0")))
    throw new ContractError("invalid");
  return {
    schema: "cadence-service-access-config/1",
    source:
      source.environment !== undefined
        ? "environment"
        : source.tokenFile !== undefined
          ? "file"
          : source.serverConfig !== undefined
            ? "config"
            : "generated",
    path: path ?? null,
  };
}
function readSource(config: AccessConfig): void {
  if (config.source === "file" && config.path) readExternal(config.path);
}
/** Intact existing material of a stopped workspace, and the server
 * configuration it would switch to. */
function selectedMaterial(
  files: PrivateFiles,
  directory: string,
  source: TokenSource,
) {
  const config = sourceConfig(source);
  if (config.source !== "config") throw new ContractError("invalid");
  const marker = join(directory, "access-config.json"),
    access = join(directory, "access.json");
  const markerFile = files.read(marker),
    accessFile = files.read(access);
  if (!markerFile || !accessFile) throw new ContractError("corrupt-selected");
  const previous = closed(json(markerFile), ["schema", "source", "path"]);
  literal(previous.schema, "cadence-service-access-config/1");
  oneOf(previous.source, ["generated", "environment", "file", "config"]);
  const r = closed(json(accessFile), ["schema", "generation", "token"]);
  literal(r.schema, "cadence-service-access/1");
  const generation = integer(r.generation, 1);
  if ((previous.source === "generated") !== (r.token !== null))
    throw new ContractError("corrupt-selected");
  return {
    config,
    previous,
    generation,
    marker,
    markerFile,
    access,
    accessFile,
  };
}
/** Explicit private setup/load, never called by GET/import. Access marker is written
 * first: interrupted initialization/missing existing material cannot be reset. */
export class AccessMaterial {
  private configFile: FileSnapshot;
  private accessFile: FileSnapshot;
  private externalFile: FileSnapshot | undefined;
  private external: PrivateFiles | undefined;
  private record: AccessRecord;
  private secret: string;
  private fenced = false;
  private listeners = new Set<() => void>();
  readonly config: AccessConfig;
  static validateSource(source: TokenSource): void {
    readSource(sourceConfig(source));
  }
  static initialize(
    files: PrivateFiles,
    directory: string,
    source: TokenSource = {},
  ): void {
    const config = sourceConfig(source);
    const marker = join(directory, "access-config.json"),
      access = join(directory, "access.json");
    if (
      files.read(marker) ||
      files.read(access) ||
      files.read(join(directory, "registration.json")) ||
      files.read(join(directory, "owner.lock"))
    )
      throw new ContractError("conflict");
    readSource(config);
    files.create(marker, encoded(config));
    files.create(
      access,
      encoded({
        schema: "cadence-service-access/1",
        generation: 1,
        token:
          config.source === "generated"
            ? randomBytes(32).toString("base64url")
            : null,
      }),
    );
  }
  /** Validation only, before any reservation: a stopped workspace's existing
   * material must be intact to be reselected. */
  static validateReselection(
    files: PrivateFiles,
    directory: string,
    source: TokenSource,
  ): void {
    selectedMaterial(files, directory, source);
  }
  /** Explicit reselection of a stopped workspace to the server configuration,
   * called only under the owner reservation; a changed source retires the
   * previous token with a new generation. */
  static reselect(
    files: PrivateFiles,
    directory: string,
    source: TokenSource,
  ): void {
    const m = selectedMaterial(files, directory, source);
    if (encoded(m.previous) === encoded(m.config)) return;
    files.replace(m.marker, m.markerFile, encoded(m.config));
    files.replace(
      m.access,
      m.accessFile,
      encoded({
        schema: "cadence-service-access/1",
        generation: integer(m.generation + 1, 1),
        token: null,
      }),
    );
  }
  constructor(
    private readonly files: PrivateFiles,
    private readonly directory: string,
    source: TokenSource = {},
    /** Real host binds its rotation lease; readonly access has its own guards. */
    private readonly assertOwner?: () => void,
  ) {
    this.config = sourceConfig(source);
    const configFile = files.read(join(directory, "access-config.json"));
    const accessFile = files.read(join(directory, "access.json"));
    if (!configFile || !accessFile) throw new ContractError("corrupt-selected");
    const c = closed(json(configFile), ["schema", "source", "path"]);
    if (encoded(c) !== encoded(this.config))
      throw new ContractError("conflict");
    const r = closed(json(accessFile), ["schema", "generation", "token"]);
    this.record = {
      schema: literal(r.schema, "cadence-service-access/1"),
      generation: integer(r.generation, 1),
      token: r.token === null ? null : token(r.token),
    };
    if ((this.config.source === "generated") !== (this.record.token !== null))
      throw new ContractError("corrupt-selected");
    if (this.config.source === "file" && this.config.path) {
      const loaded = readExternal(this.config.path);
      this.external = loaded.files;
      this.externalFile = loaded.file;
      this.secret = loaded.token;
    }
    // A server configuration is not bound for the run: editing it while the
    // owner runs must not fence access (and with it the orderly Stop).
    else
      this.secret = token(
        this.record.token ?? source.environment ?? source.token,
      );
    this.configFile = configFile;
    this.accessFile = accessFile;
  }
  get generation(): number {
    return this.record.generation;
  }
  get available(): boolean {
    return !this.fenced;
  }
  matches(candidate: string): boolean {
    return (
      !this.fenced &&
      utf8Bytes(candidate) <= TOKEN_BYTES &&
      sameSecret(candidate, this.secret)
    );
  }
  onRevoke(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private revoke(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        this.fenced = true;
      }
    }
  }
  assertCurrent(): void {
    try {
      this.assert();
    } catch {
      this.fenced = true;
      this.revoke();
      throw new ContractError("quarantine");
    }
  }
  private assert(): void {
    if (this.fenced) throw new ContractError("quarantine");
    this.files.assert(
      join(this.directory, "access-config.json"),
      this.configFile,
    );
    this.files.assert(join(this.directory, "access.json"), this.accessFile);
    if (this.config.source === "file" && this.config.path)
      this.external?.assert(this.config.path, this.externalFile, TOKEN_BYTES);
  }
  /** Owner-only redaction material. Never a client DTO or child environment. */
  redactionLiterals(): readonly string[] {
    this.assertCurrent();
    return [this.secret];
  }
  /** Management-only explicit reveal. The HTTP API never returns this value. */
  tokenLink(origin: string): string {
    this.assert();
    const url = new URL(origin);
    if (url.origin !== origin) throw new ContractError("invalid");
    return `${origin}/?token=${encodeURIComponent(this.secret)}`;
  }
  private assertRotation(): void {
    this.assertOwner?.();
    this.assert();
  }
  /** Durable replacement before generation revocation. Any uncertain effect fences
   * all access, invalidates grants/sockets, and preserves selected/temporary files. */
  rotate(): void {
    if (this.config.source === "environment")
      throw new ContractError("unsupported-context");
    // The server configuration is the user's file: one whose token no longer
    // matches the running one holds a pending edit, refused before any effect.
    let configured: ServerConfigFile | undefined;
    if (this.config.source === "config" && this.config.path) {
      configured = readServerConfig(this.config.path);
      if (!sameSecret(configured.config.token, this.secret))
        throw new ContractError("conflict");
    }
    try {
      this.assertRotation();
      const secret = randomBytes(32).toString("base64url");
      const generation = integer(this.record.generation + 1, 1);
      if (this.config.path && this.external && this.externalFile)
        this.externalFile = this.external.replace(
          this.config.path,
          this.externalFile,
          secret,
          TOKEN_BYTES,
        );
      // Only the token line changes; the port, possibly edited for the next
      // start, and every research setting stay.
      if (configured)
        configured.files.replace(
          configured.path,
          configured.snapshot,
          withToken(configured, secret),
          CONFIG_BYTES,
        );
      const record: AccessRecord = {
        ...this.record,
        generation,
        token: this.config.source === "generated" ? secret : null,
      };
      // The external replacement is a separate effect: its completion does not
      // attest the remaining access/config/lease incarnations. Never continue
      // publishing after any of them changed, even if our target still matches.
      this.assertRotation();
      this.accessFile = this.files.replace(
        join(this.directory, "access.json"),
        this.accessFile,
        encoded(record),
      );
      this.assertRotation();
      this.record = record;
      this.secret = secret;
      this.revoke();
      if (this.fenced) throw new ContractError("quarantine");
    } catch {
      this.fenced = true;
      this.revoke();
      throw new ContractError("quarantine");
    }
  }
}
function readExternal(path: string): {
  files: PrivateFiles;
  file: FileSnapshot;
  token: string;
} {
  const files = new PrivateFiles(dirname(path));
  const file = files.read(path, TOKEN_BYTES);
  if (!file) throw new ContractError("corrupt-selected");
  try {
    return {
      files,
      file,
      token: token(
        new TextDecoder("utf-8", { fatal: true }).decode(file.bytes),
      ),
    };
  } catch {
    throw new ContractError("corrupt-selected");
  }
}

export interface RequestBoundary {
  origin: string;
  secure: boolean;
  local: boolean;
  headers: Map<string, string>;
}
/** Check raw multiplicity before Node's merged headers. No forwarded chains or
 * unsolicited forwarding assertions, including on public routes. */
export function requestBoundary(
  req: IncomingMessage,
  policy: HttpPolicy,
  directOrigin: string,
): RequestBoundary {
  const headers = new Map<string, string>();
  let bytes = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase(),
      value = req.rawHeaders[i + 1];
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (headers.has(name)) throw new ContractError("invalid");
    headers.set(name, value);
  }
  if (bytes > LIMITS.headerBytes) throw new ContractError("oversize");
  const forwarded = [...headers.keys()].filter(
    (n) =>
      n === "forwarded" || n.startsWith("x-forwarded-") || n === "x-real-ip",
  );
  const address = req.socket.remoteAddress ?? "";
  if (!loopbackAddress(address)) throw new ContractError("forbidden");
  const proxy = policy.proxy;
  const proxied = forwarded.length > 0;
  let origin = directOrigin;
  if (proxied) {
    if (
      !proxy?.trustedAddresses.includes(address) ||
      forwarded.length !== 1 ||
      forwarded[0] !== "x-forwarded-proto" ||
      headers.get("x-forwarded-proto") !== "https"
    )
      throw new ContractError("forbidden");
    origin = proxy.origin;
  }
  if (headers.get("host") !== new URL(origin).host)
    throw new ContractError("forbidden");
  const incomingOrigin = headers.get("origin");
  if (incomingOrigin !== undefined && incomingOrigin !== origin)
    throw new ContractError("forbidden");
  return {
    origin,
    secure: proxied,
    local: !proxied && incomingOrigin === undefined,
    headers,
  };
}
export class HttpAuthentication {
  readonly csrf = randomUUID();
  readonly cookieName: string;
  constructor(
    readonly material: AccessMaterial,
    readonly epoch: string,
    workspaceId: string,
    private readonly localCapability: string,
  ) {
    decodeId(epoch);
    decodeId(workspaceId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(localCapability))
      throw new ContractError("invalid");
    this.cookieName = `cadence_${workspaceId.replaceAll("-", "")}`;
  }
  bootstrap(value: string, boundary: RequestBoundary): string {
    this.material.assertCurrent();
    const h = boundary.headers;
    const site = h.get("sec-fetch-site");
    // The cross-site exception is for deliberate top-level token navigation,
    // not fetches, images or frames. Nonbrowser clients need no fetch metadata.
    if (
      site !== undefined &&
      !["same-origin", "none"].includes(site) &&
      (!["same-site", "cross-site"].includes(site) ||
        h.get("sec-fetch-mode") !== "navigate" ||
        h.get("sec-fetch-dest") !== "document")
    )
      throw new ContractError("forbidden");
    if (!this.material.matches(value))
      throw new ContractError("unauthenticated");
    return buildTokenCookie(
      this.cookieName,
      encodeURIComponent(value),
      LIMITS.browserLifetimeMs / 1000,
      boundary.secure,
    );
  }
  authenticate(
    boundary: RequestBoundary,
    attachmentId: string,
    mutation = false,
    websocket = false,
  ): Caller {
    this.material.assertCurrent();
    if (!this.material.available) throw new ContractError("quarantine");
    const h = boundary.headers;
    const local = h.get("x-cadence-local");
    if (local !== undefined) {
      if (
        !boundary.local ||
        h.has("cookie") ||
        // Node's native Fetch supplies this lone mode header too. Site/dest/user
        // metadata (or any other mode) is not part of the native client route.
        [...h.keys()].some(
          (name) =>
            name.startsWith("sec-fetch-") &&
            (name !== "sec-fetch-mode" || h.get(name) !== "cors"),
        ) ||
        !sameSecret(local, this.localCapability)
      )
        throw new ContractError("forbidden");
    } else {
      if (h.has("authorization") || h.has("x-cadence-token"))
        throw new ContractError("forbidden");
      if (
        !cookieTokens(h.get("cookie"), this.cookieName).some((v) =>
          this.material.matches(v),
        )
      )
        throw new ContractError("unauthenticated");
      if (
        h.has("sec-fetch-site") &&
        !["same-origin", "none"].includes(h.get("sec-fetch-site") ?? "")
      )
        throw new ContractError("forbidden");
      if ((mutation || websocket) && h.get("origin") !== boundary.origin)
        throw new ContractError("forbidden");
      if (mutation && h.get("x-cadence-csrf") !== this.csrf)
        throw new ContractError("forbidden");
    }
    return {
      attachmentId: decodeId(attachmentId),
      authority: local === undefined ? "browser" : "local",
      accessGeneration: this.material.generation,
    };
  }
  current(caller: Caller): void {
    this.material.assertCurrent();
    if (
      !this.material.available ||
      caller.accessGeneration !== this.material.generation
    )
      throw new ContractError("unauthenticated");
  }
}
