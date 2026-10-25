// Pure locale catalog/selection and SSR. The built-browser switch is in assets-browser.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import type { HistoryRecord } from "../../src/service-contract.ts";
import { ReceiptPanel } from "../../web/src/components/actions/ReceiptPanel";
import { Coverage } from "../../web/src/components/history/Coverage";
import {
  LOCALE_STORAGE_KEY,
  LocaleProvider,
  preferredLocale,
  translate,
} from "../../web/src/i18n/locale";
import { zh } from "../../web/src/i18n/zh";
import { timelineBridge } from "../../web/src/timeline/timeline-adapter";
import type { TimelineData } from "../../web/src/timeline/timeline-client.mjs";
import { coverage, id, receipt, transport } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
const marks = (text: string) => [...text.matchAll(/\{\w+\}/g)].sort().join();
it("every Chinese entry keeps exactly its English key's interpolation marks", () => {
  for (const [key, value] of Object.entries(zh)) {
    expect(value.trim(), key).not.toBe("");
    expect(marks(value), key).toBe(marks(key));
  }
});
it("English is the source text; unknown text and codes pass through unchanged", () => {
  expect(translate("en", "Tasks")).toBe("Tasks");
  expect(translate("zh", "Tasks")).toBe("任务");
  expect(translate("zh", "{count} active runs", { count: 2 })).toBe(
    "2 个活动运行",
  );
  expect(translate("en", "{count} active runs", { count: 2 })).toBe(
    "2 active runs",
  );
  expect(translate("zh", "receipt-inconclusive")).toBe("receipt-inconclusive");
  expect(translate("zh", "constructor")).toBe("constructor");
  expect(translate("zh", "Preflight refused: {code}", {})).toBe(
    "预检被拒绝：{code}",
  );
});
it("a saved explicit choice wins over the browser's first preferred language", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
  });
  vi.stubGlobal("navigator", { languages: ["zh-CN", "en-US"] });
  expect(preferredLocale()).toBe("zh");
  vi.stubGlobal("navigator", { languages: ["en-US", "zh-CN"] });
  expect(preferredLocale()).toBe("en");
  storage.set(LOCALE_STORAGE_KEY, "zh");
  expect(preferredLocale()).toBe("zh");
  storage.set(LOCALE_STORAGE_KEY, "fr");
  expect(preferredLocale()).toBe("en");
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
  });
  vi.stubGlobal("navigator", { language: "zh-TW" });
  expect(preferredLocale()).toBe("zh");
});
it("components default to English and render Chinese only under a Chinese provider", () => {
  const client = new ServiceClient(transport());
  const panel = (
    <>
      <ReceiptPanel
        client={client}
        value={{ commandId: id(), receipt: receipt() }}
        onChange={() => {}}
      />
      <Coverage value={{ ...coverage, source: "limited" }} />
    </>
  );
  const english = renderToStaticMarkup(panel);
  expect(english).toContain("Command receipt");
  expect(english).toContain("not settled");
  expect(english).toContain("source: limited");
  const chinese = renderToStaticMarkup(
    <LocaleProvider initial="zh">{panel}</LocaleProvider>,
  );
  expect(chinese).toContain("命令回执");
  expect(chinese).toContain("未结束");
  expect(chinese).toContain("已接受");
  expect(chinese).toContain("来源：受限");
  expect(chinese).not.toContain("Command receipt");
});
it("the timeline bridge carries the chosen language and its own labels", () => {
  const scope = id();
  const records: HistoryRecord[] = [
    {
      kind: "capture-fact",
      recordId: id(),
      committedSeq: "1",
      link: { epoch: id(), taskId: scope, runId: id(), childRunId: id() },
      capture: {
        source: { first: 1, last: 1, firstObservedMs: 9, lastObservedMs: 9 },
        event: { kind: "ready", requestProtocol: 2 },
      },
    },
  ];
  const bridge = timelineBridge(
    scope,
    records,
    () => {},
    () => {},
    "zh",
  );
  expect(bridge.lang).toBe("zh");
  const received: TimelineData[] = [];
  bridge.onData((value) => received.push(value));
  bridge.readSegments(scope);
  const value = received.find((data) => data.kind === "segs");
  if (value?.kind !== "segs") throw new Error("missing-segments");
  expect(value.segs[0].status).toBe("已记录事实");
  expect(value.segs[0].clock).toContain("9–9 毫秒");
  expect(value.segs[0].title).toBe("#1 ready");
  expect(
    timelineBridge(
      scope,
      records,
      () => {},
      () => {},
    ).lang,
  ).toBe("en");
});
