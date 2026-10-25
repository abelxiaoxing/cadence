/** Cadence bridge for the adapted standalone client. Readonly, no plugin dispatcher. */
import {
  type Locale,
  type MessageKey,
  translate,
  type Vars,
} from "../i18n/locale";
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
  lang: Locale = "en",
): TimelineReadBridge {
  const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
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
      groupLabel: `${child ?? t("Owner")} · ${translate(lang, lane)}`,
      kind: lane === "tools" ? "tool" : lane === "model" ? "text" : "system",
      title: `#${r.committedSeq} ${kind}`,
      summary: kind,
      source: t("Committed #{seq}; {who}", {
        seq: r.committedSeq,
        who: child ?? t("owner"),
      }),
      status: t("recorded fact"),
      clock:
        r.kind === "capture-fact"
          ? t(
              "Worker-local monotonic observations ({child}): {first}–{last} ms; not aligned to other workers.",
              {
                child: r.link.childRunId,
                first: r.capture.source.firstObservedMs,
                last: r.capture.source.lastObservedMs,
              },
            )
          : t(
              "Owner observation ({epoch}): {ms} ms; clock origin not established by this reader.",
              { epoch: r.link.epoch, ms: r.observedMs },
            ),
      ...(r.kind === "owner-fact" && r.fact.kind === "check-settled"
        ? { dur: r.fact.native.durationMs }
        : {}),
      t: i * 1000,
      end: i * 1000,
    }; // display positions ONLY; no timestamp or duration claim
  });
  let receive: ((data: TimelineData) => void) | undefined;
  return {
    lang,
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
            title: t("{scope} — loaded committed page", { scope: scopeId }),
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
          position: t(
            "Committed sequence {seq}; page ordinal {ordinal}. Timing shown in raw facts only; clocks may not be comparable.",
            { seq: facts[index].committedSeq, ordinal: index + 1 },
          ),
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
