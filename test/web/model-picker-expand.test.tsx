// Controlled state transitions for inline model card expansion and single-shot
// model + thinking submission.
import { isValidElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ModelCandidate,
  ModelCatalog,
  ModelChoiceState,
  ModelSelector,
  Reply,
} from "../../src/service-contract.ts";
import type {
  ModelAvailability,
  ModelCatalogRead,
} from "../../web/src/client/use-model-catalog";
import { ModelPicker } from "../../web/src/components/actions/ModelPicker";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as { value: unknown; deps?: readonly unknown[] }[],
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const changed = (old?: readonly unknown[], next?: readonly unknown[]) =>
    !old ||
    !next ||
    old.length !== next.length ||
    next.some((v, i) => !Object.is(v, old[i]));
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.cells[index];
    if (!previous || changed(previous.deps, deps))
      hooks.cells[index] = { value: factory(), deps };
    return hooks.cells[index].value;
  };
  return {
    ...actual,
    useContext: () => ({
      locale: "en" as const,
      t: (key: string, vars?: Record<string, string | number>) =>
        vars
          ? key.replace(/\{(\w+)\}/g, (m, k: string) =>
              Object.hasOwn(vars, k) ? String(vars[k]) : m,
            )
          : key,
      tx: (text: string) => text,
      setLocale() {},
    }),
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.cells[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        hooks.cells[index].value,
        (update: unknown) => {
          hooks.cells[index].value =
            typeof update === "function"
              ? update(hooks.cells[index].value)
              : update;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.cells[index] ??= { value: { current: initial } };
      return hooks.cells[index].value;
    },
    useMemo: memo,
    useCallback: (fn: unknown, deps: readonly unknown[]) =>
      memo(() => fn, deps),
    useEffect: () => {},
  };
});

afterEach(() => {
  hooks.cursor = 0;
  hooks.cells = [];
});

const ready: ModelAvailability = {
  status: "ready",
  epoch: "epoch",
  attachmentVersion: 1,
};
const candidate = (
  provider: string,
  model: string,
  levels: ModelCandidate["thinking"][number]["level"][],
): ModelCandidate => ({
  provider,
  model,
  api: "openai-completions",
  thinking: levels.map((level) => ({ level, selectable: true })),
  eligibility: "candidate",
});
const multiCatalog = (): ModelCatalog => ({
  entries: [
    candidate("abel", "LocalModel", ["off"]),
    candidate("codex", "gpt-6.2-astra", [
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  ],
  status: "complete",
  withheld: 0,
  selected: {
    sourceSelectionId: "src-local",
    provider: "abel",
    model: "LocalModel",
    api: "openai-completions",
    thinking: "off",
  },
  remembered: null,
  version: {
    epoch: "epoch",
    accessGeneration: 1,
    configRev: 1,
    catalogId: "catalog",
  },
});

interface ButtonHit {
  role?: string;
  title?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  onClick?: () => void;
}
function collectButtons(node: ReactNode, out: ButtonHit[] = []): ButtonHit[] {
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, out);
  } else if (
    isValidElement<{
      role?: string;
      title?: string;
      "aria-label"?: string;
      "aria-pressed"?: boolean;
      onClick?: () => void;
      children?: ReactNode;
    }>(node)
  ) {
    if (node.type === "button") {
      out.push({
        role: node.props.role,
        title: node.props.title,
        ariaLabel: node.props["aria-label"],
        ariaPressed: node.props["aria-pressed"],
        onClick: node.props.onClick,
      });
    }
    collectButtons(node.props.children, out);
  }
  return out;
}

function render(props: Parameters<typeof ModelPicker>[0]) {
  hooks.cursor = 0;
  return ModelPicker(props);
}

it("expands a multi-thinking model inline on first click and commits model + chosen thinking in one call", async () => {
  const cat = multiCatalog();
  const chooseModel = vi.fn(
    async (request: {
      choice: ModelSelector;
    }): Promise<Reply<ModelChoiceState>> => ({
      kind: "ok",
      value: {
        version: cat.version,
        selected: {
          sourceSelectionId: "src-astra",
          ...request.choice,
        },
      },
    }),
  );
  const observation: ModelCatalogRead = {
    catalog: cat,
    loading: false,
    isCurrent: () => true,
    reread: vi.fn(),
    accept: vi.fn(() => true),
  };
  const onOpenChange = vi.fn();
  const onChanged = vi.fn();
  const onChosen = vi.fn();
  const baseProps = {
    client: { chooseModel },
    availability: ready,
    read: observation,
    locked: false,
    open: true,
    onOpenChange,
    onChanged,
    onChosen,
  };

  // Initial render: LocalModel (single level) is current, so no thinking chips render.
  const first = collectButtons(render(baseProps));
  expect(
    first.filter((b) => b.ariaLabel?.startsWith("Thinking level:")),
  ).toHaveLength(0);
  const astra = first.find(
    (b) => b.role === "option" && b.title?.includes("gpt-6.2-astra"),
  );
  expect(astra?.onClick).toBeTypeOf("function");

  // First click on gpt-6.2-astra expands its inline thinking row without mutating or closing.
  astra?.onClick?.();
  expect(chooseModel).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();

  // Re-render shows gpt-6.2-astra's thinking chips (none pressed since LocalModel is still active).
  const expanded = collectButtons(render(baseProps));
  const chips = expanded.filter((b) =>
    b.ariaLabel?.startsWith("Thinking level:"),
  );
  expect(chips).toHaveLength(5);
  expect(chips.every((b) => b.ariaPressed === false)).toBe(true);

  // Clicking Extra high submits gpt-6.2-astra + xhigh in one request and closes.
  const xhigh = chips.find((b) => b.ariaLabel === "Thinking level: Extra high");
  expect(xhigh?.onClick).toBeTypeOf("function");
  xhigh?.onClick?.();
  await Promise.resolve();
  await Promise.resolve();

  expect(chooseModel).toHaveBeenCalledOnce();
  expect(chooseModel).toHaveBeenCalledWith({
    expected: cat.version,
    choice: {
      provider: "codex",
      model: "gpt-6.2-astra",
      api: "openai-completions",
      thinking: "xhigh",
    },
  });
  expect(onChanged).toHaveBeenCalledOnce();
  expect(onChanged).toHaveBeenCalledWith(cat.version);
  expect(onChosen).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false, "chosen");
});

it("commits an already-expanded candidate with its nearest thinking level on a second click, and commits single-level models in one click", () => {
  const { version: _v, selected: _s, ...preview } = multiCatalog();
  const observation: ModelCatalogRead = {
    preview,
    loading: false,
    isCurrent: () => true,
    reread: vi.fn(),
    accept: vi.fn(() => false),
  };
  const onPreviewChoice = vi.fn();
  const onOpenChange = vi.fn();
  const baseProps = {
    availability: { status: "stopped" as const },
    read: observation,
    draftModel: {
      provider: "abel",
      model: "LocalModel",
      api: "openai-completions" as const,
      thinking: "off" as const,
    },
    onPreviewChoice,
    locked: false,
    open: true,
    onOpenChange,
    onChanged: vi.fn(),
  };

  // First click expands gpt-6.2-astra; second click on its option row commits nearest level ("off").
  const astra1 = collectButtons(render(baseProps)).find(
    (b) => b.role === "option" && b.title?.includes("gpt-6.2-astra"),
  );
  astra1?.onClick?.();
  expect(onPreviewChoice).not.toHaveBeenCalled();

  const astra2 = collectButtons(render(baseProps)).find(
    (b) => b.role === "option" && b.title?.includes("gpt-6.2-astra"),
  );
  astra2?.onClick?.();
  expect(onPreviewChoice).toHaveBeenCalledOnce();
  expect(onPreviewChoice).toHaveBeenCalledWith({
    provider: "codex",
    model: "gpt-6.2-astra",
    api: "openai-completions",
    thinking: "off",
  });
  expect(onOpenChange).toHaveBeenCalledWith(false, "chosen");

  // Starting from multi-thinking gpt-6.2-astra, clicking single-level LocalModel commits immediately.
  onPreviewChoice.mockClear();
  onOpenChange.mockClear();
  const local = collectButtons(
    render({
      ...baseProps,
      draftModel: {
        provider: "codex",
        model: "gpt-6.2-astra",
        api: "openai-completions",
        thinking: "xhigh",
      },
    }),
  ).find((b) => b.role === "option" && b.title?.includes("LocalModel"));
  local?.onClick?.();
  expect(onPreviewChoice).toHaveBeenCalledOnce();
  expect(onPreviewChoice).toHaveBeenCalledWith({
    provider: "abel",
    model: "LocalModel",
    api: "openai-completions",
    thinking: "off",
  });
  expect(onOpenChange).toHaveBeenCalledWith(false, "chosen");
});
