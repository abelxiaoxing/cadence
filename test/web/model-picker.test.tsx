import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ModelCandidate,
  ModelCatalog,
} from "../../src/service-contract.ts";
import {
  ModelPicker,
  nearestLevel,
} from "../../web/src/components/actions/ModelPicker";
import {
  describeError,
  LocaleProvider,
  translate,
} from "../../web/src/i18n/locale";

// Controlled SSR state, not a DOM interaction or owner capability test.
const modelState = vi.hoisted(() => ({
  catalog: undefined as ModelCatalog | undefined,
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      actual.useState(
        initial === undefined && modelState.catalog
          ? modelState.catalog
          : initial,
      ),
  };
});
afterEach(() => {
  modelState.catalog = undefined;
});

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
  // A project's refused Pi sources are not a workbench outage.
  expect(describeError(t as never, "corrupt-selected")).toBe(
    "所选文件被拒绝（corrupt-selected），未做任何修改。运行 cadence doctor 查看是哪个文件和字段。",
  );
  expect(describeError(t as never, "Send refused: stale")).toBe(
    "Send refused: stale",
  );
  expect(describeError(t as never, "constructor")).toBe("constructor");
});

it("an unavailable model selector still exposes its explanation, without granting a model choice", () => {
  const client = { models: vi.fn(), chooseModel: vi.fn() };
  const html = renderToStaticMarkup(
    <ModelPicker
      client={client as never}
      enabled={false}
      locked={false}
      refresh=""
      open
      onOpenChange={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(html).toContain(
    "Model selection is unavailable until the current conversation and execution state are observed.",
  );
  expect(html).not.toMatch(/class="model-trigger[^"]*"[^>]*disabled/);
  expect(client.models).not.toHaveBeenCalled();
  expect(client.chooseModel).not.toHaveBeenCalled();
});
it("model scope names future messages in this conversation, not every project conversation", () => {
  const html = renderToStaticMarkup(
    <ModelPicker
      client={{ models: vi.fn(), chooseModel: vi.fn() }}
      enabled
      locked={false}
      refresh=""
      open
      onOpenChange={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(html).toContain(
    "This model is used for future messages in this conversation.",
  );
  expect(html).toContain("Work already started keeps its original model.");
  expect(html).not.toContain("Every conversation in this project");
});

it.each(["unavailable", "live-reply", "ready"])(
  "%s: inspecting a retained catalog does not unlock model or thinking choices",
  (status) => {
    const candidate = entry(["off", "low", "high"]);
    modelState.catalog = {
      entries: [candidate],
      status: "complete",
      withheld: 0,
      selected: null,
      remembered: {
        provider: "local",
        model: "m",
        api: "openai-completions",
        thinking: "low",
      },
      version: {
        epoch: "epoch",
        accessGeneration: 1,
        configRev: 1,
        catalogId: "catalog",
      },
    };
    const html = renderToStaticMarkup(
      <ModelPicker
        client={{ models: vi.fn(), chooseModel: vi.fn() }}
        enabled={status !== "unavailable"}
        locked={status === "live-reply"}
        refresh=""
        open
        onOpenChange={() => {}}
        onChanged={() => {}}
      />,
    );
    const buttons = [
      ...html.matchAll(
        /<button[^>]*(?:role="option"|aria-label="Thinking level:)[^>]*>/g,
      ),
    ].map((match) => match[0]);
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(
      status !== "ready",
    );
  },
);
