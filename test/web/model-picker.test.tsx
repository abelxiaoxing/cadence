import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ModelCandidate } from "../../src/service-contract.ts";
import {
  ModelPicker,
  nearestLevel,
} from "../../web/src/components/actions/ModelPicker";
import {
  describeError,
  LocaleProvider,
  translate,
} from "../../web/src/i18n/locale";

const entry = (levels: ModelCandidate["thinking"][number]["level"][]) =>
  ({
    provider: "local",
    model: "m",
    api: "openai-completions",
    thinking: levels.map((level) => ({ level, selectable: true })),
    eligibility: "candidate",
  }) satisfies ModelCandidate;

it("keeps the current thinking level when offered, otherwise the nearest (lower on a tie)", () => {
  expect(nearestLevel(entry(["off", "low", "high"]), "low")).toBe("low");
  expect(nearestLevel(entry(["off", "low", "high"]), "medium")).toBe("low");
  expect(nearestLevel(entry(["off"]), "high")).toBe("off");
  expect(nearestLevel(entry(["max"]), "off")).toBe("max");
  expect(nearestLevel(entry(["off", "xhigh"]), "high")).toBe("xhigh");
  // An unselectable level is never chosen.
  const partial = {
    ...entry(["off", "medium"]),
    thinking: [
      { level: "off", selectable: true },
      { level: "medium", selectable: false },
    ],
  } satisfies ModelCandidate;
  expect(nearestLevel(partial, "medium")).toBe("off");
});

it("renders one closed model button and no dialog or native select before it is opened", () => {
  const client = { models: vi.fn(), chooseModel: vi.fn() };
  const html = renderToStaticMarkup(
    <ModelPicker
      client={client as never}
      enabled
      locked={false}
      refresh=""
      open={false}
      onOpenChange={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Model: Model"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<select");
  expect(html).not.toContain('role="dialog"');
  expect(client.chooseModel).not.toHaveBeenCalled();
  const open = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <ModelPicker
        client={client as never}
        enabled
        locked
        refresh=""
        open
        awaitingSend
        onOpenChange={() => {}}
        onChanged={() => {}}
      />
    </LocaleProvider>,
  );
  expect(open).toContain('role="dialog"');
  expect(open).toContain("选择模型后会立即发送你的消息。");
  expect(open).toContain("搜索模型");
  expect(open).toContain("当前回复结束后才能切换模型。");
  expect(open).not.toMatch(/所有者|显式/);
});

it("a bare public error code reads as a sentence that keeps the untranslated code", () => {
  const t = (key: string, vars?: Record<string, string>) =>
    translate("zh", key, vars);
  expect(describeError(t as never, "unavailable")).toBe(
    "服务暂时不可用（unavailable）。",
  );
  expect(describeError(t as never, "stale")).toContain("（stale）");
  expect(describeError(t as never, "Send refused: stale")).toBe(
    "Send refused: stale",
  );
  expect(describeError(t as never, "constructor")).toBe("constructor");
});
