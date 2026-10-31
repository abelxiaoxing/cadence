// Pre-upgrade auth/cookie ordering adapted from pi-web-ui server/index.ts (MIT).
// This is a transport, not a task/history/execution owner.
import { createHash, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import {
  type ClientBuild,
  ContractError,
  canonicalJson,
  compareSequence,
  compatibleBuild,
  decodeChooseModelRequest,
  decodeClientBuild,
  decodeCurrentChangesRequest,
  decodeCurrentRequest,
  decodeCursor,
  decodeEntityReadRequest,
  decodeExportRequest,
  decodeGraphReadRequest,
  decodeId,
  decodeListRequest,
  decodeLiveEvent,
  decodePublicError,
  decodeReceiptLookup,
  decodeScope,
  decodeServiceBuild,
  decodeSessionBootstrap,
  decodeSnapshot,
  ExportTracker,
  encodeExportFrame,
  errorStatus,
  LIMITS,
  type LiveEvent,
  parseWireJson,
  publicError,
  type ReceiptLookup,
  type Scope,
  type ServiceBuild,
  type Snapshot,
} from "../service-contract.ts";
import {
  assertRequestTarget,
  decodeHttpInput,
  decodeHttpOutput,
  decodeSocketInput,
  type HttpOperation,
  mutation,
  readRoute,
  type SocketOutput,
  WS_PATH,
} from "../service-wire.ts";
import { type HttpAuthentication, requestBoundary } from "./auth.ts";
import { decodeHttpPolicy, type HttpPolicy, localOrigin } from "./config.ts";
import { closed, list } from "./contracts/core.ts";
import type { WorkbenchPort } from "./contracts/workbench.ts";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
} from "./contracts/workbench.ts";
import type {
  Caller,
  CurrentMetadataPort,
  ModelChoicePort,
  ProjectionPort,
} from "./ports.ts";
import { UnacceptedConversationCommand } from "./workbench-send-refusal.ts";

/** Real composition must provide committed projections. subscribe registers
 * synchronously BEFORE snapshot; callbacks must never await a viewer. watermark
 * reports actual current committed state (not this viewer's last delivered seq). */
export interface LiveProjectionPort {
  subscribe(scope: Scope, onEvent: (event: LiveEvent) => void): () => void;
  watermark(scope: Scope): LiveEvent;
}
export interface HttpAdapters {
  workbench?: WorkbenchPort;
  attachments?: { detach(id: string): void; revokeGrants(): void };
  models?: Pick<ModelChoicePort, "catalog">;
  modelChoice?: Pick<ModelChoicePort, "choose">;
  current?: CurrentMetadataPort;
  projection: ProjectionPort | null;
  receipts: ((id: string) => Promise<ReceiptLookup>) | null;
  live: LiveProjectionPort | null;
}
export interface ManagementPort {
  invoke(
    operation: "status" | "diagnose" | "stop" | "token-link" | "token-rotate",
  ): unknown;
}
interface HttpConfiguration {
  build?: ServiceBuild;
  auth: HttpAuthentication;
  adapters: HttpAdapters;
  management?: ManagementPort;
}
export interface StaticAsset {
  path: string;
  contentType:
    | "text/html; charset=utf-8"
    | "text/javascript; charset=utf-8"
    | "text/css; charset=utf-8"
    | "font/woff2"
    | "font/woff"
    | "font/ttf"
    | "image/svg+xml";
  bytes: Uint8Array;
}
interface Attachment {
  caller: Caller;
  lastSeen: number;
  socket?: WebSocket;
}
interface Viewer {
  socket: WebSocket;
  attachment: Attachment;
  scope?: Scope;
  snapshot?: Snapshot;
  subscription: number;
  unsubscribe?: () => void;
  pending: LiveEvent[];
  bytes: number;
  sentBytes: number;
  sentMessages: number;
  reading: boolean;
  closed: boolean;
  lastPing: number;
  lastReconcile: number;
}
function refusal(
  code: ConstructorParameters<typeof ContractError>[0] = "invalid",
  uncertain = false,
) {
  return {
    kind: "error" as const,
    error: publicError(code, uncertain ? "uncertain" : "none"),
  };
}
export function fixedHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
}
function send(response: ServerResponse, status: number, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(canonicalJson(value, LIMITS.controlBytes));
}
function unavailable(): never {
  throw new ContractError("unavailable");
}

/** Explicit constructor + listen; import performs no reads/listens/SDK startup.
 * bind first with gates closed, acquire/register the actual endpoint, then admit(). */
export class ServiceHttpServer {
  readonly server: Server;
  readonly policy: HttpPolicy;
  private origin = "";
  private accepting = false;
  private stopped = false;
  private closePromise: Promise<void> | undefined;
  private sockets = new Set<Socket>();
  private serving = new Set<Socket>();
  private requests = new Set<AbortController>();
  private attachments = new Map<string, Attachment>();
  private viewers = new Set<Viewer>();
  private bodies = 0;
  private reads = 0;
  private exports = 0;
  private searches = 0;
  private assets = new Map<string, StaticAsset & { etag: string }>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.wsClientFrameBytes,
    perMessageDeflate: false,
    clientTracking: false,
  });
  private unRevoke: (() => void) | undefined;
  private configuration: HttpConfiguration | undefined;
  private get options(): HttpConfiguration {
    if (!this.configuration) unavailable();
    return this.configuration;
  }
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  constructor(options: {
    policy: HttpPolicy;
    auth?: HttpAuthentication;
    adapters?: HttpAdapters;
    management?: ManagementPort;
    assets?: readonly StaticAsset[];
    build?: ServiceBuild;
  }) {
    this.policy = decodeHttpPolicy(options.policy);
    // Fixed manifests only. No URL-to-filesystem mapping, discovery or repair.
    let total = 0;
    for (const asset of options.assets ?? []) {
      total += asset.bytes.byteLength;
      if (
        !/^\/(?:app|assets\/[a-zA-Z0-9_-]+\.(?:js|css|woff2|woff|ttf|svg))$/.test(
          asset.path,
        ) ||
        this.assets.has(asset.path) ||
        asset.bytes.byteLength > 16 * 1024 * 1024 ||
        total > 64 * 1024 * 1024
      )
        throw new ContractError("invalid");
      this.assets.set(asset.path, {
        ...asset,
        bytes: Uint8Array.from(asset.bytes),
        etag: `"${createHash("sha256").update(asset.bytes).digest("hex")}"`,
      });
    }
    this.server = createServer(
      {
        maxHeaderSize: LIMITS.headerBytes,
        headersTimeout: 10_000,
        requestTimeout: 30_000,
        keepAliveTimeout: 5000,
      },
      (req, res) => {
        void this.handle(req, res);
      },
    );
    this.server.maxConnections = 64;
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => this.sockets.delete(socket));
    });
    this.server.on("clientError", (_error, socket) => {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    this.server.on("checkContinue", (_req, res) => {
      fixedHeaders(res);
      send(res, 400, refusal());
    });
    this.server.on("upgrade", (req, socket, head) => {
      if (this.serving.has(req.socket)) {
        socket.destroy();
        return;
      }
      try {
        if (!this.accepting) unavailable();
        const boundary = requestBoundary(req, this.policy, this.origin);
        assertRequestTarget(req.url ?? "");
        const url = new URL(req.url ?? "", this.origin);
        if (
          req.method !== "GET" ||
          url.pathname !== WS_PATH ||
          req.url !==
            `${WS_PATH}?attachment=${url.searchParams.get("attachment")}`
        )
          throw new ContractError("invalid");
        const id = decodeId(url.searchParams.get("attachment"));
        const caller = this.options.auth.authenticate(
          boundary,
          id,
          false,
          true,
        );
        const attachment = this.attachment(caller);
        if (attachment.socket || this.viewers.size >= LIMITS.viewers)
          throw new ContractError("capacity");
        if (!this.options.adapters.projection || !this.options.adapters.live)
          unavailable();
        this.wss.handleUpgrade(req, socket, head, (ws) =>
          this.openViewer(ws, attachment),
        );
      } catch (error) {
        const status = errorStatus(
          error instanceof ContractError ? error.code : "unavailable",
        );
        socket.end(
          `HTTP/1.1 ${status} Refused\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: 0\r\n\r\n`,
        );
      }
    });
    if (options.auth || options.adapters) {
      if (!options.auth || !options.adapters)
        throw new ContractError("invalid");
      this.configure({
        auth: options.auth,
        adapters: options.adapters,
        management: options.management,
        build: options.build,
      });
    }
  }
  /** One-time real configuration after bind/lease, never an accepting placeholder. */
  configure(options: HttpConfiguration): void {
    if (this.configuration || this.accepting || this.stopped)
      throw new ContractError("conflict");
    this.configuration = {
      ...options,
      ...(options.build ? { build: decodeServiceBuild(options.build) } : {}),
    };
    this.unRevoke = options.auth.material.onRevoke(() => {
      options.adapters.attachments?.revokeGrants();
      for (const attachment of [...this.attachments.values()])
        this.detach(attachment);
      for (const request of this.requests) request.abort();
    });
  }
  async listen(): Promise<string> {
    if (this.origin || this.stopped) throw new ContractError("conflict");
    await new Promise<void>((resolve, reject) => {
      const failed = () => {
        this.server.off("listening", ready);
        reject(new ContractError("unavailable"));
      };
      const ready = () => {
        this.server.off("error", failed);
        resolve();
      };
      this.server.once("error", failed);
      this.server.once("listening", ready);
      this.server.listen({
        host: this.policy.host,
        port: this.policy.port,
        exclusive: true,
      });
    });
    this.server.on("error", () => this.quiesce());
    const address = this.server.address();
    if (!address || typeof address === "string") unavailable();
    this.origin = localOrigin(this.policy, address.port);
    return this.origin;
  }
  admit(): void {
    if (!this.origin || this.stopped || !this.options.auth.material.available)
      unavailable();
    this.accepting = true;
    this.heartbeat ??= setInterval(() => this.tick(), LIMITS.heartbeatMs);
  }
  quiesce(): void {
    this.accepting = false;
    this.configuration?.adapters.attachments?.revokeGrants();
  }
  /** Original native server/socket close, reusable by ServiceOwner stop. No workers
   * are canceled here. Production owner calls only after its own original drain. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    // Publish before quiesce/detach/unsubscribe callbacks can synchronously reenter.
    this.closePromise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void this.closeTransport().then(resolve, () =>
      reject(new ContractError("unavailable")),
    );
    return this.closePromise;
  }
  private async closeTransport(): Promise<void> {
    this.stopped = true;
    this.quiesce();
    clearInterval(this.heartbeat);
    this.unRevoke?.();
    for (const request of this.requests) request.abort();
    for (const attachment of [...this.attachments.values()])
      this.detach(attachment);
    const closedSockets = [...this.sockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.closed) resolve();
          else {
            socket.once("close", () => resolve());
            socket.destroy();
          }
        }),
    );
    const listener = new Promise<void>((resolve, reject) => {
      this.server.close((error) =>
        error ? reject(new ContractError("unavailable")) : resolve(),
      );
    });
    const upgrades = new Promise<void>((resolve) =>
      this.wss.close(() => resolve()),
    );
    await Promise.all([listener, upgrades, ...closedSockets]);
  }
  private attachment(caller: Caller): Attachment {
    this.options.auth.current(caller);
    const attachment = this.attachments.get(caller.attachmentId);
    if (
      !attachment ||
      attachment.caller.authority !== caller.authority ||
      attachment.caller.accessGeneration !== caller.accessGeneration
    )
      throw new ContractError("stale");
    attachment.lastSeen = Date.now();
    return attachment;
  }
  private detach(attachment: Attachment): void {
    if (this.attachments.get(attachment.caller.attachmentId) !== attachment)
      return;
    this.attachments.delete(attachment.caller.attachmentId);
    this.options.adapters.attachments?.detach(attachment.caller.attachmentId);
    if (attachment.socket) {
      for (const viewer of this.viewers)
        if (viewer.attachment === attachment) this.closeViewer(viewer);
    }
  }
  private async body(
    req: IncomingMessage,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.bodies >= LIMITS.admissionCount)
      throw new ContractError("capacity");
    this.bodies++;
    try {
      if (
        req.headers["content-type"] !== "application/json" ||
        req.headers["content-encoding"] !== undefined
      )
        throw new ContractError("invalid");
      const length = req.headers["content-length"];
      if (
        length !== undefined &&
        (!/^(0|[1-9][0-9]*)$/.test(length) ||
          Number(length) > LIMITS.controlBytes)
      )
        throw new ContractError("oversize");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const value of req.iterator({ destroyOnReturn: false })) {
        if (signal.aborted) throw new ContractError("unavailable");
        const chunk: Buffer = value;
        bytes += chunk.length;
        if (bytes > LIMITS.controlBytes) throw new ContractError("oversize");
        chunks.push(chunk);
      }
      try {
        return parseWireJson(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
          LIMITS.controlBytes,
        );
      } catch (e) {
        if (e instanceof ContractError) throw e;
        throw new ContractError("invalid");
      }
    } finally {
      this.bodies--;
    }
  }
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Do not accumulate unbounded pipelined responses behind a stalled read.
    // Ordinary sequential keep-alive remains supported; accepted effects are not
    // rolled back when an overlapping request closes its connection.
    if (this.serving.has(req.socket)) {
      req.socket.destroy();
      return;
    }
    this.serving.add(req.socket);
    res.once("close", () => this.serving.delete(req.socket));
    fixedHeaders(res);
    const abort = new AbortController();
    let counted = false;
    let dispatched = false;
    let createdAttachment: Attachment | undefined;
    const abortRead = () => abort.abort();
    res.once("close", abortRead);
    const timer = setTimeout(() => {
      abort.abort();
      res.destroy();
    }, LIMITS.downloadIdleMs);
    const resetIdle = () => timer.refresh();
    try {
      const boundary = requestBoundary(req, this.policy, this.origin);
      const target = req.url ?? "";
      assertRequestTarget(target);
      const url = new URL(target, this.origin);
      if (url.searchParams.has("token")) {
        if (
          req.method !== "GET" ||
          !target.startsWith("/?token=") ||
          [...url.searchParams.keys()].length !== 1
        )
          throw new ContractError("invalid");
        if (!this.accepting) unavailable();
        res.setHeader(
          "Set-Cookie",
          this.options.auth.bootstrap(
            url.searchParams.get("token") ?? "",
            boundary,
          ),
        );
        res.statusCode = 303;
        res.setHeader("Location", "/app");
        res.end();
        return;
      }
      if (target === "/healthz" && req.method === "GET") {
        send(res, 200, { status: "ok" });
        return;
      }
      if (target === "/" && req.method === "GET") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(
          "Cadence: enter with the private link that `cadence server install` printed, http://127.0.0.1:<CADENCE_PORT>/?token=<CADENCE_TOKEN> from ~/.pi/agent/cadence/.env, or that `cadence token-link --workspace <path> --reveal` prints on this machine.\n",
        );
        return;
      }
      if (target.startsWith("/local/v1/admin/")) {
        await this.manage(req, res, boundary, abort.signal);
        return;
      }
      if (!this.accepting) unavailable();
      const route = readRoute(target, req.method ?? "");
      const attachmentId =
        boundary.headers.get("x-cadence-attachment") ?? randomUUID();
      // POST Origin/CSRF security applies to readonly bodies too; this does not
      // change admission, effect reporting, grants or the readonly reader pool.
      const caller = this.options.auth.authenticate(
        boundary,
        attachmentId,
        route?.source === "body",
      );
      // Authentication occurs before parsing any private request JSON/control body.
      if (!route || !mutation(route.operation)) {
        if (this.reads >= 32) throw new ContractError("capacity");
        this.reads++;
        counted = true;
      }
      this.requests.add(abort);
      if (!route) {
        const asset = this.assets.get(target);
        if (!asset || req.method !== "GET") throw new ContractError("invalid");
        this.options.auth.current(caller);
        res.setHeader("Content-Type", asset.contentType);
        if (target !== "/app") {
          res.setHeader("Cache-Control", "private, no-cache");
          res.setHeader("ETag", asset.etag);
          if (boundary.headers.get("if-none-match") === asset.etag) {
            res.statusCode = 304;
            res.end();
            return;
          }
        }
        res.end(asset.bytes);
        return;
      }
      let attachment: Attachment | undefined;
      if (route.operation === "session") {
        attachment = this.attachments.get(attachmentId);
        if (attachment) this.attachment(caller);
        else {
          for (const value of this.attachments.values())
            if (
              !value.socket &&
              Date.now() - value.lastSeen > LIMITS.browserLifetimeMs
            )
              this.detach(value);
          if (this.attachments.size >= LIMITS.viewers)
            throw new ContractError("capacity");
          attachment = { caller, lastSeen: Date.now() };
          createdAttachment = attachment;
          this.attachments.set(attachmentId, attachment);
        }
        res.setHeader("X-Cadence-Attachment", attachmentId);
      } else if (route.source === "body") attachment = this.attachment(caller);
      const input =
        route.source === "body"
          ? await this.body(req, abort.signal)
          : route.input === null
            ? null
            : parseWireJson(route.input);
      if (
        route.source !== "body" &&
        (req.headers["content-encoding"] !== undefined ||
          req.headers["transfer-encoding"] ||
          (req.headers["content-length"] &&
            req.headers["content-length"] !== "0"))
      )
        throw new ContractError("invalid");
      decodeHttpInput(route.operation, input);
      this.options.auth.current(caller);
      if (abort.signal.aborted || !this.accepting) unavailable();
      if (attachment && this.attachment(caller) !== attachment)
        throw new ContractError("stale");
      if (route.operation === "export" || route.operation === "download") {
        await this.export(
          route.operation,
          input,
          caller,
          abort.signal,
          res,
          resetIdle,
        );
        return;
      }
      const rawBuild = boundary.headers.get("x-cadence-build");
      const clientBuild =
        rawBuild === undefined
          ? null
          : decodeClientBuild(parseWireJson(rawBuild, 1024));
      if (caller.authority === "browser" && clientBuild?.kind === "native")
        throw new ContractError("forbidden");
      if (
        [
          "preflight",
          "command",
          "chooseModel",
          "cancel",
          "workbenchCommand",
        ].includes(route.operation) &&
        !compatibleBuild(
          this.options.build,
          clientBuild,
          route.operation === "cancel" ||
            (route.operation === "workbenchCommand" &&
              decodeWorkbenchCommand(input).kind === "interrupt"),
        )
      )
        throw new ContractError("unsupported-context");
      dispatched =
        route.operation === "command" ||
        route.operation === "cancel" ||
        route.operation === "chooseModel" ||
        route.operation === "workbenchCommand";
      const value = await this.dispatch(
        route.operation,
        input,
        caller,
        abort.signal,
        clientBuild,
      );
      // Rotation while a readonly adapter awaits must not deliver its private result.
      this.options.auth.current(caller);
      if (abort.signal.aborted) unavailable();
      if (route.operation === "session") this.attachment(caller);
      const decoded = decodeHttpOutput(route.operation, value);
      const status =
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "error" &&
        "error" in value
          ? errorStatus(decodePublicError(value.error).code)
          : 200;
      send(res, status, decoded);
    } catch (e) {
      // A failed initial session must not occupy a 12-hour slot that the client
      // never successfully acquired. Existing attachments are not reset on error.
      if (createdAttachment) this.detach(createdAttachment);
      if (!res.headersSent) res.removeHeader("X-Cadence-Attachment");
      if (res.headersSent) res.destroy();
      else {
        const code = e instanceof ContractError ? e.code : "unavailable";
        res.setHeader("Connection", "close");
        send(
          res,
          errorStatus(code),
          refusal(
            code,
            dispatched && !(e instanceof UnacceptedConversationCommand),
          ),
        );
      }
    } finally {
      clearTimeout(timer);
      res.off("close", abortRead);
      this.requests.delete(abort);
      if (counted) this.reads--;
    }
  }
  private async manage(
    req: IncomingMessage,
    res: ServerResponse,
    boundary: import("./auth.ts").RequestBoundary,
    signal: AbortSignal,
  ): Promise<void> {
    const operation = req.url?.slice("/local/v1/admin/".length);
    if (
      ![
        "status",
        "diagnose",
        "stop",
        "token-link",
        "token-rotate",
        "detach-viewers",
      ].includes(operation ?? "")
    )
      throw new ContractError("invalid");
    const write = operation !== "status" && operation !== "diagnose";
    const caller = this.options.auth.authenticate(
      boundary,
      randomUUID(),
      write,
    );
    if (caller.authority !== "local") throw new ContractError("forbidden");
    if (req.method !== (write ? "POST" : "GET"))
      throw new ContractError("invalid");
    if (write) {
      const body = closed(
        await this.body(req, signal),
        operation === "token-link"
          ? ["reveal"]
          : operation === "detach-viewers"
            ? ["attachments"]
            : [],
      );
      if (operation === "detach-viewers") {
        const ids = list(body.attachments, LIMITS.viewers, decodeId);
        this.options.auth.current(caller);
        if (signal.aborted) unavailable();
        for (const id of ids) {
          const attachment = this.attachments.get(id);
          if (attachment?.caller.authority === "browser")
            this.detach(attachment);
        }
        send(res, 200, {
          kind: "ok",
          value: { status: "detached", epoch: this.options.auth.epoch },
        });
        return;
      }
      if (operation === "token-link" && body.reveal !== true)
        throw new ContractError("forbidden");
    } else if (
      req.headers["transfer-encoding"] ||
      req.headers["content-encoding"] ||
      (req.headers["content-length"] && req.headers["content-length"] !== "0")
    )
      throw new ContractError("invalid");
    this.options.auth.current(caller);
    if (signal.aborted || !this.options.management) unavailable();
    // Stop returns an authenticated acknowledgement, never awaits its own socket
    // close. The CLI subsequently observes exact-epoch completed lease release.
    const value = this.options.management.invoke(
      operation as Parameters<ManagementPort["invoke"]>[0],
    );
    send(res, 200, { kind: "ok", value });
  }
  private async dispatch(
    operation: HttpOperation,
    input: unknown,
    caller: Caller,
    signal: AbortSignal,
    build: ClientBuild | null,
  ): Promise<unknown> {
    const a = this.options.adapters,
      p = a.projection;
    switch (operation) {
      case "workbenchRead":
        if (!a.workbench) unavailable();
        return {
          kind: "ok",
          value: a.workbench.read(decodeWorkbenchRead(input)),
        };
      case "workbenchCommand": {
        if (!a.workbench) unavailable();
        const command = decodeWorkbenchCommand(input);
        // Workflow confirmation currently belongs to the native conversation.
        // A browser access token alone cannot mint local shell/merge authority.
        if (command.kind === "workflow" && caller.authority !== "local")
          throw new ContractError("forbidden");
        return {
          kind: "ok",
          value: await a.workbench.command(command, caller),
        };
      }
      case "current":
        if (!a.current) unavailable();
        return {
          kind: "ok",
          value: await a.current.current(decodeCurrentRequest(input), signal),
        };
      case "currentChanges":
        if (!a.current) unavailable();
        return {
          kind: "ok",
          value: await a.current.currentChanges(
            decodeCurrentChangesRequest(input),
            signal,
          ),
        };
      case "activeRuns":
        if (!a.current) unavailable();
        return { kind: "ok", value: await a.current.activeRuns(signal) };
      case "models":
        if (!a.models) unavailable();
        return { kind: "ok", value: a.models.catalog() };
      case "chooseModel":
        if (!a.modelChoice) unavailable();
        return {
          kind: "ok",
          value: a.modelChoice.choose(decodeChooseModelRequest(input)),
        };
      case "detach":
        this.detach(this.attachment(caller));
        return { kind: "ok", value: null };
      // Retired task controls cannot mint a grant or dispatch old work, even
      // through a stale client. Receipts/history and explicit Cancel remain.
      case "preflight":
      case "command":
        return refusal("unsupported-context");
      case "cancel":
        // Old run identities are archived data, not handles to current processes.
        return refusal("unsupported-context");
      case "receipt":
        return a.receipts
          ? decodeReceiptLookup(await a.receipts(decodeId(input)))
          : {
              status: "inconclusive",
              error: publicError("receipt-inconclusive", "uncertain"),
            };
    }
    if (!p) unavailable();
    let value: unknown;
    switch (operation) {
      case "session": {
        const original = decodeSessionBootstrap(await p.session());
        if (
          original.epoch !== this.options.auth.epoch ||
          original.accessGeneration !== caller.accessGeneration
        )
          throw new ContractError("stale");
        value = decodeSessionBootstrap({
          ...original,
          ...(this.options.build ? { build: this.options.build } : {}),
          authority: caller.authority,
          csrf: caller.authority === "browser" ? this.options.auth.csrf : null,
          capabilities: {
            actions:
              original.capabilities.actions &&
              !!a.workbench &&
              compatibleBuild(this.options.build, build),
            manualChecks: false,
            history: original.capabilities.history,
          },
        });
        break;
      }
      case "workspace":
        value = await p.workspace();
        break;
      case "tasks":
      case "runs":
      case "messages":
      case "tools":
      case "contents":
      case "events":
      case "checks":
      case "changes":
      case "reviews":
        value = await p[operation](decodeListRequest(input));
        break;
      case "checkObligations":
        value = await p.checkObligations(decodeId(input));
        break;
      case "entity":
        value = await p.entity(decodeEntityReadRequest(input));
        break;
      case "graph":
        value = await p.graph(decodeGraphReadRequest(input));
        break;
      case "snapshot":
        value = await p.snapshot(decodeScope(input));
        break;
      case "detail":
      case "search": {
        const cursor = decodeCursor(input);
        if (operation === "search" && this.searches >= LIMITS.searchReaders)
          throw new ContractError("capacity");
        if (operation === "search") this.searches++;
        try {
          const valid = await p.validateCursor(cursor);
          this.options.auth.current(caller);
          if (signal.aborted) unavailable();
          if (valid.status === "refused")
            return { kind: "error", error: valid.error };
          value = await p[operation](cursor);
        } finally {
          if (operation === "search") this.searches--;
        }
        break;
      }
      default:
        throw new ContractError("invalid");
    }
    return { kind: "ok", value };
  }
  private async export(
    operation: "export" | "download",
    input: unknown,
    caller: Caller,
    signal: AbortSignal,
    res: ServerResponse,
    activity: () => void,
  ): Promise<void> {
    const p = this.options.adapters.projection;
    if (!p) unavailable();
    if (this.exports >= LIMITS.exportReaders)
      throw new ContractError("capacity");
    this.exports++;
    const request = decodeExportRequest(input),
      tracker = new ExportTracker(request);
    try {
      res.setHeader(
        "Content-Type",
        operation === "download" && request.format === "markdown"
          ? "text/markdown; charset=utf-8"
          : "application/x-ndjson; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cadence-export.${operation === "download" && request.format === "markdown" ? "md" : "ndjson"}"`,
      );
      let trailer: ReturnType<ExportTracker["receive"]> | undefined;
      const digest = createHash("sha256");
      const write = async (frame: ReturnType<ExportTracker["receive"]>) => {
        const data = Buffer.from(
          operation === "download"
            ? encodeExportFrame(frame, request.format)
            : `${canonicalJson(frame)}\n`,
        );
        for (
          let offset = 0;
          offset < data.length;
          offset += LIMITS.detailPageBytes
        ) {
          this.options.auth.current(caller);
          if (signal.aborted || res.destroyed) unavailable();
          const chunk = data.subarray(offset, offset + LIMITS.detailPageBytes);
          await new Promise<void>((resolve, reject) => {
            const stop = () => {
              res.destroy();
              reject(new ContractError("unavailable"));
            };
            signal.addEventListener("abort", stop, { once: true });
            res.write(chunk, (error) => {
              signal.removeEventListener("abort", stop);
              error ? reject(new ContractError("unavailable")) : resolve();
            });
          });
          activity();
        }
      };
      // Retained-artifact integrity remains W3-owned. Independently check the
      // emitted stream digest/shape/count; never manufacture a completion trailer.
      for await (const value of p.export(request, signal)) {
        this.options.auth.current(caller);
        if (signal.aborted) unavailable();
        const frame = tracker.receive(value);
        if (frame.event.kind === "trailer") trailer = frame;
        else {
          digest.update(encodeExportFrame(frame, request.format));
          await write(frame);
          // The write callback can settle just before revocation/disconnect.
          // Recheck before for-await requests another original history chunk.
          this.options.auth.current(caller);
          if (signal.aborted) unavailable();
        }
      }
      this.options.auth.current(caller);
      if (
        signal.aborted ||
        !trailer ||
        trailer.event.kind !== "trailer" ||
        trailer.event.sha256 !== digest.digest("hex")
      )
        unavailable();
      await write(trailer);
      res.end();
    } finally {
      this.exports--;
    }
  }
  private openViewer(socket: WebSocket, attachment: Attachment): void {
    const viewer: Viewer = {
      socket,
      attachment,
      subscription: 0,
      pending: [],
      bytes: 0,
      sentBytes: 0,
      sentMessages: 0,
      reading: false,
      closed: false,
      lastPing: Date.now(),
      lastReconcile: Date.now(),
    };
    attachment.socket = socket;
    this.viewers.add(viewer);
    socket.on("error", () => this.closeViewer(viewer));
    socket.on("close", () => this.closeViewer(viewer));
    socket.on("message", (data, binary) => {
      try {
        this.attachment(attachment.caller);
        if (binary || Array.isArray(data)) throw new ContractError("invalid");
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        if (bytes.byteLength > LIMITS.wsClientFrameBytes)
          throw new ContractError("oversize");
        const command = decodeSocketInput(
          parseWireJson(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            LIMITS.wsClientFrameBytes,
          ),
        );
        viewer.lastPing = Date.now();
        if (command.kind === "ping") this.heartbeatViewer(viewer);
        else if (viewer.reading) this.closeViewer(viewer);
        else void this.subscribe(viewer, command.scope);
      } catch {
        this.closeViewer(viewer);
      }
    });
  }
  private closeViewer(viewer: Viewer): void {
    if (viewer.closed) return;
    viewer.closed = true;
    viewer.subscription++;
    try {
      viewer.unsubscribe?.();
    } catch {
      /* Never fail the producer. */
    }
    viewer.pending = [];
    viewer.bytes = 0;
    this.viewers.delete(viewer);
    viewer.socket.terminate();
    this.detach(viewer.attachment); // Invalidates grants, never calls Cancel.
  }
  private sendViewer(viewer: Viewer, output: SocketOutput): boolean {
    try {
      this.attachment(viewer.attachment.caller);
      const data = canonicalJson(output, LIMITS.viewerBytes),
        bytes = Buffer.byteLength(data);
      if (
        viewer.closed ||
        viewer.sentMessages + viewer.pending.length >= LIMITS.viewerMessages ||
        viewer.sentBytes + viewer.bytes + bytes > LIMITS.viewerBytes ||
        viewer.socket.bufferedAmount > LIMITS.viewerBytes
      )
        throw new ContractError("capacity");
      viewer.sentMessages++;
      viewer.sentBytes += bytes;
      viewer.socket.send(data, (error) => {
        viewer.sentMessages--;
        viewer.sentBytes -= bytes;
        if (error) this.closeViewer(viewer);
      });
      return true;
    } catch {
      this.closeViewer(viewer);
      return false;
    }
  }
  private async subscribe(viewer: Viewer, scope: Scope): Promise<void> {
    const p = this.options.adapters.projection,
      live = this.options.adapters.live;
    if (viewer.closed) return;
    if (!p || !live) {
      this.closeViewer(viewer);
      return;
    }
    // Unsettled ORIGINAL snapshots retain the shared readonly slot even after
    // this viewer detaches; reconnect cannot manufacture unbounded pending reads.
    if (this.reads >= 32) {
      this.closeViewer(viewer);
      return;
    }
    this.reads++;
    const generation = ++viewer.subscription;
    viewer.reading = true;
    viewer.scope = scope;
    viewer.snapshot = undefined;
    viewer.pending = [];
    viewer.bytes = 0;
    try {
      viewer.unsubscribe?.();
      viewer.unsubscribe = live.subscribe(scope, (value) => {
        if (viewer.closed || viewer.subscription !== generation) return;
        try {
          this.attachment(viewer.attachment.caller);
          const event = decodeLiveEvent(value);
          const bytes = Buffer.byteLength(
            canonicalJson(event, LIMITS.pageBytes),
          );
          if (viewer.reading) {
            if (
              viewer.pending.length + viewer.sentMessages >=
                LIMITS.viewerMessages ||
              viewer.bytes + viewer.sentBytes + bytes > LIMITS.viewerBytes
            )
              throw new ContractError("capacity");
            viewer.pending.push(event);
            viewer.bytes += bytes;
          } else this.deliver(viewer, event);
        } catch {
          this.closeViewer(viewer);
        }
      });
      if (viewer.closed) {
        viewer.unsubscribe();
        return;
      }
      const snapshot = decodeSnapshot(await p.snapshot(scope));
      if (viewer.closed || viewer.subscription !== generation) return;
      this.attachment(viewer.attachment.caller);
      if (
        snapshot.epoch !== this.options.auth.epoch ||
        canonicalJson(snapshot.scope) !== canonicalJson(scope)
      )
        throw new ContractError("stale");
      viewer.snapshot = snapshot;
      // Transfer buffered events before sending snapshot, retaining the same bounds.
      if (!this.sendViewer(viewer, { kind: "snapshot", snapshot })) return;
      viewer.reading = false;
      viewer.lastReconcile = Date.now();
      for (const event of viewer.pending.splice(0)) {
        viewer.bytes -= Buffer.byteLength(canonicalJson(event));
        this.deliver(viewer, event);
        // A gap can synchronously start a new snapshot while this queue drains.
        // Do not subtract its bytes or clear its ingress state from this attempt.
        if (viewer.closed || viewer.subscription !== generation) break;
      }
    } catch {
      this.closeViewer(viewer);
    } finally {
      if (viewer.subscription === generation) viewer.reading = false;
      this.reads--;
    }
  }
  private deliver(viewer: Viewer, event: LiveEvent): void {
    const snapshot = viewer.snapshot;
    if (!snapshot || viewer.closed) return;
    if (
      event.epoch !== snapshot.epoch ||
      event.storeId !== snapshot.storeId ||
      canonicalJson(event.scope) !== canonicalJson(snapshot.scope)
    ) {
      this.resync(viewer);
      return;
    }
    const cmp = compareSequence(event.committedSeq, snapshot.committedSeq);
    if (cmp < 0 || (cmp === 0 && event.kind !== "heartbeat")) return;
    if (
      (event.kind === "update" &&
        event.previousSeq !== snapshot.committedSeq) ||
      (event.kind === "heartbeat" && cmp > 0)
    ) {
      this.resync(viewer);
      return;
    }
    if (this.sendViewer(viewer, { kind: "event", event }))
      snapshot.committedSeq = event.committedSeq;
  }
  private resync(viewer: Viewer): void {
    if (!viewer.reading && viewer.scope) {
      this.sendViewer(viewer, { kind: "resync" });
      void this.subscribe(viewer, viewer.scope);
    }
  }
  private heartbeatViewer(viewer: Viewer): void {
    if (!viewer.scope || viewer.reading) return;
    try {
      const event = decodeLiveEvent(
        this.options.adapters.live?.watermark(viewer.scope),
      );
      if (event.kind !== "heartbeat") throw new ContractError("invalid");
      this.deliver(viewer, event);
    } catch {
      this.closeViewer(viewer);
    }
  }
  private tick(): void {
    for (const viewer of this.viewers) {
      if (Date.now() - viewer.lastPing >= LIMITS.staleMs)
        this.closeViewer(viewer);
      else if (Date.now() - viewer.lastReconcile >= LIMITS.reconcileMs)
        this.resync(viewer);
      else this.heartbeatViewer(viewer);
    }
  }
}
