import {
  type Action,
  type ActiveRuns,
  type CancelCommand,
  type CheckObligations,
  type ChooseModelRequest,
  type Command,
  type ContextVersion,
  ContractError,
  type CurrentChanges,
  type CurrentRequest,
  type CurrentView,
  canonicalJson,
  compareSequence,
  controlTask,
  controlWorkspace,
  type DetailReadResult,
  decodeActiveRuns,
  decodeCancel,
  decodeCheckObligations,
  decodeChooseModelRequest,
  decodeCommand,
  decodeCurrentChanges,
  decodeCurrentChangesRequest,
  decodeCurrentRequest,
  decodeCurrentView,
  decodeCursor,
  decodeDetailReadResult,
  decodeEntityReadRequest,
  decodeEntityReadResult,
  decodeExportRequest,
  decodeGraphReadRequest,
  decodeGraphReadResult,
  decodeHistoryReadResult,
  decodeId,
  decodeListRequest,
  decodeLiveEvent,
  decodeModelCatalog,
  decodeModelChoiceState,
  decodePreflight,
  decodePreflightRequest,
  decodeReceipt,
  decodeReceiptLookup,
  decodeReply,
  decodeScope,
  decodeSearchPage,
  decodeSessionBootstrap,
  decodeSnapshot,
  decodeStoredCommand,
  decodeWorkspaceBootstrap,
  type EntityReadRequest,
  type EntityReadResult,
  type ExportFrame,
  type ExportRequest,
  ExportTracker,
  type GraphReadRequest,
  type GraphReadResult,
  type HistoryReadResult,
  historyReplyMatches,
  LIMITS,
  type ListRequest,
  type LiveEvent,
  type ModelCatalog,
  type ModelChoiceState,
  type Preflight,
  type PreflightRequest,
  publicError,
  type ReadCursor,
  type ReaderKind,
  type Receipt,
  type ReceiptLookup,
  type Reply,
  type Scope,
  type SearchPage,
  type SessionBootstrap,
  type Snapshot,
  type WorkspaceBootstrap,
} from "./service-contract.ts";

/** Transport supplies authentication separately. No URL, auth value, generic send,
 * SDK instance or execution ownership is exposed by the client API.
 * Text transports use parseWireJson BEFORE handing unknown values to this client.
 */
export interface ServiceTransport {
  current?(request: CurrentRequest, signal?: AbortSignal): Promise<unknown>;
  currentChanges?(
    request: CurrentRequest,
    signal?: AbortSignal,
  ): Promise<unknown>;
  activeRuns?(signal?: AbortSignal): Promise<unknown>;
  models?(signal?: AbortSignal): Promise<unknown>;
  chooseModel?(request: ChooseModelRequest): Promise<unknown>;
  checkObligations(taskId: string, signal?: AbortSignal): Promise<unknown>;
  entity(request: EntityReadRequest, signal?: AbortSignal): Promise<unknown>;
  session(signal?: AbortSignal): Promise<unknown>;
  workspace(signal?: AbortSignal): Promise<unknown>;
  tasks(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  runs(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  messages(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  tools(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  contents(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  events(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  checks(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  changes(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  reviews(request: ListRequest, signal?: AbortSignal): Promise<unknown>;
  graph(request: GraphReadRequest, signal?: AbortSignal): Promise<unknown>;
  export(request: ExportRequest, signal: AbortSignal): AsyncIterable<unknown>;
  preflight(request: PreflightRequest): Promise<unknown>;
  command(command: Command): Promise<unknown>;
  cancel(command: CancelCommand): Promise<unknown>;
  receipt(commandId: string, signal?: AbortSignal): Promise<unknown>;
  snapshot(scope: Scope, signal?: AbortSignal): Promise<unknown>;
  detail(cursor: ReadCursor, signal?: AbortSignal): Promise<unknown>;
  search(cursor: ReadCursor, signal?: AbortSignal): Promise<unknown>;
}
type NamedCommand<K extends Action["kind"]> = Omit<Command, "action"> & {
  action: Extract<Action, { kind: K }>;
};
const unavailable = <T>(mutation: boolean): Reply<T> => ({
  kind: "error",
  error: publicError("unavailable", mutation ? "uncertain" : "none"),
});

export class ServiceClient {
  constructor(private readonly transport: ServiceTransport) {}
  async current(
    input: CurrentRequest,
    signal?: AbortSignal,
  ): Promise<Reply<CurrentView>> {
    const request = decodeCurrentRequest(input);
    try {
      if (!this.transport.current) return unavailable(false);
      const reply = decodeReply(
        await this.transport.current(request, signal),
        decodeCurrentView,
      );
      return reply.kind === "ok" &&
        canonicalJson(reply.value.request) !== canonicalJson(request)
        ? unavailable(false)
        : reply;
    } catch {
      return unavailable(false);
    }
  }
  async currentChanges(
    input: CurrentRequest,
    signal?: AbortSignal,
  ): Promise<Reply<CurrentChanges>> {
    const request = decodeCurrentChangesRequest(input);
    try {
      if (!this.transport.currentChanges) return unavailable(false);
      const reply = decodeReply(
        await this.transport.currentChanges(request, signal),
        decodeCurrentChanges,
      );
      return reply.kind === "ok" &&
        canonicalJson(reply.value.request) !== canonicalJson(request)
        ? unavailable(false)
        : reply;
    } catch {
      return unavailable(false);
    }
  }
  async activeRuns(signal?: AbortSignal): Promise<Reply<ActiveRuns>> {
    try {
      if (!this.transport.activeRuns) return unavailable(false);
      return decodeReply(
        await this.transport.activeRuns(signal),
        decodeActiveRuns,
      );
    } catch {
      return unavailable(false);
    }
  }
  async models(signal?: AbortSignal): Promise<Reply<ModelCatalog>> {
    try {
      if (!this.transport.models) return unavailable(false);
      return decodeReply(
        await this.transport.models(signal),
        decodeModelCatalog,
      );
    } catch {
      return unavailable(false);
    }
  }
  async chooseModel(
    input: ChooseModelRequest,
  ): Promise<Reply<ModelChoiceState>> {
    const request = decodeChooseModelRequest(input);
    try {
      if (!this.transport.chooseModel) return unavailable(false);
      const reply = decodeReply(
        await this.transport.chooseModel(request),
        decodeModelChoiceState,
      );
      if (reply.kind === "ok") {
        const { sourceSelectionId: _id, ...selector } =
          reply.value.selected ?? {};
        if (
          canonicalJson(selector) !== canonicalJson(request.choice) ||
          reply.value.version.epoch !== request.expected.epoch ||
          reply.value.version.accessGeneration !==
            request.expected.accessGeneration ||
          ![
            request.expected.configRev,
            request.expected.configRev + 1,
          ].includes(reply.value.version.configRev) ||
          (reply.value.version.configRev === request.expected.configRev) !==
            (reply.value.version.catalogId === request.expected.catalogId)
        )
          return unavailable(true);
      }
      return reply;
    } catch {
      return unavailable(true);
    }
  }
  async checkObligations(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<Reply<CheckObligations>> {
    decodeId(taskId);
    try {
      const reply = decodeReply(
        await this.transport.checkObligations(taskId, signal),
        decodeCheckObligations,
      );
      return reply.kind === "ok" && reply.value.taskId !== taskId
        ? unavailable(false)
        : reply;
    } catch {
      return unavailable(false);
    }
  }
  task(
    input: Omit<EntityReadRequest, "kind">,
    signal?: AbortSignal,
  ): Promise<Reply<EntityReadResult>> {
    return this.entity("task", input, signal);
  }
  message(
    input: Omit<EntityReadRequest, "kind">,
    signal?: AbortSignal,
  ): Promise<Reply<EntityReadResult>> {
    return this.entity("message", input, signal);
  }
  tool(
    input: Omit<EntityReadRequest, "kind">,
    signal?: AbortSignal,
  ): Promise<Reply<EntityReadResult>> {
    return this.entity("tool", input, signal);
  }
  private async entity(
    kind: EntityReadRequest["kind"],
    input: Omit<EntityReadRequest, "kind">,
    signal?: AbortSignal,
  ): Promise<Reply<EntityReadResult>> {
    const request = decodeEntityReadRequest({ ...input, kind });
    try {
      const reply = decodeReply(
        await this.transport.entity(request, signal),
        decodeEntityReadResult,
      );
      return reply.kind === "ok" &&
        canonicalJson(reply.value.request) !== canonicalJson(request)
        ? unavailable(false)
        : reply;
    } catch {
      return unavailable(false);
    }
  }
  async session(signal?: AbortSignal): Promise<Reply<SessionBootstrap>> {
    try {
      return decodeReply(
        await this.transport.session(signal),
        decodeSessionBootstrap,
      );
    } catch {
      return unavailable(false);
    }
  }
  async workspace(signal?: AbortSignal): Promise<Reply<WorkspaceBootstrap>> {
    try {
      return decodeReply(
        await this.transport.workspace(signal),
        decodeWorkspaceBootstrap,
      );
    } catch {
      return unavailable(false);
    }
  }
  tasks(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("tasks", request, signal);
  }
  runs(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("runs", request, signal);
  }
  messages(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("messages", request, signal);
  }
  tools(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("tools", request, signal);
  }
  contents(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("contents", request, signal);
  }
  events(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("events", request, signal);
  }
  checks(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("checks", request, signal);
  }
  changes(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("changes", request, signal);
  }
  reviews(
    request: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    return this.page("reviews", request, signal);
  }
  private async page(
    reader: ReaderKind,
    input: Omit<ListRequest, "reader">,
    signal?: AbortSignal,
  ): Promise<Reply<HistoryReadResult>> {
    const request = decodeListRequest({ ...input, reader });
    try {
      const reply = decodeReply(
        await this.transport[reader](request, signal),
        decodeHistoryReadResult,
      );
      if (reply.kind === "ok" && !historyReplyMatches(request, reply.value))
        return unavailable(false);
      return reply;
    } catch {
      return unavailable(false);
    }
  }
  async graph(
    input: GraphReadRequest,
    signal?: AbortSignal,
  ): Promise<Reply<GraphReadResult>> {
    const request = decodeGraphReadRequest(input);
    try {
      const reply = decodeReply(
        await this.transport.graph(request, signal),
        decodeGraphReadResult,
      );
      return reply.kind === "ok" &&
        canonicalJson(reply.value.request) !== canonicalJson(request)
        ? unavailable(false)
        : reply;
    } catch {
      return unavailable(false);
    }
  }
  async *export(
    input: ExportRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ExportFrame> {
    const request = decodeExportRequest(input),
      tracker = new ExportTracker(request);
    let trailer: ExportFrame | undefined;
    try {
      if (signal.aborted) throw new ContractError("unavailable");
      for await (const value of this.transport.export(request, signal)) {
        if (signal.aborted) throw new ContractError("unavailable");
        const frame = tracker.receive(value);
        if (frame.event.kind === "trailer") trailer = frame;
        else yield frame;
      }
      if (signal.aborted || !trailer) throw new ContractError("unavailable");
      yield trailer; // only after original EOF, never synthesize a trailer
    } catch {
      throw new ContractError("unavailable");
    }
  }
  async preflight(
    expected: ContextVersion,
    action: Action,
  ): Promise<Reply<Preflight>> {
    const request = decodePreflightRequest({ expected, action });
    try {
      const reply = decodeReply(
        await this.transport.preflight(request),
        decodePreflight,
      );
      if (
        reply.kind === "ok" &&
        (canonicalJson(reply.value.preview.version) !==
          canonicalJson(request.expected) ||
          canonicalJson(reply.value.preview.action) !==
            canonicalJson(request.action))
      )
        return unavailable(false);
      return reply;
    } catch {
      return unavailable(false);
    }
  }
  // Explicitly named methods. IDs and confirmations come from the caller; uncertainty
  // NEVER mints a new ID, retries a command, refreshes auth or repeats preflight.
  create(command: NamedCommand<"create">): Promise<Reply<Receipt>> {
    return this.execute("create", command);
  }
  savePlan(command: NamedCommand<"save-plan">): Promise<Reply<Receipt>> {
    return this.execute("save-plan", command);
  }
  generatePlan(
    command: NamedCommand<"generate-plan">,
  ): Promise<Reply<Receipt>> {
    return this.execute("generate-plan", command);
  }
  start(command: NamedCommand<"start">): Promise<Reply<Receipt>> {
    return this.execute("start", command);
  }
  check(command: NamedCommand<"check">): Promise<Reply<Receipt>> {
    return this.execute("check", command);
  }
  review(command: NamedCommand<"review">): Promise<Reply<Receipt>> {
    return this.execute("review", command);
  }
  private async execute(
    kind: Action["kind"],
    input: Command,
  ): Promise<Reply<Receipt>> {
    const command = decodeCommand(input);
    if (command.action.kind !== kind)
      return { kind: "error", error: publicError("invalid") };
    try {
      const reply = decodeReply(
        await this.transport.command(command),
        decodeReceipt,
      );
      if (reply.kind === "ok") {
        if (reply.value.commandId !== command.commandId)
          return unavailable(true);
        // Reuse the admission/history correlation rules: matching commandId alone
        // does not make a missing created task or wrong operation settlement valid.
        decodeStoredCommand({
          identity: {
            kind: "action",
            expected: command.expected,
            action: command.action,
          },
          receipt: reply.value,
        });
      }
      return reply;
    } catch {
      return unavailable(true);
    }
  }
  async cancel(input: CancelCommand): Promise<Reply<Receipt>> {
    const command = decodeCancel(input);
    try {
      const reply = decodeReply(
        await this.transport.cancel(command),
        decodeReceipt,
      );
      if (reply.kind === "ok") {
        if (reply.value.commandId !== command.commandId)
          return unavailable(true);
        decodeStoredCommand({
          identity: {
            kind: "cancel",
            epoch: command.epoch,
            runId: command.runId,
          },
          receipt: reply.value,
        });
      }
      return reply;
    } catch {
      return unavailable(true);
    }
  }
  async receipt(
    commandId: string,
    signal?: AbortSignal,
  ): Promise<ReceiptLookup> {
    decodeId(commandId);
    try {
      const result = decodeReceiptLookup(
        await this.transport.receipt(commandId, signal),
      );
      if (result.status === "found" && result.receipt.commandId !== commandId)
        throw new Error("invalid");
      return result;
    } catch {
      return {
        status: "inconclusive",
        error: publicError("receipt-inconclusive", "uncertain"),
      };
    }
  }
  async snapshot(input: Scope, signal?: AbortSignal): Promise<Reply<Snapshot>> {
    const scope = decodeScope(input);
    try {
      const reply = decodeReply(
        await this.transport.snapshot(scope, signal),
        decodeSnapshot,
      );
      if (
        reply.kind === "ok" &&
        canonicalJson(reply.value.scope) !== canonicalJson(scope)
      )
        return unavailable(false);
      return reply;
    } catch {
      return unavailable(false);
    }
  }
  async detail(
    input: ReadCursor,
    signal?: AbortSignal,
  ): Promise<Reply<DetailReadResult>> {
    const cursor = decodeCursor(input);
    try {
      const reply = decodeReply(
        await this.transport.detail(cursor, signal),
        decodeDetailReadResult,
      );
      if (
        reply.kind === "ok" &&
        canonicalJson(reply.value.cursor) !== canonicalJson(cursor)
      )
        return unavailable(false);
      return reply;
    } catch {
      return unavailable(false);
    }
  }
  async search(
    input: ReadCursor,
    signal?: AbortSignal,
  ): Promise<Reply<SearchPage>> {
    const cursor = decodeCursor(input);
    try {
      const reply = decodeReply(
        await this.transport.search(cursor, signal),
        decodeSearchPage,
      );
      if (
        reply.kind === "ok" &&
        canonicalJson(reply.value.cursor) !== canonicalJson(cursor)
      )
        return unavailable(false);
      return reply;
    } catch {
      return unavailable(false);
    }
  }
}

export interface ObservationState {
  snapshot: Snapshot;
  connection: "current" | "stale" | "resync";
  lastObservedMs: number;
}
/** Read-only correlation/revision reducer; never a scheduler. A new snapshot begins
 * a new subscription generation; old socket callbacks cannot mutate the new view.
 * Polling adapters call needsPoll every 30s even after the socket's last update.
 */
export class ProjectionTracker {
  private generation = 0;
  private snapshotRequest = 0;
  private observation: ObservationState | undefined;
  private lastSnapshotMs = 0;
  /** Capture before the read await; pass the ticket to install. */
  beginSnapshot(): number {
    return ++this.snapshotRequest;
  }
  install(input: unknown, now: number, request: number): number | undefined {
    if (request !== this.snapshotRequest) return undefined;
    const snapshot = decodeSnapshot(input);
    const previous = this.observation?.snapshot;
    if (
      previous &&
      previous.storeId === snapshot.storeId &&
      canonicalJson(previous.scope) === canonicalJson(snapshot.scope) &&
      compareSequence(snapshot.committedSeq, previous.committedSeq) < 0
    ) {
      this.resync();
      return undefined;
    }
    this.observation = {
      snapshot,
      connection: "current",
      lastObservedMs: now,
    };
    this.lastSnapshotMs = now;
    return ++this.generation;
  }
  private resync(): "resync" {
    if (this.observation) this.observation.connection = "resync";
    // A response started before the gap/epoch fault cannot repair that fault,
    // even if it happens to carry the same committed watermark.
    this.snapshotRequest++;
    return "resync";
  }
  get state(): ObservationState | undefined {
    return this.observation && structuredClone(this.observation);
  }
  needsPoll(now: number): boolean {
    return (
      !this.observation ||
      this.observation.connection === "resync" ||
      now < this.lastSnapshotMs ||
      now - this.lastSnapshotMs >= LIMITS.reconcileMs
    );
  }
  tick(now: number): void {
    const state = this.observation;
    if (
      state &&
      state.connection !== "resync" &&
      (now < state.lastObservedMs ||
        now - state.lastObservedMs >= LIMITS.staleMs)
    )
      state.connection = "stale";
  }
  receive(
    input: unknown,
    generation: number,
    now: number,
  ): "applied" | "duplicate" | "ignored" | "resync" {
    const state = this.observation;
    if (!state || generation !== this.generation) return "ignored";
    if (state.connection === "resync") return "resync";
    let event: LiveEvent;
    try {
      event = decodeLiveEvent(input);
    } catch {
      return this.resync();
    }
    const snapshot = state.snapshot;
    if (
      event.storeId !== snapshot.storeId ||
      event.epoch !== snapshot.epoch ||
      canonicalJson(event.scope) !== canonicalJson(snapshot.scope)
    ) {
      return this.resync();
    }
    const comparison = compareSequence(
      event.committedSeq,
      snapshot.committedSeq,
    );
    if (comparison < 0) return "duplicate";
    if (event.kind === "heartbeat") {
      if (comparison > 0) {
        return this.resync();
      }
      state.lastObservedMs = now;
      state.connection = "current";
      return "applied";
    }
    if (comparison === 0) return "duplicate";
    if (event.previousSeq !== snapshot.committedSeq) {
      return this.resync();
    }
    if (
      controlWorkspace(event.context) !== controlWorkspace(snapshot.context) ||
      controlTask(event.context) !== controlTask(snapshot.context) ||
      (event.context.status === "available" &&
        snapshot.context.status === "available" &&
        event.context.version.controlRev < snapshot.context.version.controlRev)
    )
      return this.resync();
    // One update contains ALL row changes at its committed watermark. Validate
    // on a copy: a bad sibling cannot leave a partly applied batch behind.
    const rows = [...snapshot.runs];
    for (const key of event.removed) {
      const index = rows.findIndex((r) => (r.childRunId ?? r.runId) === key);
      if (index === -1 || rows[index].lifecycle !== "settled")
        return this.resync();
      rows.splice(index, 1);
    }
    for (const run of event.runs) {
      const key = run.childRunId ?? run.runId;
      const index = rows.findIndex((r) => (r.childRunId ?? r.runId) === key);
      if (index === -1) rows.push(run);
      else {
        const previous = rows[index];
        if (
          previous.runId !== run.runId ||
          previous.childRunId !== run.childRunId ||
          previous.assignmentId !== run.assignmentId ||
          canonicalJson(previous.admission) !== canonicalJson(run.admission)
        )
          return this.resync();
        rows[index] = run;
      }
    }
    if (rows.length > LIMITS.maxPageEntries) return this.resync();
    const candidate = {
      ...snapshot,
      runs: rows,
      context: event.context,
      committedSeq: event.committedSeq,
      horizon: {
        ...snapshot.horizon,
        historicalRuns: {
          ...snapshot.horizon.historicalRuns,
          snapshotSeq: event.committedSeq,
        },
      },
    };
    try {
      decodeSnapshot(candidate);
    } catch {
      return this.resync();
    }
    snapshot.runs = rows;
    snapshot.horizon = candidate.horizon;
    snapshot.context = event.context;
    snapshot.committedSeq = event.committedSeq;
    state.lastObservedMs = now;
    state.connection = "current";
    return "applied";
  }
}
