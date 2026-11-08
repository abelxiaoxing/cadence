import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type {
  ModelCandidate,
  ModelCatalog,
  ModelChoiceState,
  Reply,
} from "../../src/service-contract.ts";
import type {
  ModelAvailability,
  ModelCatalogRead,
} from "../../web/src/client/use-model-catalog";
import {
  ModelPicker,
  nearestLevel,
} from "../../web/src/components/actions/ModelPicker";
import {
  describeError,
  LocaleProvider,
  translate,
} from "../../web/src/i18n/locale";

const ready = {
  status: "ready",
  epoch: "epoch",
  attachmentVersion: 1,
} as const;
const entry = (levels: ModelCandidate["thinking"][number]["level"][]) =>
  ({
    provider: "local",
    model: "m",
    api: "openai-completions",
    thinking: levels.map((level) => ({ level, selectable: true })),
    eligibility: "candidate",
  }) satisfies ModelCandidate;
const catalog = (): ModelCatalog => ({
  entries: [entry(["off", "low", "high"])],
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
});
function read(
  value?: ModelCatalog,
  extra: Partial<ModelCatalogRead> = {},
): ModelCatalogRead {
  return {
    catalog: value,
    loading: !value,
    isCurrent: () => true,
    reread: vi.fn(),
    accept: vi.fn(() => true),
    ...extra,
  };
}
function picker(
  availability: ModelAvailability,
  observation: ModelCatalogRead,
  props: Partial<Parameters<typeof ModelPicker>[0]> = {},
  locale: "en" | "zh" = "en",
) {
  return renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <ModelPicker
        client={{ chooseModel: vi.fn() }}
        availability={availability}
        read={observation}
        locked={false}
        open
        onOpenChange={() => {}}
        onChanged={() => {}}
        {...props}
      />
    </LocaleProvider>,
  );
}

it("keeps the current thinking level when offered, otherwise the nearest (lower on a tie)", () => {
  expect(nearestLevel(entry(["off", "low", "high"]), "low")).toBe("low");
  expect(nearestLevel(entry(["off", "low", "high"]), "medium")).toBe("low");
  expect(nearestLevel(entry(["off"]), "high")).toBe("off");
  expect(nearestLevel(entry(["max"]), "off")).toBe("max");
  expect(nearestLevel(entry(["off", "xhigh"]), "high")).toBe("xhigh");
  const partial = {
    ...entry(["off", "medium"]),
    thinking: [
      { level: "off", selectable: true },
      { level: "medium", selectable: false },
    ],
  } satisfies ModelCandidate;
  expect(nearestLevel(partial, "medium")).toBe("off");
});
it("renders one closed model button, no native select, and a neutral loading state", () => {
  const client = { chooseModel: vi.fn() };
  const html = picker(ready, read(), { client, open: false });
  expect(html).toContain('aria-label="Model: Reading models…"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<select");
  expect(html).not.toContain('role="dialog"');
  expect(client.chooseModel).not.toHaveBeenCalled();
  const open = picker(
    ready,
    read(),
    { locked: true, awaitingSend: true },
    "zh",
  );
  expect(open).toContain('role="dialog"');
  expect(open).toContain("选择模型后会立即发送你的消息。");
  expect(open).toContain("搜索模型");
  expect(open).toContain("正在读取模型…");
  expect(open).toContain("当前回复结束后才能切换模型。");
  expect(open).not.toMatch(/所有者|显式/);
});
it("a bare public error code keeps its untranslated code without claiming a completed read", () => {
  const t = (key: string, vars?: Record<string, string>) =>
    translate("zh", key, vars);
  expect(describeError(t as never, "unavailable")).toBe(
    "服务暂时不可用（unavailable）。",
  );
  expect(describeError(t as never, "stale")).toContain("（stale）");
  expect(describeError(t as never, "corrupt-selected")).toBe(
    "所选文件被拒绝（corrupt-selected），未做任何修改。运行 cadence doctor 查看是哪个文件和字段。",
  );
  expect(describeError(t as never, "Send refused: stale")).toBe(
    "Send refused: stale",
  );
  expect(describeError(t as never, "constructor")).toBe("constructor");
});
it.each(["stopped", "not-started"] as const)(
  "%s shows selectable preview models, search and thinking without a service-start notice",
  (status) => {
    for (const locale of ["en", "zh"] as const) {
      const { version: _version, selected: _selected, ...preview } = catalog();
      const observation = read(undefined, { preview, loading: false });
      const client = { chooseModel: vi.fn() };
      const html = picker(
        { status },
        observation,
        { client, onPreviewChoice: vi.fn() },
        locale,
      );
      expect(html).toContain('role="option"');
      expect(html).toContain("model-search");
      expect(html).toContain("model-thinking");
      expect(html).toContain(
        locale === "zh" ? "刷新模型列表" : "Refresh models",
      );
      expect(html).toContain(
        locale === "zh"
          ? "现在选择模型，发送时验证可用性。"
          : "Choose now; the model is verified when you send.",
      );
      expect(html).not.toMatch(/尚未启动|does not start|role="alert"/);
      expect(client.chooseModel).not.toHaveBeenCalled();
      expect(observation.reread).not.toHaveBeenCalled();
    }
  },
);
it("an unverified saved preference is labelled last-used, never installed or guaranteed usable", () => {
  const html = picker({ status: "stopped" }, read(), {
    lastModel: catalog().remembered,
  });
  expect(html).toContain("Last used: m · Low");
  expect(html).toContain("availability is checked when you send");
  expect(html).not.toContain("Used when you send");
  expect(html).not.toContain("model-option-check");
});
it.each([
  ["preparing", "Preparing execution…"],
  ["connecting", "Checking execution state…"],
  ["unavailable", "Execution state unavailable"],
  ["incompatible", "Model selection needs a compatible connection"],
] as const)(
  "%s explains the execution state instead of a model catalog error",
  (status, message) => {
    const html = picker(
      { status },
      read(undefined, { error: "stale", loading: false }),
    );
    expect(html).toContain(message);
    expect(html).not.toContain("The model list could not be read");
    expect(html).not.toContain('role="option"');
  },
);
it("only a failed live catalog read offers a retry; loading is neither failure nor no configured models", () => {
  const failed = picker(
    ready,
    read(undefined, { error: "unavailable", loading: false }),
  );
  expect(failed).toContain("Model list unavailable");
  expect(failed).toContain("The model list could not be read (unavailable).");
  expect(failed).toContain("Read again");
  expect(failed).not.toContain("No models are configured");
  const loading = picker(ready, read());
  expect(loading).toContain("Reading models…");
  expect(loading).not.toContain("Read again");
  expect(loading).not.toContain("No models are configured");
  const empty = picker(
    ready,
    read({ ...catalog(), entries: [], remembered: null }),
  );
  expect(empty).toContain("Choose a model");
  expect(empty).toContain("No models are configured");
});
it("model scope names future messages in this conversation, not every project conversation", () => {
  const html = picker(ready, read(catalog()));
  expect(html).toContain(
    "This model is used for future messages in this conversation.",
  );
  expect(html).toContain("Work already started keeps its original model.");
  expect(html).not.toContain("Every conversation in this project");
});
it.each(["live-reply", "read-error", "obsolete", "loading", "ready"])(
  "%s: inspecting a catalog never unlocks invalid model or thinking choices",
  (status) => {
    const html = picker(
      ready,
      read(catalog(), {
        loading: status === "loading",
        error: status === "read-error" ? "stale" : undefined,
        isCurrent: () => status !== "obsolete",
      }),
      { locked: status === "live-reply" },
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

// Invoke the real option callback captured during SSR. This exercises async
// callback fencing, not DOM mounting, event delivery or a real model mutation.
function optionCallback(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const callback = optionCallback(child);
      if (callback) return callback;
    }
  } else if (
    isValidElement<{
      role?: string;
      onClick?: () => void;
      children?: ReactNode;
    }>(node)
  ) {
    if (node.props.role === "option") return node.props.onClick;
    return optionCallback(node.props.children);
  }
}
it.each(["before-click", "during-choice", "current"])(
  "%s: an obsolete catalog cannot choose or resume a waiting Send",
  async (phase) => {
    let current = true;
    let resolve: (reply: Reply<ModelChoiceState>) => void = () => {
      throw new Error("choice not dispatched");
    };
    const client = {
      chooseModel: vi.fn(
        () =>
          new Promise<Reply<ModelChoiceState>>((done) => {
            resolve = done;
          }),
      ),
    };
    const observation = read(catalog(), { isCurrent: () => current });
    const onChosen = vi.fn(),
      onChanged = vi.fn(),
      onOpenChange = vi.fn();
    let callback: (() => void) | undefined;
    function Probe() {
      const tree = ModelPicker({
        client,
        read: observation,
        availability: ready,
        locked: false,
        open: true,
        awaitingSend: true,
        onChosen,
        onChanged,
        onOpenChange,
      });
      callback = optionCallback(tree);
      return tree;
    }
    renderToStaticMarkup(<Probe />);
    expect(callback).toBeTypeOf("function");
    if (phase === "before-click") current = false;
    callback?.();
    if (phase === "before-click")
      expect(client.chooseModel).not.toHaveBeenCalled();
    else {
      expect(client.chooseModel).toHaveBeenCalledOnce();
      if (phase === "during-choice") current = false;
      resolve({
        kind: "ok",
        value: {
          version: catalog().version,
          selected: {
            sourceSelectionId: "source",
            provider: "local",
            model: "m",
            api: "openai-completions",
            thinking: "low",
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    }
    if (phase === "current") {
      expect(observation.accept).toHaveBeenCalledOnce();
      expect(onChosen).toHaveBeenCalledOnce();
      expect(onChanged).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false, "chosen");
    } else {
      expect(observation.accept).not.toHaveBeenCalled();
      expect(onChosen).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    }
  },
);
it.each([false, true])(
  "preview clicks only change the draft and close the panel (obsolete=%s)",
  (obsolete) => {
    const { version: _version, selected: _selected, ...preview } = catalog();
    let current = true;
    const observation = read(undefined, {
      preview,
      loading: false,
      isCurrent: () => current,
    });
    const client = { chooseModel: vi.fn() },
      onPreviewChoice = vi.fn(),
      onChosen = vi.fn(),
      onChanged = vi.fn(),
      onOpenChange = vi.fn();
    let click: (() => void) | undefined;
    function Probe() {
      const tree = ModelPicker({
        client,
        availability: { status: "stopped" },
        read: observation,
        locked: false,
        open: true,
        onPreviewChoice,
        onChosen,
        onChanged,
        onOpenChange,
      });
      click = optionCallback(tree);
      return tree;
    }
    renderToStaticMarkup(<Probe />);
    current = !obsolete;
    click?.();
    expect(client.chooseModel).not.toHaveBeenCalled();
    expect(onChosen).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(observation.accept).not.toHaveBeenCalled();
    if (obsolete) expect(onPreviewChoice).not.toHaveBeenCalled();
    else {
      expect(onPreviewChoice).toHaveBeenCalledWith(catalog().remembered);
      expect(onOpenChange).toHaveBeenCalledWith(false, "chosen");
    }
  },
);
it("a conversation's retained choice precedes the account default in a cold preview", () => {
  const { version: _version, selected: _selected, ...preview } = catalog();
  preview.entries.push({ ...preview.entries[0], model: "conversation-model" });
  const html = picker(
    { status: "stopped" },
    read(undefined, { preview, loading: false }),
    {
      lastModel: {
        provider: "local",
        model: "conversation-model",
        api: "openai-completions",
        thinking: "low",
      },
      onPreviewChoice: vi.fn(),
    },
  );
  expect(html).toContain('aria-label="Model: conversation-model · Low"');
});
