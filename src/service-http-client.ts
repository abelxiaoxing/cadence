import { abortScope } from "./abort-scope.ts";
import type {
  WorkbenchCommand,
  WorkbenchRead,
} from "./service/contracts/workbench.ts";
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
  type Reply,
  type Scope,
  utf8Bytes,
} from "./service-contract.ts";
import {
  decodeHttpInput,
  decodeHttpOutput,
  decodeSocketOutput,
  HISTORY_CSRF_HEADER,
  type HttpOperation,
  httpOutputLimit,
  retainedHistoryBody,
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
  private historyCsrf?: string;
  private bootstrapRevision = 0;
  private readonly fetcher: typeof fetch;
  private readonly origin: string;
  constructor(
    private readonly options: {
      origin: string;
      /** Authenticated same-origin project routing; never an arbitrary URL. */
      project?: string;
      /** Dedicated retained reader: never allocates an attachment or sends work. */
      retainedHistory?: boolean;
      /** Diagnostic metadata only; authentication never depends on a build. */
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
    if (
      options.project !== undefined &&
      !/^[a-f0-9]{64}$/.test(options.project)
    )
      throw new ContractError("invalid");
    if (options.retainedHistory && options.localCapability)
      throw new ContractError("invalid");
    this.origin = options.origin;
    if (options.build) options.build = decodeClientBuild(options.build);
    // Native browser fetch requires its Window receiver. Node/injected arrow
    // fetchers tolerate the wrong `this`, so HTTP-only fixtures miss this bug.
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  workbenchRead(
    request: WorkbenchRead,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.request("workbenchRead", request, signal);
  }
  workbenchCommand(request: WorkbenchCommand): Promise<unknown> {
    return this.request("workbenchCommand", request);
  }
  private headers(write: boolean, session = false): Record<string, string> {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (this.options.build)
      headers["X-Cadence-Build"] = canonicalJson(this.options.build);
    if (this.attachment && (write || session))
      headers["X-Cadence-Attachment"] = this.attachment;
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
    if (
      this.options.retainedHistory &&
      operation !== "workspace" &&
      !retainedHistoryBody(operation)
    )
      throw new ContractError("forbidden");
    const input = decodeHttpInput(operation, value),
      wire = wireRequest(operation, input),
      write = wire.method === "POST";
    // No command replay, preflight renewal, changed command ID or redirect
    // follow after an uncertain HTTP outcome.
    const scope =
      this.options.requestTimeoutMs === undefined
        ? undefined
        : abortScope([signal], this.options.requestTimeoutMs);
    const requestSignal = scope?.signal ?? signal;
    try {
      if (requestSignal?.aborted) throw requestSignal.reason;
      // One client-chosen observation ID survives a lost header/body. Repeating
      // session reuses that slot and recovers CSRF, never a command or grant.
      if (operation === "session") this.attachment ??= crypto.randomUUID();
      const bootstrap =
        this.options.retainedHistory && operation === "workspace"
          ? ++this.bootstrapRevision
          : undefined;
      if (bootstrap !== undefined) this.historyCsrf = undefined;
      const historyBody = this.options.retainedHistory && write;
      const headers = this.headers(
        write && !historyBody,
        operation === "session",
      );
      if (historyBody) {
        if (!this.historyCsrf) throw new ContractError("stale");
        headers[HISTORY_CSRF_HEADER] = this.historyCsrf;
        headers["Content-Type"] = "application/json";
      }
      const response = await this.fetcher(
        `${this.origin}${this.options.project ? `/projects/${this.options.project}` : ""}${wire.path}`,
        {
          method: wire.method,
          headers,
          credentials: "same-origin",
          redirect: "error",
          signal: requestSignal,
          ...(write ? { body: wire.body } : {}),
        },
      );
      // Validate the reply's allocation without losing our original ID when
      // its header or body is missing. A later session read can recover it.
      let sessionAttachment: string | undefined;
      try {
        if (operation === "session" && response.ok) {
          sessionAttachment = decodeId(
            response.headers.get("x-cadence-attachment"),
          );
          if (sessionAttachment !== this.attachment)
            throw new ContractError("invalid");
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
      if (
        bootstrap !== undefined &&
        response.ok &&
        Object.getOwnPropertyDescriptor(result ?? {}, "kind")?.value === "ok"
      ) {
        if (requestSignal?.aborted || this.bootstrapRevision !== bootstrap)
          throw new ContractError("stale");
        this.historyCsrf = decodeId(response.headers.get(HISTORY_CSRF_HEADER));
      }
      if (operation === "session") {
        const reply = decodeReply(result, decodeSessionBootstrap);
        if (reply.kind === "ok") {
          if (
            (reply.value.authority === "local") !==
            !!this.options.localCapability
          )
            throw new ContractError("forbidden");
          // The body can finish after this viewer was retired (even after the
          // header matched). Never reinstall the old allocation or its CSRF.
          if (
            requestSignal?.aborted ||
            sessionAttachment !== this.attachment ||
            !sessionAttachment
          )
            throw new ContractError("stale");
          this.csrf = reply.value.csrf;
        }
      }
      return result;
    } finally {
      scope?.dispose();
    }
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
  async detach(): Promise<Reply<null> | undefined> {
    const attachment = this.attachment;
    if (!attachment) return;
    // A lost session body may leave this allocation without its CSRF. A
    // restarted owner may also refuse the old CSRF on detach. In either case
    // read the SAME ID at most once. No command or grant is renewed.
    let checked = false;
    for (;;) {
      if (!this.options.localCapability && !this.csrf) {
        checked = true;
        const session = decodeReply(
          await this.session(),
          decodeSessionBootstrap,
        );
        if (session.kind === "error") {
          if (session.error.code === "forbidden") return session;
          if (!["stale", "unauthenticated"].includes(session.error.code))
            throw new ContractError(session.error.code);
          if (this.attachment === attachment) this.attachment = undefined;
          return session;
        }
      }
      if (this.attachment !== attachment) throw new ContractError("stale");
      const result = decodeReply(
        await this.request("detach", null),
        (value) => {
          if (value !== null) throw new ContractError("invalid");
          return null;
        },
      );
      // Only acknowledgement, stale (no longer owned) or rotation proves the
      // slot released. An uncertain reply retains the exact ID for later.
      if (
        result.kind === "error" &&
        result.error.code !== "stale" &&
        result.error.code !== "unauthenticated"
      ) {
        if (
          result.error.code === "forbidden" &&
          !this.options.localCapability &&
          this.attachment === attachment
        ) {
          this.csrf = null;
          if (!checked) continue;
          // Still forbidden with the freshly observed challenge: stop, without
          // claiming release or allocating a new viewer.
          return result;
        }
        throw new ContractError(result.error.code);
      }
      if (this.attachment === attachment) {
        this.attachment = undefined;
        this.csrf = null;
      }
      return result;
    }
  }
  async *export(
    input: ExportRequest,
    signal: AbortSignal,
  ): AsyncGenerator<unknown> {
    if (this.options.retainedHistory) throw new ContractError("forbidden");
    const request = decodeExportRequest(input),
      wire = wireRequest("export", request);
    const response = await this.fetcher(
      `${this.origin}${this.options.project ? `/projects/${this.options.project}` : ""}${wire.path}`,
      {
        method: wire.method,
        headers: this.headers(wire.method === "POST"),
        ...(wire.body === undefined ? {} : { body: wire.body }),
        credentials: "same-origin",
        redirect: "error",
        signal,
      },
    );
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
    status: (state: "stale" | "closed") => void,
  ): () => void {
    const scope = decodeScope(scopeInput);
    if (!this.attachment || !this.options.socket)
      throw new ContractError("unavailable");
    const socket = this.options.socket(
      `${this.origin.replace(/^http/, "ws")}${this.options.project ? `/projects/${this.options.project}` : ""}${WS_PATH}?attachment=${this.attachment}`,
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
    const notify = (value: "stale" | "closed") => {
      try {
        status(value);
      } catch {
        /* View callback is not execution authority. */
      }
    };
    const timer = setInterval(() => {
      const silent = Date.now() - last;
      if (silent >= LIMITS.staleMs) {
        notify("stale");
        // A hanging handshake can't ping. An open but silent connection gets
        // one reconcile period to answer; don't wait indefinitely for close.
        if (!active || silent > LIMITS.reconcileMs) return stop();
      }
      if (!active || closed) return;
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
      last = reconciled = Date.now();
      try {
        socket.send(canonicalJson({ kind: "subscribe", scope }));
      } catch {
        stop();
      }
    });
    socket.addEventListener("message", (event) => {
      if (closed || !active) return;
      try {
        if (typeof event.data !== "string") throw new ContractError("invalid");
        const value = decodeSocketOutput(
          parseWireJson(event.data, LIMITS.viewerBytes),
        );
        last = Date.now();
        // Only the observer knows whether the frame advances the selected
        // attachment/epoch/projection. A resync request isn't current data.
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
export async function boundedText(
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
