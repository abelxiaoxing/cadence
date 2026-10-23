import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ServiceCoordination } from "../service/coordination.ts";
import { hash } from "../service/private-files.ts";
import {
  type CaptureCoverage,
  ContractError,
  canonicalJson,
  type DetailPage,
  type DetailReadResult,
  decodeCursor,
  decodeDetailPage,
  decodeGraphPage,
  decodeGraphReadRequest,
  decodeHistoryRecord,
  decodeId,
  decodeListRequest,
  decodeSequence,
  type GraphPage,
  type GraphReadRequest,
  type GraphReadResult,
  type HistoryReadResult,
  type HistoryRecord,
  LIMITS,
  type ListRequest,
  ownerInScope,
  type ReadCursor,
  type Scope,
} from "../service-contract.ts";
import type { RunAdmission } from "./admission.ts";
import { detailPreparation, readRetainedDetail } from "./detail-progress.ts";
import { emptyScan, HistoryFiles, HistoryReadBudget } from "./files.ts";
import { graphPreparation, readRetainedGraph } from "./graph-progress.ts";
import { HistoryNavigation } from "./navigation.ts";
import type { PublishedPlan } from "./plans.ts";
import { HistoryProjection } from "./projection.ts";
import { readRange } from "./read-io.ts";
import { HistoryReadProof } from "./read-proof.ts";
import {
  OperationState,
  RunState,
  readRunState,
  TaskPublicationLineage,
} from "./run-state.ts";
import {
  collectSavedGraph,
  freshSavedGraph,
  materializeSavedGraph,
} from "./saved-graph-state.ts";
import { RetainedScan } from "./search.ts";
import {
  COMPLETE,
  captureCoverage,
  combineCoverage,
  FORMAT,
  type JournalRow,
  type RetainedDetail,
  type SavedEvent,
} from "./types.ts";

/** Readonly retained journal/detail reader. Construction/open never initializes,
 * repairs, resolves auth, creates a session, or resumes a queue. */
export class HistoryReader {
  private cached?: {
    key: string;
    detail: RetainedDetail;
    chunks: Extract<SavedEvent, { kind: "chunk" }>[];
    segments: Map<number, { identity: string; bytes: number }>;
    snapshotSeq: string;
  };
  private readonly navigation: HistoryNavigation;
  private constructor(readonly files: HistoryFiles) {
    this.navigation = new HistoryNavigation(files);
  }
  static open(coordination: ServiceCoordination): HistoryReader | undefined {
    const files = HistoryFiles.open(coordination);
    return files ? new HistoryReader(files) : undefined;
  }
  /** Exact committed historical allocation. Never replaces current control context.
   * Exhausted metadata lookup refuses; long-store continuation remains a separate seam. */
  admission(runId: string, snapshotSeq: string): RunAdmission {
    decodeId(runId);
    decodeSequence(snapshotSeq);
    const budget = new HistoryReadBudget();
    this.navigation.snapshot(snapshotSeq, budget);
    const batches = this.navigation.entityBatches(runId, snapshotSeq, budget);
    const state = batches
      ? new RunState(runId)
      : readRunState(this.files, runId, snapshotSeq, budget);
    if (batches)
      for (const batch of batches)
        for (const row of batch.rows) state.apply(row, batch.pointer.seq);
    if (!state.admission) throw new ContractError("corrupt-selected");
    return this.files.readAdmission(runId, state.admission, budget);
  }
  /** Bounded owner lookup for the latest saved plan at a committed snapshot.
   * A later pending/conflicted save refuses; it never revives an older graph.
   * This descriptor is historical metadata, not current execution authority. */
  publishedPlan(
    taskId: string,
    snapshotSeq: string,
    current?: { revision: number; identity: string; plan: string },
  ): PublishedPlan | null {
    decodeId(taskId);
    decodeSequence(snapshotSeq);
    const budget = new HistoryReadBudget();
    this.navigation.snapshot(snapshotSeq, budget);
    const batches =
      this.navigation.entityBatches(taskId, snapshotSeq, budget) ??
      this.navigation.scanSnapshot(snapshotSeq, budget);
    let operation: OperationState | null = null;
    const lineage = new TaskPublicationLineage();
    let graphIdentity = "";
    for (const batch of batches) {
      for (const row of batch.rows) {
        const value = row.value;
        if (
          value.kind === "admission" &&
          value.intent.identity.kind === "action" &&
          value.intent.identity.action.kind === "save-plan" &&
          value.intent.identity.action.taskId === taskId
        ) {
          if (value.intent.runId !== null)
            throw new ContractError("corrupt-selected");
          operation = new OperationState(value.intent.operationId);
          graphIdentity = hash(
            canonicalJson(value.intent.identity.action.graph),
          );
        }
        operation?.apply(row, batch.pointer.seq);
        if (current)
          lineage.apply(row, batch.pointer.seq, taskId, graphIdentity);
      }
    }
    if (!operation) return null;
    const command = operation.command;
    if (
      command?.intent.identity.kind !== "action" ||
      command.intent.identity.action.kind !== "save-plan"
    )
      throw new ContractError("corrupt-selected");
    const receipt = operation.receipt();
    if (receipt?.receipt.publication !== "published")
      throw new ContractError("conflict");
    const { graph, plan } = command.intent.identity.action;
    const ref = graph.plan;
    const { detail, bytes: text } = this.planText(
      {
        storeId: this.storeId,
        scope: { kind: "task", id: taskId },
        snapshotSeq,
        query: null,
        recordId: ref.recordId,
        recordVersion: ref.version,
        field: "plan",
        offset: 0,
      },
      budget,
    );
    if (
      canonicalJson(detail.content) !== canonicalJson(ref) ||
      detail.origin.kind !== "owner" ||
      detail.origin.id !== operation.operationId ||
      detail.owner.taskId !== taskId ||
      detail.owner.runId !== null ||
      detail.owner.childRunId !== null ||
      detail.owner.entity.kind !== "task" ||
      detail.owner.entity.id !== taskId ||
      detail.owner.entity.version !== graph.planRevision ||
      ref.bytes > 32768
    )
      throw new ContractError("corrupt-selected");
    if (text.toString("utf8") !== plan)
      throw new ContractError("corrupt-selected");
    const publication = current
      ? lineage.current()
      : operation.publicationExpected();
    if (!publication.identity) throw new ContractError("corrupt-selected");
    if (
      current &&
      (current.identity !== publication.identity ||
        current.revision !== publication.revision ||
        current.plan !== plan)
    )
      throw new ContractError("stale");
    return {
      operationId: operation.operationId,
      graph,
      reference: {
        recordId: operation.operationId,
        revision: graph.revision,
        sha256: hash(canonicalJson(graph)),
      },
      publication: {
        revision: publication.revision,
        identity: publication.identity,
      },
      committedSeq: receipt.receipt.committedSeq,
    };
  }
  /** Latest actual non-check execution for this task. Missing/bounded proof is
   * never replaced with an old RAM target or a fake drained run. */
  reviewRun(
    taskId: string,
    runId: string,
    snapshotSeq: string,
    budget = new HistoryReadBudget(),
  ): RunState {
    decodeId(taskId);
    decodeId(runId);
    decodeSequence(snapshotSeq);
    this.navigation.snapshot(snapshotSeq, budget);
    const batches = () =>
      this.navigation.entityBatches(taskId, snapshotSeq, budget) ??
      this.navigation.scanSnapshot(snapshotSeq, budget);
    let latest: string | null = null;
    for (const batch of batches())
      for (const row of batch.rows) {
        const v = row.value;
        if (
          v.kind === "admission" &&
          v.intent.identity.kind === "action" &&
          v.intent.identity.expected.task?.id === taskId &&
          (v.intent.identity.action.kind === "start" ||
            v.intent.identity.action.kind === "generate-plan")
        )
          latest = v.intent.runId;
      }
    if (latest !== runId) throw new ContractError("stale");
    const state = new RunState(runId);
    const runBatches =
      this.navigation.runBatches(runId, snapshotSeq, budget) ??
      this.navigation.entityBatches(runId, snapshotSeq, budget) ??
      this.navigation.scanSnapshot(snapshotSeq, budget);
    for (const batch of runBatches)
      for (const row of batch.rows) state.apply(row, batch.pointer.seq);
    if (
      !state.admission ||
      state.admission.context.task?.id !== taskId ||
      !state.drained ||
      state.publication !== "published"
    )
      throw new ContractError("conflict");
    this.files.readAdmission(runId, state.admission, budget);
    return state;
  }
  /** Review displays the selected execution, not a prospective/default next Start
   * or a later saved graph. Current raw-task authority remains independently bound. */
  reviewSelection(taskId: string, runId: string, snapshotSeq: string) {
    const budget = new HistoryReadBudget();
    const run = this.reviewRun(taskId, runId, snapshotSeq, budget);
    if (!run.admission) throw new ContractError("corrupt-selected");
    const { graph } = this.files.readAdmission(runId, run.admission, budget);
    if (!graph) return { run, graph, readablePlan: "" }; // Generate is graph-null.
    const ref = graph.plan;
    const { detail, bytes } = this.planText(
      {
        storeId: this.storeId,
        scope: { kind: "task", id: taskId },
        snapshotSeq,
        query: null,
        recordId: ref.recordId,
        recordVersion: ref.version,
        field: "plan",
        offset: 0,
      },
      budget,
    );
    if (
      ref.bytes > 32768 ||
      canonicalJson(detail.content) !== canonicalJson(ref) ||
      detail.owner.taskId !== taskId ||
      detail.owner.runId !== null ||
      detail.owner.childRunId !== null ||
      detail.owner.entity.kind !== "task" ||
      detail.owner.entity.id !== taskId ||
      detail.owner.entity.version !== graph.planRevision
    )
      throw new ContractError("corrupt-selected");
    return { run, graph, readablePlan: bytes.toString("utf8") };
  }
  async graph(value: GraphReadRequest): Promise<GraphReadResult> {
    const request = decodeGraphReadRequest(value);
    if (request.navigation !== undefined)
      return readRetainedGraph(this, request);
    const budget = new HistoryReadBudget();
    if (this.files.format.schema !== FORMAT)
      return this.graphData(request, budget);
    const completion = new HistoryReadProof(this.files).prepareCompletion(
      budget,
    );
    try {
      const page = this.graphData(request, budget);
      completion.validate();
      return page;
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      return graphPreparation(request, completion);
    }
  }
  private graphData(
    request: GraphReadRequest,
    budget: HistoryReadBudget,
  ): GraphPage {
    if (request.storeId !== this.storeId)
      throw new ContractError("corrupt-selected");
    if (request.scope.kind === "task") {
      this.navigation.snapshot(request.snapshotSeq, budget);
      const state = freshSavedGraph();
      const batches =
        this.navigation.entityBatches(
          request.graph.recordId,
          request.snapshotSeq,
          budget,
        ) ?? this.navigation.scanSnapshot(request.snapshotSeq, budget);
      for (const batch of batches) {
        for (let row = 0; row < batch.rows.length; row++) {
          const v = batch.rows[row].value;
          const count = v.kind === "owner" ? v.events.length : 1;
          for (let index = 0; index < count; index++)
            collectSavedGraph(
              state,
              request,
              batch,
              row,
              index,
              this.files,
              budget,
            );
        }
        const graph = materializeSavedGraph(state, request, this.files, budget);
        if (graph) return decodeGraphPage({ request, graph });
      }
      if (state.accepted) throw new ContractError("corrupt-selected");
    }
    let selected: RunAdmission | undefined,
      found = request.snapshotSeq === "0";
    this.navigation.snapshot(request.snapshotSeq, budget);
    const indexed = this.navigation.entityBatches(
      request.graph.recordId,
      request.snapshotSeq,
      budget,
    );
    if (indexed) {
      for (const batch of indexed)
        for (const row of batch.rows)
          if (row.value.kind === "owner")
            for (const e of row.value.events)
              if (
                e.kind === "owner" &&
                e.value.kind === "fact" &&
                e.value.fact.kind === "parent-admitted"
              ) {
                const f = e.value.fact;
                const fits =
                  request.scope.kind === "task"
                    ? f.identity.context.task?.id === request.scope.id
                    : request.scope.kind === "run"
                      ? f.runId === request.scope.id
                      : f.identity.assignments.some(
                          (a) => a.childRunId === request.scope.id,
                        );
                if (
                  fits &&
                  canonicalJson(f.identity.graph) ===
                    canonicalJson(request.graph)
                )
                  selected = this.files.readAdmission(
                    f.runId,
                    f.identity,
                    budget,
                  );
              }
      if (!selected?.graph) throw new ContractError("corrupt-selected");
      return decodeGraphPage({ request, graph: selected.graph });
    }
    if (request.snapshotSeq !== "0")
      for (const batch of this.files.scan(emptyScan(), false, budget)) {
        if (BigInt(batch.marker.last) > BigInt(request.snapshotSeq))
          throw new ContractError("corrupt-selected");
        for (const row of batch.rows) {
          const v = row.value;
          if (v.kind !== "owner") continue;
          for (const e of v.events) {
            if (
              e.kind !== "owner" ||
              e.value.kind !== "fact" ||
              e.value.fact.kind !== "parent-admitted"
            )
              continue;
            const fact = e.value.fact;
            const fits =
              request.scope.kind === "task"
                ? fact.identity.context.task?.id === request.scope.id
                : request.scope.kind === "run"
                  ? fact.runId === request.scope.id
                  : fact.identity.assignments.some(
                      (a) => a.childRunId === request.scope.id,
                    );
            if (
              fits &&
              canonicalJson(fact.identity.graph) ===
                canonicalJson(request.graph)
            )
              selected = this.files.readAdmission(
                fact.runId,
                fact.identity,
                budget,
              );
          }
        }
        if (batch.marker.last === request.snapshotSeq) {
          found = true;
          break;
        }
      }
    if (!found || !selected?.graph) throw new ContractError("corrupt-selected");
    return decodeGraphPage({ request, graph: selected.graph });
  }
  get storeId(): string {
    return this.files.format.storeId;
  }
  inspect() {
    return this.files.inspect();
  }
  /** Snapshot must be an actual committed batch boundary, not a guessed row seq. */
  *rows(snapshotSeq: string): Generator<JournalRow> {
    if (snapshotSeq === "0") return;
    const state = emptyScan();
    for (const batch of this.files.scan(state)) {
      if (BigInt(batch.marker.last) > BigInt(snapshotSeq))
        throw new ContractError("corrupt-selected");
      yield* batch.rows;
      if (batch.marker.last === snapshotSeq) return;
    }
    throw new ContractError("corrupt-selected");
  }
  validateSnapshot(snapshotSeq: string): void {
    for (const _ of this.rows(snapshotSeq)) {
      /* exact retained membership */
    }
  }
  coverage(snapshotSeq: string): CaptureCoverage {
    let coverage: CaptureCoverage = { ...COMPLETE, omissions: [] };
    const open = new Set<string>();
    // Bounded active details only. Finished entries are not kept as a transcript.
    for (const row of this.rows(snapshotSeq)) {
      const v = row.value;
      if (v.kind !== "capture" && v.kind !== "owner") continue;
      for (const e of v.events) {
        if (e.kind === "capture" && e.value.event.kind === "detail-begin")
          open.add(`${v.link.runId}/${e.value.event.detailId}`);
        if (e.kind === "owner" && e.value.kind === "content-begin")
          open.add(`${v.link.runId}/${e.value.detailId}`);
        if (e.kind === "end") {
          open.delete(`${v.link.runId}/${e.detail.detailId}`);
          coverage = combineCoverage(coverage, e.detail.coverage);
        }
        const observed =
          e.kind === "capture" ? captureCoverage(e.value.event) : null;
        if (observed) coverage = combineCoverage(coverage, observed);
      }
      if (open.size > LIMITS.dataFrames) throw new ContractError("capacity");
    }
    const state = this.inspect();
    if (open.size || (state.committedSeq === snapshotSeq && state.tail))
      coverage = combineCoverage(coverage, {
        ...COMPLETE,
        observed: "incomplete",
        omissions: ["gap"],
      });
    return coverage;
  }
  *details(snapshotSeq: string, scope: Scope): Generator<RetainedDetail> {
    for (const row of this.rows(snapshotSeq)) {
      const v = row.value;
      if (v.kind !== "capture" && v.kind !== "owner") continue;
      for (const e of v.events)
        if (e.kind === "end" && ownerInScope(e.detail.owner, scope))
          yield e.detail;
    }
  }
  selected(cursor: ReadCursor, budget?: HistoryReadBudget): RetainedDetail {
    if (budget) this.files.assertReadFormat(budget);
    else this.files.assertFormat();
    if (cursor.storeId !== this.storeId)
      throw new ContractError("corrupt-selected");
    const key = canonicalJson({ ...cursor, offset: 0, query: null });
    if (this.cached?.key !== key) {
      const chunks: Extract<SavedEvent, { kind: "chunk" }>[] = [],
        segments = new Map<number, { identity: string; bytes: number }>();
      let detail: RetainedDetail | undefined,
        snapshotFound = cursor.snapshotSeq === "0";
      for (const batch of this.files.scan(emptyScan(), false, budget)) {
        if (BigInt(batch.marker.last) > BigInt(cursor.snapshotSeq)) break;
        // Include the entire validated prefix, not only content-bearing files:
        // corruption in an intervening segment invalidates snapshot membership.
        segments.set(batch.segment, {
          identity: batch.identity,
          bytes: batch.segmentBytes,
        });
        for (const row of batch.rows) {
          const v = row.value;
          if (v.kind !== "capture" && v.kind !== "owner") continue;
          for (const e of v.events) {
            if (
              e.kind === "chunk" &&
              e.artifact.artifactId === cursor.recordId
            ) {
              chunks.push(e);
            }
            if (
              e.kind === "end" &&
              e.detail.content.recordId === cursor.recordId
            ) {
              if (detail) throw new ContractError("corrupt-selected");
              detail = e.detail;
            }
          }
        }
        if (chunks.length + segments.size > LIMITS.dataFrames)
          throw new ContractError("capacity");
        if (batch.marker.last === cursor.snapshotSeq) {
          snapshotFound = true;
          break;
        }
      }
      if (
        !snapshotFound ||
        !detail ||
        detail.content.version !== cursor.recordVersion ||
        detail.content.field !== cursor.field ||
        !this.detailOwner(detail, cursor, budget)
      )
        throw new ContractError("corrupt-selected");
      this.cached = {
        key,
        detail,
        chunks,
        segments,
        snapshotSeq: cursor.snapshotSeq,
      };
    }
    if (cursor.offset > this.cached.detail.content.bytes)
      throw new ContractError("invalid");
    return this.cached.detail;
  }
  /** At most one detail's bounded locator metadata is cached. Cache is not an
   * authority: reread every contributing segment and selected artifact before use.
   * No whole transcript/text array or on-read index publication. */
  /** A whole small retained text and its end detail at the cursor's snapshot.
   * Its derived content/part indexes, under the validated snapshot, only select
   * candidates; their ORIGINAL committed chunk batches and artifacts are read,
   * contiguous from offset 0, and the aggregate content hash is checked. Absent
   * or faulty indexes fall back to the complete validated-prefix scan. */
  private planText(
    cursor: ReadCursor,
    budget: HistoryReadBudget,
  ): { detail: RetainedDetail; bytes: Buffer } {
    const indexed = this.indexedText(cursor, budget);
    if (indexed) return indexed;
    const detail = this.selected(cursor, budget);
    return {
      detail,
      bytes: Buffer.concat(
        [...this.parts(detail, cursor.snapshotSeq, budget)].map((p) => p.bytes),
      ),
    };
  }
  private indexedText(
    cursor: ReadCursor,
    budget: HistoryReadBudget,
  ): { detail: RetainedDetail; bytes: Buffer } | undefined {
    const nav = this.navigation,
      id = cursor.recordId;
    if (!id) return;
    try {
      this.files.assertReadFormat(budget);
      nav.snapshot(cursor.snapshotSeq, budget);
      const detail = nav.content(id, cursor.snapshotSeq, budget);
      if (
        !detail ||
        detail.content.version !== cursor.recordVersion ||
        detail.content.field !== cursor.field
      )
        return;
      const pieces: Buffer[] = [];
      let end = 0;
      if (detail.content.bytes) {
        const count = nav.partCount(id, budget);
        for (let part = 0; part < count; part++) {
          const chunks = nav.part(id, part, cursor.snapshotSeq, budget);
          if (!chunks?.length) return;
          const bytes = this.files.readArtifact(chunks[0].artifact, budget);
          for (const c of chunks) {
            if (c.offset !== end || c.start + c.length > bytes.length) return;
            pieces.push(bytes.subarray(c.start, c.start + c.length));
            end += c.length;
          }
        }
      }
      const text = Buffer.concat(pieces);
      if (
        end !== detail.content.bytes ||
        createHash("sha256").update(text).digest("hex") !==
          detail.content.sha256
      )
        return;
      return { detail, bytes: text };
    } catch {
      budget.reserve(0); // Exhaustion stays inconclusive; an index fault scans.
      return;
    }
  }
  *parts(
    detail: RetainedDetail,
    snapshotSeq: string,
    budget?: HistoryReadBudget,
    range?: { start: number; end: number },
  ): Generator<{ offset: number; bytes: Buffer }> {
    if (budget) this.files.assertReadFormat(budget);
    else this.files.assertFormat();
    if (
      this.cached?.detail.content.recordId !== detail.content.recordId ||
      this.cached.snapshotSeq !== snapshotSeq
    ) {
      this.selected(
        {
          storeId: this.storeId,
          scope: { kind: "task", id: detail.owner.taskId },
          snapshotSeq,
          query: null,
          recordId: detail.content.recordId,
          recordVersion: detail.content.version,
          field: detail.content.field,
          offset: 0,
        },
        budget,
      );
    }
    const locator = this.cached;
    if (!locator) throw new ContractError("corrupt-selected");
    if (canonicalJson(locator.detail) !== canonicalJson(detail))
      throw new ContractError("corrupt-selected");
    for (const [segment, expected] of locator.segments) {
      const current = budget
        ? readRange(
            this.files,
            this.files.segmentPath(segment),
            0,
            expected.bytes,
            budget,
          )
        : this.files.files.read(
            this.files.segmentPath(segment),
            LIMITS.segmentBytes,
          )?.bytes;
      if (
        !current ||
        current.length < expected.bytes ||
        hash(current.subarray(0, expected.bytes)) !== expected.identity
      )
        throw new ContractError("corrupt-selected");
    }
    const checksum = createHash("sha256");
    let bytes = 0;
    let cached: { key: string; bytes: Buffer } | undefined;
    for (const e of locator.chunks) {
      if (e.detailId !== detail.detailId || e.offset !== bytes)
        throw new ContractError("corrupt-selected");
      bytes += e.length;
      if (
        range &&
        (e.offset + e.length <= range.start || e.offset >= range.end)
      )
        continue;
      const key = canonicalJson(e.artifact);
      if (cached?.key !== key)
        cached = { key, bytes: this.files.readArtifact(e.artifact, budget) };
      if (e.start + e.length > cached.bytes.length)
        throw new ContractError("corrupt-selected");
      const part = cached.bytes.subarray(e.start, e.start + e.length);
      if (!range) checksum.update(part);
      yield { offset: e.offset, bytes: part };
    }
    if (
      bytes !== detail.content.bytes ||
      (!range && checksum.digest("hex") !== detail.content.sha256)
    )
      throw new ContractError("corrupt-selected");
  }
  private detailOwner(
    detail: RetainedDetail,
    cursor: ReadCursor,
    budget = new HistoryReadBudget(),
  ) {
    return new RetainedScan(this, cursor, budget).scopedOwner(detail);
  }
  /** Inline goal/handoff projections have real retained source membership and
   * deterministic content identities; they are not new persisted artifacts. */
  private inlineDetail(
    cursor: ReadCursor,
    budget: HistoryReadBudget,
  ): DetailPage | undefined {
    const scan = new RetainedScan(this, cursor, budget);
    const item = scan.inline(cursor);
    if (item?.kind !== "text") return;
    if (cursor.offset > item.content.bytes)
      throw new ContractError("corrupt-selected");
    const bytes = Buffer.from(item.text);
    if ((bytes[cursor.offset] & 0xc0) === 0x80)
      throw new ContractError("invalid");
    return this.boundedDetail({
      cursor,
      content: item.content,
      range: item.content.bytes
        ? { start: cursor.offset, end: item.content.bytes }
        : null,
      text: bytes.subarray(cursor.offset).toString("utf8"),
      next: null,
      coverage: item.coverage,
    });
  }

  private boundedDetail(page: DetailPage): DetailPage {
    // JSON escaping can double (or sextuple) raw text. Preserve the ordinary
    // 256KiB page while splitting escaped content by actual FULL Reply size.
    if (
      Buffer.byteLength(JSON.stringify({ kind: "ok", value: page })) <=
      LIMITS.pageBytes
    )
      return decodeDetailPage(page);
    const bytes = Buffer.from(page.text);
    let lo = 0,
      hi = bytes.length;
    const prefix = (length: number) => {
      while (length > 0 && (bytes[length] & 0xc0) === 0x80) length--;
      const end = page.cursor.offset + length;
      return {
        ...page,
        text: bytes.subarray(0, length).toString("utf8"),
        range: { start: page.cursor.offset, end },
        next: { ...page.cursor, offset: end },
      };
    };
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (
        Buffer.byteLength(JSON.stringify({ kind: "ok", value: prefix(mid) })) <=
        LIMITS.pageBytes
      )
        lo = mid;
      else hi = mid - 1;
    }
    if (!lo) throw new ContractError("oversize");
    return decodeDetailPage(prefix(lo));
  }
  async readDetail(value: ReadCursor): Promise<DetailReadResult> {
    const cursor = decodeCursor(value);
    if (
      cursor.navigation !== undefined ||
      (this.files.format.schema === FORMAT &&
        !existsSync(
          join(this.files.directory, "indexes", "heads", "latest.json"),
        ))
    )
      return readRetainedDetail(this, cursor);
    if (this.files.format.schema !== FORMAT) return this.detail(cursor);
    const budget = new HistoryReadBudget();
    // Prepay only the fixed completion metadata IO in this same request window.
    // An exhausted accelerator never gets a second read quantum on this call.
    const completion = new HistoryReadProof(this.files).prepareCompletion(
      budget,
    );
    try {
      const page = await this.detail(cursor, budget);
      completion.validate();
      return page;
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive"
      )
        throw error;
      return detailPreparation(cursor, completion);
    }
  }
  async detail(
    value: ReadCursor,
    budget = new HistoryReadBudget(),
  ): Promise<DetailPage> {
    const cursor = decodeCursor(value);
    if (cursor.navigation !== undefined)
      throw new ContractError("corrupt-selected");
    if (cursor.storeId !== this.storeId)
      throw new ContractError("corrupt-selected");
    const nav = this.navigation;
    const inline = this.inlineDetail(cursor, budget);
    if (inline) return inline;
    nav.snapshot(cursor.snapshotSeq, budget);
    const indexed = nav.content(
      cursor.recordId ?? "",
      cursor.snapshotSeq,
      budget,
    );
    if (indexed) return this.indexedDetail(cursor, indexed, nav, budget);
    const detail = this.selected(cursor, budget);
    const pieces: Buffer[] = [];
    let bytes = 0,
      pageFull = false;
    try {
      for (const part of this.parts(detail, cursor.snapshotSeq, budget, {
        start: cursor.offset,
        end: Math.min(
          detail.content.bytes,
          cursor.offset + LIMITS.detailPageBytes,
        ),
      })) {
        if (
          part.offset + part.bytes.length <= cursor.offset ||
          pageFull ||
          bytes >= LIMITS.detailPageBytes
        )
          continue;
        const from = Math.max(0, cursor.offset - part.offset);
        if (from < part.bytes.length && (part.bytes[from] & 0xc0) === 0x80)
          throw new ContractError("invalid");
        let to = Math.min(
          part.bytes.length,
          from + LIMITS.detailPageBytes - bytes,
        );
        while (
          to < part.bytes.length &&
          to > from &&
          (part.bytes[to] & 0xc0) === 0x80
        )
          to--;
        const selected = part.bytes.subarray(from, to);
        pieces.push(selected);
        bytes += selected.length;
        if (to < part.bytes.length) pageFull = true;
        // The selected page validates real part hashes. Metadata still validates the
        // complete selected range; full-body aggregate verification is writer-owned.
      }
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.code !== "receipt-inconclusive" ||
        bytes === 0
      )
        throw error;
    }
    const end = cursor.offset + bytes;
    return this.boundedDetail({
      cursor,
      content: detail.content,
      range: detail.content.bytes ? { start: cursor.offset, end } : null,
      text: Buffer.concat(pieces).toString("utf8"),
      next: end < detail.content.bytes ? { ...cursor, offset: end } : null,
      coverage: detail.coverage,
    });
  }
  private indexedDetail(
    cursor: ReadCursor,
    detail: RetainedDetail,
    nav: HistoryNavigation,
    budget: HistoryReadBudget,
  ): DetailPage {
    if (
      detail.content.version !== cursor.recordVersion ||
      detail.content.field !== cursor.field ||
      !this.detailOwner(detail, cursor, budget) ||
      cursor.offset > detail.content.bytes
    )
      throw new ContractError("corrupt-selected");
    const pieces: Buffer[] = [];
    let end = cursor.offset;
    if (detail.content.bytes) {
      const count = nav.partCount(detail.content.recordId, budget);
      const load = (part: number) => {
        const c = nav.part(
          detail.content.recordId,
          part,
          cursor.snapshotSeq,
          budget,
        );
        if (!c) throw new ContractError("receipt-inconclusive");
        return c;
      };
      let lo = 0,
        hi = count - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2),
          hint = nav.partRange(detail.content.recordId, mid, budget);
        if (hint.last <= cursor.offset) lo = mid + 1;
        else hi = mid;
      }
      let full = false;
      for (
        let part = lo;
        part < count && !full && end - cursor.offset < LIMITS.detailPageBytes;
        part++
      ) {
        let chunks: Extract<SavedEvent, { kind: "chunk" }>[], bytes: Buffer;
        try {
          chunks = load(part);
          const last = chunks.at(-1);
          if (
            !last ||
            chunks[0].offset > end ||
            last.offset + last.length <= end ||
            last.offset + last.length > detail.content.bytes
          )
            throw new ContractError("corrupt-selected");
          bytes = this.files.readArtifact(chunks[0].artifact, budget);
        } catch (error) {
          // Exhaustion is navigation, not capture truncation. Publish the verified
          // nonempty prefix and an advancing cursor; never read past admission.
          if (
            error instanceof ContractError &&
            error.code === "receipt-inconclusive" &&
            end > cursor.offset
          )
            break;
          throw error;
        }
        for (const c of chunks) {
          if (c.offset + c.length <= end) continue;
          if (c.offset > end) throw new ContractError("corrupt-selected");
          const from = c.start + end - c.offset;
          if ((bytes[from] & 0xc0) === 0x80) throw new ContractError("invalid");
          let to = Math.min(
            c.start + c.length,
            from + LIMITS.detailPageBytes - (end - cursor.offset),
          );
          while (to < bytes.length && to > from && (bytes[to] & 0xc0) === 0x80)
            to--;
          pieces.push(bytes.subarray(from, to));
          end += to - from;
          if (to < c.start + c.length) {
            full = true;
            break;
          }
        }
      }
    }
    return this.boundedDetail({
      cursor,
      content: detail.content,
      range: detail.content.bytes ? { start: cursor.offset, end } : null,
      text: Buffer.concat(pieces).toString("utf8"),
      next: end < detail.content.bytes ? { ...cursor, offset: end } : null,
      coverage: detail.coverage,
    });
  }
  *records(
    snapshotSeq: string,
    scope: Scope,
  ): Generator<{ rowId: string; offset: number; record: HistoryRecord }> {
    for (const row of this.rows(snapshotSeq)) {
      const v = row.value;
      if (v.kind !== "capture" && v.kind !== "owner") continue;
      const fits =
        scope.kind === "task"
          ? v.link.taskId === scope.id
          : scope.kind === "run"
            ? v.link.runId === scope.id
            : v.kind === "capture" && v.link.childRunId === scope.id;
      if (!fits) continue;
      for (const [offset, e] of v.events.entries()) {
        if (v.kind === "capture") {
          if (e.kind === "end" && e.detail.descriptor)
            yield {
              rowId: row.id,
              offset,
              record: decodeHistoryRecord({
                kind: "content",
                owner: e.detail.owner,
                version: e.detail.content.version,
                detailId: e.detail.detailId,
                descriptor: e.detail.descriptor,
                content: e.detail.content,
                coverage: e.detail.coverage,
              }),
            };
          // Chunk bodies are retrieved through details rather than duplicated into
          // event pages. Their original provenance remains in the private journal.
          if (e.kind === "capture")
            yield {
              rowId: row.id,
              offset,
              record: decodeHistoryRecord({
                kind: "capture-fact",
                recordId: e.id,
                committedSeq: row.seq,
                link: v.link,
                capture: e.value,
              }),
            };
        } else if (e.kind === "owner" && e.value.kind === "fact")
          yield {
            rowId: row.id,
            offset,
            record: decodeHistoryRecord({
              kind: "owner-fact",
              observedMs: v.observedMs,
              recordId: e.id,
              committedSeq: row.seq,
              link: v.link,
              fact: e.value.fact,
            }),
          };
      }
    }
  }
  /** Compatibility retained read surface; all paging uses the same bounded owner.
   * Current context is deliberately unavailable, never fabricated for a raw read. */
  async page(value: ListRequest): Promise<HistoryReadResult> {
    const request = decodeListRequest(value);
    if (request.reader !== "events" && request.reader !== "contents")
      throw new ContractError("unsupported-context");
    const unavailable = (): never => {
      throw new ContractError("unavailable");
    };
    const projection = new HistoryProjection(this, {
      session: unavailable,
      workspace: unavailable,
      context: unavailable,
      checks: unavailable,
      legacyTasks: unavailable,
    });
    return projection[request.reader](request);
  }
}
