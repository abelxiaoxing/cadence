import type { ServiceTransport } from "./service-client.ts";
import {
  type CancelCommand,
  type ChooseModelRequest,
  type ClientBuild,
  type Command,
  ContractError,
  canonicalJson,
  decodeCancel,
  decodeChooseModelRequest,
  decodeClientBuild,
  decodeCommand,
  decodeEntityReadRequest,
  decodeExportFrame,
  decodeExportRequest,
  decodeGraphReadRequest,
  decodeId,
  decodeListRequest,
  decodePreflightRequest,
  decodeReply,
  decodeScope,
  decodeSessionBootstrap,
  type EntityReadRequest,
  type ExportRequest,
  type GraphReadRequest,
  LIMITS,
  type ListRequest,
  type PreflightRequest,
  parseWireJson,
  type ReadCursor,
  type Scope,
  utf8Bytes,
} from "./service-contract.ts";
import {
  decodeHttpInput,
  decodeHttpOutput,
  decodeSocketOutput,
  type HttpOperation,
  httpOutputLimit,
  type SocketOutput,
  WS_PATH,
  wireRequest,
} from "./service-wire.ts";

/** Browser WebSocket or a native client's equivalent. No auth/query overlay API. */
export interface ReadSocket {
  addEventListener(
    type: "open" | "close" | "error",
    listener: () => void,
  ): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  send(data: string): void;
  close(): void;
}
export class HttpServiceTransport implements ServiceTransport {
  private attachment: string | undefined;
  private csrf: string | null = null;
  private readonly fetcher: typeof fetch;
  private readonly origin: string;
  constructor(
    private readonly options: {
      origin: string;
      build?: ClientBuild;
      fetch?: typeof fetch;
      /** Optional total bound for finite replies only, never streaming export. */
      requestTimeoutMs?: number;
      localCapability?: string;
      socket?: (url: string) => ReadSocket;
    },
  ) {
    const url = new URL(options.origin);
    if (
      url.origin !== options.origin ||
      (url.protocol !== "https:" &&
        !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]*$/.test(options.origin))
    )
      throw new ContractError("invalid");
    this.origin = options.origin;
    if (options.build) options.build = decodeClientBuild(options.build);
    // Native browser fetch requires its Window receiver. Node/injected arrow
    // fetchers tolerate the wrong `this`, so HTTP-only fixtures miss this bug.
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  private headers(write: boolean): Record<string, string> {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (this.options.build)
      headers["X-Cadence-Build"] = canonicalJson(this.options.build);
    if (this.attachment) headers["X-Cadence-Attachment"] = this.attachment;
    if (this.options.localCapability)
      headers["X-Cadence-Local"] = this.options.localCapability;
    if (write) {
      if (!this.attachment || (!this.options.localCapability && !this.csrf))
        throw new ContractError("stale");
      headers["Content-Type"] = "application/json";
      if (this.csrf) headers["X-Cadence-CSRF"] = this.csrf;
    }
    return headers;
  }
  private async request(
    operation: HttpOperation,
    value: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const input = decodeHttpInput(operation, value),
      wire = wireRequest(operation, input),
      write = wire.method === "POST";
    // No automatic session/preflight refresh, changed command ID, mutation retry,
    // credential query or redirect follow after an uncertain HTTP outcome.
    const response = await this.fetcher(`${this.origin}${wire.path}`, {
      method: wire.method,
      headers: this.headers(write),
      credentials: "same-origin",
      redirect: "error",
      signal:
        this.options.requestTimeoutMs === undefined
          ? signal
          : AbortSignal.any([
              ...(signal ? [signal] : []),
              AbortSignal.timeout(this.options.requestTimeoutMs),
            ]),
      ...(write ? { body: wire.body } : {}),
    });
    // Keep a known allocation even if its original response body is lost or
    // malformed. Without a validated CSRF challenge detach may remain blocked;
    // never silently forget that slot and acquire 16 replacement sessions.
    let sessionAttachment: string | undefined;
    try {
      if (operation === "session" && response.ok) {
        sessionAttachment = decodeId(
          response.headers.get("x-cadence-attachment"),
        );
        this.attachment = sessionAttachment;
      }
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    const source = await boundedText(response, httpOutputLimit(operation)),
      parsed = parseWireJson(source);
    // Graph's category is known only after parsing. Count ORIGINAL wire bytes,
    // not a canonical re-encoding which discards padding or alternate escapes.
    if (utf8Bytes(source) > httpOutputLimit(operation, parsed))
      throw new ContractError("oversize");
    const result = decodeHttpOutput(operation, parsed);
    if (operation === "session") {
      const reply = decodeReply(result, decodeSessionBootstrap);
      if (reply.kind === "ok") {
        if (
          (reply.value.authority === "local") !==
          !!this.options.localCapability
        )
          throw new ContractError("forbidden");
        this.attachment =
          sessionAttachment ??
          decodeId(response.headers.get("x-cadence-attachment"));
        this.csrf = reply.value.csrf;
      }
    }
    return result;
  }
  session(signal?: AbortSignal) {
    return this.request("session", null, signal);
  }
  current(
    request: import("./service-contract.ts").CurrentRequest,
    signal?: AbortSignal,
  ) {
    return this.request("current", request, signal);
  }
  currentChanges(
    request: import("./service-contract.ts").CurrentRequest,
    signal?: AbortSignal,
  ) {
    return this.request("currentChanges", request, signal);
  }
  activeRuns(signal?: AbortSignal) {
    return this.request("activeRuns", null, signal);
  }
  models(signal?: AbortSignal) {
    return this.request("models", null, signal);
  }
  chooseModel(input: ChooseModelRequest) {
    return this.request("chooseModel", decodeChooseModelRequest(input));
  }
  workspace(signal?: AbortSignal) {
    return this.request("workspace", null, signal);
  }
  checkObligations(id: string, signal?: AbortSignal) {
    return this.request("checkObligations", decodeId(id), signal);
  }
  entity(input: EntityReadRequest, signal?: AbortSignal) {
    return this.request("entity", decodeEntityReadRequest(input), signal);
  }
  tasks(input: ListRequest, signal?: AbortSignal) {
    return this.request("tasks", decodeListRequest(input), signal);
  }
  runs(input: ListRequest, signal?: AbortSignal) {
    return this.request("runs", decodeListRequest(input), signal);
  }
  messages(input: ListRequest, signal?: AbortSignal) {
    return this.request("messages", decodeListRequest(input), signal);
  }
  tools(input: ListRequest, signal?: AbortSignal) {
    return this.request("tools", decodeListRequest(input), signal);
  }
  contents(input: ListRequest, signal?: AbortSignal) {
    return this.request("contents", decodeListRequest(input), signal);
  }
  events(input: ListRequest, signal?: AbortSignal) {
    return this.request("events", decodeListRequest(input), signal);
  }
  checks(input: ListRequest, signal?: AbortSignal) {
    return this.request("checks", decodeListRequest(input), signal);
  }
  changes(input: ListRequest, signal?: AbortSignal) {
    return this.request("changes", decodeListRequest(input), signal);
  }
  reviews(input: ListRequest, signal?: AbortSignal) {
    return this.request("reviews", decodeListRequest(input), signal);
  }
  graph(input: GraphReadRequest, signal?: AbortSignal) {
    return this.request("graph", decodeGraphReadRequest(input), signal);
  }
  preflight(input: PreflightRequest) {
    return this.request("preflight", decodePreflightRequest(input));
  }
  command(input: Command) {
    return this.request("command", decodeCommand(input));
  }
  cancel(input: CancelCommand) {
    return this.request("cancel", decodeCancel(input));
  }
  receipt(id: string, signal?: AbortSignal) {
    return this.request("receipt", decodeId(id), signal);
  }
  snapshot(input: Scope, signal?: AbortSignal) {
    return this.request("snapshot", input, signal);
  }
  detail(input: ReadCursor, signal?: AbortSignal) {
    return this.request("detail", input, signal);
  }
  search(input: ReadCursor, signal?: AbortSignal) {
    return this.request("search", input, signal);
  }
  async detach(): Promise<unknown> {
    const attachment = this.attachment;
    if (!attachment) return;
    const result = decodeReply(await this.request("detach", null), (value) => {
      if (value !== null) throw new ContractError("invalid");
      return null;
    });
    // A lost reply does not prove release. Retain the exact attachment for a
    // later explicit detach rather than allocating another of the 16 slots.
    // Stale means the server no longer owns this ID; rotation also revokes it.
    if (
      result.kind === "error" &&
      result.error.code !== "stale" &&
      result.error.code !== "unauthenticated"
    )
      throw new ContractError(result.error.code);
    if (this.attachment === attachment) {
      this.attachment = undefined;
      this.csrf = null;
    }
    return result;
  }
  async *export(
    input: ExportRequest,
    signal: AbortSignal,
  ): AsyncGenerator<unknown> {
    const request = decodeExportRequest(input),
      wire = wireRequest("export", request);
    const response = await this.fetcher(`${this.origin}${wire.path}`, {
      method: wire.method,
      headers: this.headers(wire.method === "POST"),
      ...(wire.body === undefined ? {} : { body: wire.body }),
      credentials: "same-origin",
      redirect: "error",
      signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ContractError("unavailable");
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (signal.aborted) throw new ContractError("unavailable");
        // Fetch may coalesce many frames into one source chunk. Do not decode or
        // retain a whole export-sized string before applying the per-line bound.
        for (
          let offset = 0;
          offset < (done ? 1 : value.byteLength);
          offset += LIMITS.chunkBytes
        ) {
          pending += done
            ? decoder.decode()
            : decoder.decode(
                value.subarray(offset, offset + LIMITS.chunkBytes),
                { stream: true },
              );
          let at = pending.indexOf("\n");
          while (at !== -1) {
            const line = pending.slice(0, at);
            pending = pending.slice(at + 1);
            yield decodeExportFrame(parseWireJson(line, LIMITS.controlBytes));
            at = pending.indexOf("\n");
          }
          if (new TextEncoder().encode(pending).length > LIMITS.controlBytes)
            throw new ContractError("oversize");
        }
        if (done) {
          if (pending) throw new ContractError("invalid");
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  /** Explicit read-only connection. No reconnect, control commands or mutation replay.
   * Native factories add ONLY their local-capability header to the socket handshake. */
  subscribe(
    scopeInput: Scope,
    receive: (value: SocketOutput) => void,
    status: (state: "current" | "stale" | "closed") => void,
  ): () => void {
    const scope = decodeScope(scopeInput);
    if (!this.attachment || !this.options.socket)
      throw new ContractError("unavailable");
    const socket = this.options.socket(
      `${this.origin.replace(/^http/, "ws")}${WS_PATH}?attachment=${this.attachment}`,
    );
    let active = false,
      closed = false,
      last = Date.now(),
      reconciled = Date.now();
    const stop = () => {
      if (closed) return;
      closed = true;
      active = false;
      clearInterval(timer);
      try {
        socket.close();
      } catch {
        /* Read transport is already closed locally. */
      }
      notify("closed");
    };
    const notify = (value: "current" | "stale" | "closed") => {
      try {
        status(value);
      } catch {
        /* View callback is not execution authority. */
      }
    };
    const timer = setInterval(() => {
      if (!active) return;
      if (Date.now() - last >= LIMITS.staleMs) notify("stale");
      try {
        if (Date.now() - reconciled >= LIMITS.reconcileMs) {
          socket.send(canonicalJson({ kind: "resync", scope }));
          reconciled = Date.now();
        } else socket.send('{"kind":"ping"}');
      } catch {
        stop();
      }
    }, LIMITS.heartbeatMs);
    socket.addEventListener("open", () => {
      if (closed) return;
      active = true;
      try {
        socket.send(canonicalJson({ kind: "subscribe", scope }));
      } catch {
        stop();
      }
    });
    socket.addEventListener("message", (event) => {
      if (closed) return;
      try {
        if (typeof event.data !== "string") throw new ContractError("invalid");
        const value = decodeSocketOutput(
          parseWireJson(event.data, LIMITS.viewerBytes),
        );
        last = Date.now();
        notify("current");
        receive(value);
      } catch {
        stop();
      }
    });
    socket.addEventListener("error", stop);
    socket.addEventListener("close", stop);
    return stop;
  }
}
async function boundedText(
  response: Response,
  maximum: number,
): Promise<string> {
  if (!response.body) throw new ContractError("invalid");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0,
    result = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return result + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maximum) throw new ContractError("oversize");
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
