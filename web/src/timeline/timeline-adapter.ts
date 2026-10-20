/** Cadence bridge for the adapted standalone client. Readonly, no plugin dispatcher. */
import type { HistoryRecord } from "../types";
import type {
  TimelineData,
  TimelineReadBridge,
  TimelineSegment,
} from "./timeline-client.mjs";

type FactRecord = Extract<
  HistoryRecord,
  { kind: "owner-fact" | "capture-fact" }
>;
export function timelineBridge(
  scopeId: string,
  records: HistoryRecord[],
  open: (record: FactRecord) => void,
  search: () => void,
): TimelineReadBridge {
  const facts = records.filter(
    (r): r is FactRecord =>
      r.kind === "owner-fact" || r.kind === "capture-fact",
  );
  const segments: TimelineSegment[] = facts.map((r, i) => {
    const kind = r.kind === "owner-fact" ? r.fact.kind : r.capture.event.kind;
    const child = r.kind === "capture-fact" ? r.link.childRunId : null;
    const lane = kind.startsWith("tool")
      ? "tools"
      : kind.startsWith("message")
        ? "model"
        : "input";
    return {
      key: r.recordId,
      lane,
      group: `${child ?? "owner"}:${lane}`,
      groupLabel: `${child ?? "Owner"} · ${lane}`,
      kind: lane === "tools" ? "tool" : lane === "model" ? "text" : "system",
      title: `#${r.committedSeq} ${kind}`,
      summary: kind,
      source: `Committed #${r.committedSeq}; ${child ?? "owner"}`,
      status: "recorded fact",
      clock:
        r.kind === "capture-fact"
          ? `Worker-local monotonic observations (${r.link.childRunId}): ${r.capture.source.firstObservedMs}–${r.capture.source.lastObservedMs} ms; not aligned to other workers.`
          : `Owner observation (${r.link.epoch}): ${r.observedMs} ms; clock origin not established by this reader.`,
      ...(r.kind === "owner-fact" && r.fact.kind === "check-settled"
        ? { dur: r.fact.native.durationMs }
        : {}),
      t: i * 1000,
      end: i * 1000,
    }; // display positions ONLY; no timestamp or duration claim
  });
  let receive: ((data: TimelineData) => void) | undefined;
  return {
    onData(fn) {
      receive = fn;
      return () => {
        receive = undefined;
      };
    },
    readState() {
      receive?.({
        kind: "state",
        conversations: [
          {
            id: scopeId,
            title: `${scopeId} — loaded committed page`,
            isStreaming: false,
            segCount: segments.length,
          },
        ],
        activeId: scopeId,
      });
    },
    readSegments(id) {
      if (id === scopeId)
        receive?.({ kind: "segs", convId: id, segs: segments, reset: true });
    },
    readSegment(id, key) {
      const index = segments.findIndex((s) => s.key === key);
      if (id !== scopeId || index < 0) return;
      receive?.({
        kind: "seg_detail",
        convId: id,
        key,
        seg: segments[index],
        detail: JSON.stringify(facts[index], null, 2),
        analysis: {
          position: `Committed sequence ${facts[index].committedSeq}; page ordinal ${index + 1}. Timing shown in raw facts only; clocks may not be comparable.`,
        },
      });
    },
    openDetail(id, key) {
      const record = facts.find((f) => f.recordId === key);
      if (id === scopeId && record) open(record);
    },
    searchHistory: search,
  };
}
