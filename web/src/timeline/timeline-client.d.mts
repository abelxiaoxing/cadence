export interface TimelineSegment {
  key: string;
  lane: "input" | "model" | "tools";
  group: string;
  groupLabel: string;
  kind: string;
  title: string;
  summary: string;
  source: string;
  status: string;
  clock: string;
  t: number;
  end: number;
  dur?: number;
  meta?: { tool?: string; toolCallId?: string };
}
export interface TimelineScope {
  id: string;
  title: string;
  isStreaming: false;
  segCount: number;
}
export type TimelineData =
  | { kind: "state"; conversations: TimelineScope[]; activeId: string }
  | { kind: "segs"; convId: string; segs: TimelineSegment[]; reset: true }
  | {
      kind: "seg_detail";
      convId: string;
      key: string;
      detail: string;
      seg: TimelineSegment;
      analysis: { position: string };
    };
export interface TimelineReadBridge {
  lang: "en" | "zh";
  readState(): void;
  readSegments(id: string): void;
  readSegment(id: string, key: string): void;
  openDetail(id: string, key: string): void;
  searchHistory(): void;
  onData(receive: (data: TimelineData) => void): () => void;
}
declare const timeline: {
  mount(container: HTMLElement, ctx: TimelineReadBridge): () => void;
};
export default timeline;
