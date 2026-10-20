/** Native retained readers: one human-paced request per page/proof continuation. */

import { exportNative } from "./native-export.ts";
import type { ServiceClient } from "./service-client.ts";
import {
  type ContentRef,
  ContractError,
  type DetailReadResult,
  type ExportRequest,
  type GraphReadRequest,
  type HistoryRecord,
  type ListRequest,
  type ReadCursor,
  type ReaderKind,
  type Reply,
  type Scope,
  type Snapshot,
} from "./service-contract.ts";
import { diagnosticText } from "./verification-diagnostics.ts";

export function value<T>(reply: Reply<T>): T {
  if (reply.kind === "error") throw new ContractError(reply.error.code);
  return reply.value;
}
export const pretty = (data: unknown) => JSON.stringify(data, null, 2);
export interface NativeViews {
  select(title: string, choices: string[]): Promise<string | undefined>;
  input(title: string, prefill?: string): Promise<string | undefined>;
  show(text: string): Promise<void>;
  confirm(title: string, text: string): Promise<boolean>;
  notify(text: string): void;
  current(): void;
  signal: AbortSignal;
}
export class NativeHistory {
  constructor(
    readonly client: ServiceClient,
    readonly storeId: string,
    readonly ui: NativeViews,
  ) {}
  async detail(seed: ReadCursor): Promise<void> {
    let cursor: ReadCursor | null = seed;
    const previous: ReadCursor[] = [];
    while (cursor) {
      const page: DetailReadResult = value(
        await this.client.detail(cursor, this.ui.signal),
      );
      this.ui.current();
      await this.ui.show(
        "kind" in page
          ? `Detail proof progress — no content yet\n${pretty(page.coverage)}`
          : `${page.content.field} • ${page.content.recordId} v${page.content.version}\nUTF-8 bytes ${pretty(page.range)} / ${page.content.bytes}\nCoverage ${pretty(page.coverage)}\n\n${page.text}`,
      );
      const action = await this.ui.select("Retained detail (not a preview)", [
        ...(page.next ? ["Next detail page / proof"] : []),
        ...(previous.length ? ["Previous detail page"] : []),
        "Return",
      ]);
      if (action === "Next detail page / proof" && page.next) {
        previous.push(cursor);
        cursor = page.next;
      } else if (action === "Previous detail page")
        cursor = previous.pop() ?? null;
      else return;
    }
  }
  async graph(seed: GraphReadRequest) {
    let request = seed;
    for (;;) {
      const page = value(await this.client.graph(request, this.ui.signal));
      this.ui.current();
      if (!("kind" in page)) return page.graph;
      if (
        (await this.ui.select(
          `Graph proof progress • ${pretty(page.coverage)}`,
          ["Continue graph proof", "Return"],
        )) !== "Continue graph proof"
      )
        return;
      request = page.next;
    }
  }
  private cursor(scope: Scope, seq: string, ref: ContentRef): ReadCursor {
    return {
      storeId: this.storeId,
      scope,
      snapshotSeq: seq,
      query: null,
      recordId: ref.recordId,
      recordVersion: ref.version,
      field: ref.field,
      offset: 0,
    };
  }
  async record(record: HistoryRecord, request: ListRequest): Promise<void> {
    await this.ui.show(pretty(record));
    if (request.scope.kind === "workspace" || !request.snapshotSeq) return;
    const scope = request.scope,
      refs: ContentRef[] = [];
    switch (record.kind) {
      case "task":
        if (record.plan) refs.push(record.plan);
        break;
      case "message":
        if (record.finalText) refs.push(record.finalText);
        break;
      case "content":
        refs.push(record.content);
        break;
      case "owner-fact": {
        const fact = record.fact;
        if (fact.kind === "changes" || fact.kind === "review")
          refs.push(fact.content);
        if (fact.kind === "check-settled" && fact.output)
          refs.push(fact.output);
        break;
      }
      case "run": {
        const r = record.projection;
        await this.scope({
          kind: r.childRunId ? "child" : "run",
          id: r.childRunId ?? r.runId,
        });
        return;
      }
    }
    for (;;) {
      const options = refs.map(
        (r) => `${r.field} • ${r.recordId} v${r.version} • ${r.bytes} bytes`,
      );
      const selected = await this.ui.select(
        "Recorded fields • full arguments/results are in Retained content",
        [...options, "Retained content", "Return"],
      );
      if (selected === "Retained content")
        await this.pages("contents", scope, request.snapshotSeq);
      else if (selected && options.includes(selected))
        await this.detail(
          this.cursor(
            scope,
            request.snapshotSeq,
            refs[options.indexOf(selected)],
          ),
        );
      else return;
    }
  }
  async pages(
    reader: ReaderKind,
    scope: ListRequest["scope"],
    snapshotSeq: string | null = null,
    chooseTask = false,
  ): Promise<string | undefined> {
    let request: ListRequest = {
      reader,
      storeId: this.storeId,
      scope,
      snapshotSeq,
      after: null,
      limit: 50,
    };
    const previous: ListRequest[] = [];
    for (;;) {
      const page = value(await this.client[reader](request, this.ui.signal));
      this.ui.current();
      // A first data page can select the committed snapshot too. Pin its exact
      // request before inspecting a record or going Back; never repeat a null
      // seed and silently rebase an already displayed list.
      if (page.request.snapshotSeq !== null) request = page.request;
      const records = "kind" in page ? [] : page.records;
      const labels = records.map((r, i) => `${i + 1}. ${recordLabel(r)}`);
      const action = await this.ui.select(
        `${reader} • snapshot ${page.request.snapshotSeq ?? "selecting"} • ${"kind" in page ? page.kind : "retained page"} • coverage ${pretty(page.coverage)}`,
        [
          ...labels,
          ...(page.next ? ["Next page / proof"] : []),
          ...(previous.length ? ["Previous page"] : []),
          "Return",
        ],
      );
      if (action === "Next page / proof" && page.next) {
        if (request.snapshotSeq !== null) previous.push(request);
        request = page.next;
      } else if (action === "Previous page")
        request = previous.pop() ?? request;
      else if (action && labels.includes(action)) {
        const record = records[labels.indexOf(action)];
        if (chooseTask && record.kind === "task") return record.owner.taskId;
        await this.record(record, page.request);
      } else return;
    }
  }
  async search(scope: Scope, snapshotSeq: string): Promise<void> {
    const query = await this.ui.input(
      "Literal case-sensitive search (1–1024 UTF-8 bytes)",
    );
    if (!query) return;
    let cursor: ReadCursor = {
      storeId: this.storeId,
      scope,
      snapshotSeq,
      query,
      recordId: null,
      recordVersion: null,
      field: null,
      offset: 0,
    };
    const previous: ReadCursor[] = [];
    for (;;) {
      const page = value(await this.client.search(cursor, this.ui.signal));
      this.ui.current();
      const labels = page.hits.map(
        (hit, i) =>
          `${i + 1}. ${hit.content.recordId} v${hit.content.version} ${hit.content.field} bytes ${hit.range.start}–${hit.range.end} • ${diagnosticText(hit.preview, 160)}`,
      );
      const selected = await this.ui.select(
        `Search ${JSON.stringify(query)} • ${page.next ? "more retained ranges remain (zero hits is not completion)" : "retained scan ended"} • ${pretty(page.coverage)}`,
        [
          ...labels,
          ...(page.next ? ["Next search page / proof"] : []),
          ...(previous.length ? ["Previous search page"] : []),
          "Return",
        ],
      );
      if (selected === "Next search page / proof" && page.next) {
        previous.push(cursor);
        cursor = page.next;
      } else if (selected === "Previous search page")
        cursor = previous.pop() ?? cursor;
      else if (selected && labels.includes(selected)) {
        const hit = page.hits[labels.indexOf(selected)];
        await this.ui.show(
          `Exact hit (UTF-8 range, not character indexes)\n${pretty(hit)}`,
        );
        await this.detail(hit.cursor);
      } else return;
    }
  }
  async export(scope: Scope, snapshotSeq: string): Promise<void> {
    const format = await this.ui.select(
      "Full retained export • credentials/private auth are excluded",
      ["ndjson", "markdown"],
    );
    if (format !== "ndjson" && format !== "markdown") return;
    const destination = await this.ui.input(
      "Absolute NEW export file path (no overwrite; partial files preserved)",
    );
    if (!destination) return;
    if (
      !(await this.ui.confirm(
        "Write full verified export?",
        `${JSON.stringify(destination)}\n${pretty(scope)} at ${snapshotSeq}\nInterrupted or incomplete output is not a complete archive.`,
      ))
    )
      return;
    const request: ExportRequest = {
      storeId: this.storeId,
      scope,
      snapshotSeq,
      format,
    };
    try {
      const result = await exportNative(
        this.client,
        request,
        destination,
        this.ui.signal,
      );
      this.ui.current();
      this.ui.notify(
        `Export ${result}: count/digest/trailer/EOF verified; ${JSON.stringify(destination)}. Coverage is independent of original-source completeness.`,
      );
    } catch {
      this.ui.notify(
        `Export unverified/incomplete or destination refused: ${JSON.stringify(destination)}. Any partial file is preserved; no overwrite or cleanup.`,
      );
    }
  }
  async scope(scope: Scope): Promise<void> {
    for (;;) {
      const snapshot: Snapshot = value(
        await this.client.snapshot(scope, this.ui.signal),
      );
      this.ui.current();
      const selected = await this.ui.select(
        `${scope.kind} ${scope.id} • committed ${snapshot.committedSeq} (observation only)`,
        [
          "Status / graph",
          "Runs / children",
          "Messages",
          "Tools",
          "Retained content",
          "Timeline",
          "Checks history",
          "Changes history",
          "Human review history",
          "Search",
          "Export",
          "Return",
        ],
      );
      if (selected === "Status / graph") {
        await this.ui.show(pretty(snapshot));
        for (const r of snapshot.runs) {
          if (
            !r.childRunId &&
            r.admission.graph &&
            (await this.ui.confirm("Read recorded graph?", r.runId))
          ) {
            const graph = await this.graph({
              storeId: this.storeId,
              scope,
              snapshotSeq: snapshot.committedSeq,
              graph: r.admission.graph,
            });
            if (graph) await this.ui.show(pretty(graph));
          }
        }
      } else if (selected === "Search")
        await this.search(scope, snapshot.committedSeq);
      else if (selected === "Export")
        await this.export(scope, snapshot.committedSeq);
      else {
        const readers: Record<string, ReaderKind> = {
          "Runs / children": "runs",
          Messages: "messages",
          Tools: "tools",
          "Retained content": "contents",
          Timeline: "events",
          "Checks history": "checks",
          "Changes history": "changes",
          "Human review history": "reviews",
        };
        if (!selected || !readers[selected]) return;
        await this.pages(readers[selected], scope, snapshot.committedSeq);
      }
    }
  }
}
export function recordLabel(r: HistoryRecord): string {
  switch (r.kind) {
    case "task":
      return `${r.owner.taskId} • ${diagnosticText(r.goal, 160)}`;
    case "run":
      return `${r.projection.childRunId ?? r.projection.runId} • ${r.projection.assignmentId ?? "parent"} • ${r.projection.lifecycle} / ${r.projection.outcome ?? "unsettled"}`;
    case "message":
      return `${r.owner.entity.id} • ${r.role} • ${r.state}`;
    case "tool":
      return `${r.owner.entity.id} • ${diagnosticText(r.name)} • SDK error ${r.result?.isError ?? "unavailable"} (not a parent check)`;
    case "content":
      return `${r.content.recordId} v${r.content.version} • ${r.content.field} • ${r.content.bytes} retained bytes`;
    case "omitted":
      return `${r.owner.entity.id} • omitted`;
    case "owner-fact":
      return `seq ${r.committedSeq} • observed ${r.observedMs}ms • ${r.fact.kind}`;
    case "capture-fact":
      return `seq ${r.committedSeq} • ${r.capture.event.kind} • child ${r.link.childRunId}`;
  }
}
