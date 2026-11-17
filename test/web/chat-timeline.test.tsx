// Controlled hook lifetimes and deferred reads; not a mounted DOM or browser.
import {
  type ComponentProps,
  type EffectCallback,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  type ChatStep,
  type ChatTreeNode,
  type ChatTurn,
  decodeWorkbenchResult,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  ConversationReader,
  type LoadedTurn,
  type TurnSource,
} from "../../web/src/client/conversation-reader";
import { useConversation } from "../../web/src/client/use-conversation";
import { useWorkbench } from "../../web/src/client/use-workbench";
import { MarkdownBody } from "../../web/src/components/rich/Markdown";
import { StreamMarkdown } from "../../web/src/components/StreamMarkdown";
import { CollapsibleHead } from "../../web/src/components/transcript/CollapsibleHead";
import { LazyMount } from "../../web/src/components/transcript/LazyMount";
import { ChatComposer } from "../../web/src/components/workspace/ChatComposer";
import {
  StepText,
  ToolStep,
} from "../../web/src/components/workspace/ChatSteps";
import { ChatTurnView } from "../../web/src/components/workspace/ChatTurnView";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { QuestionRail } from "../../web/src/components/workspace/QuestionRail";
import { useStepDetail } from "../../web/src/components/workspace/turn-source";
import { WorkflowAgentView } from "../../web/src/components/workspace/WorkflowAgentView";
import { WorkflowLine } from "../../web/src/components/workspace/WorkflowPanel";
import {
  type IndependentCase,
  type IndependentCheckpoint,
  independentFixtureIds,
  independentRead,
  independentResults,
  independentScenarios,
  independentTimeline,
  type TimelineOrder,
} from "../helpers/runtime-timeline.ts";
import { transport } from "./fixtures";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as {
    value: unknown;
    deps?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: new Map<number, EffectCallback>(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const changed = (old?: readonly unknown[], next?: readonly unknown[]) =>
    !old ||
    !next ||
    old.length !== next.length ||
    next.some((v, i) => !Object.is(v, old[i]));
  const effect = (callback: EffectCallback, deps?: readonly unknown[]) => {
    const index = hooks.cursor++;
    const prior = hooks.cells[index];
    if (!prior || changed(prior.deps, deps)) {
      hooks.cells[index] = { value: undefined, deps, cleanup: prior?.cleanup };
      hooks.effects.set(index, callback);
    }
  };
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const index = hooks.cursor++;
    const prior = hooks.cells[index];
    if (!prior || changed(prior.deps, deps))
      hooks.cells[index] = { value: factory(), deps };
    return hooks.cells[index].value;
  };
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      hooks.cells[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      const cell = hooks.cells[index];
      return [
        cell.value,
        (update: unknown) => {
          cell.value =
            typeof update === "function" ? update(cell.value) : update;
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
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
// Only the workspace cases supply observations; the hook lifecycle cases below
// still use the real readers. No service/SDK implementation enters this fixture.
const workspace = vi.hoisted(() => ({
  conversation: undefined as ReturnType<typeof useConversation> | undefined,
  nodes: [] as ChatTreeNode[],
  runs: new Map<string, WorkflowRun>(),
  no: () => {},
  t: (key: string) => key,
}));
vi.mock("../../web/src/client/use-conversation", async (original) => {
  const actual =
    await original<typeof import("../../web/src/client/use-conversation")>();
  return {
    ...actual,
    useConversation: (...args: Parameters<typeof useConversation>) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: Each controlled test keeps one fixed observation source.
      workspace.conversation ?? actual.useConversation(...args),
  };
});
vi.mock("../../web/src/client/use-workbench", async (original) => {
  const actual =
    await original<typeof import("../../web/src/client/use-workbench")>();
  return {
    ...actual,
    useWorkbench: (...args: Parameters<typeof useWorkbench>) =>
      workspace.conversation
        ? {
            refresh: workspace.no,
            value:
              args[1]?.kind === "conversation-context"
                ? {
                    kind: "conversation-context",
                    context: {
                      id: "chat",
                      cwd: "/project",
                      revision: 0,
                      model: null,
                    },
                  }
                : {
                    kind: "cadence-conversation",
                    state: {
                      id: "chat",
                      enabled: false,
                      revision: 0,
                      runs: [],
                      head: null,
                      proposal: null,
                    },
                  },
          }
        : // biome-ignore lint/correctness/useHookAtTopLevel: Each controlled test keeps one fixed observation source.
          actual.useWorkbench(...args),
  };
});
vi.mock("../../web/src/client/conversation-tree", async (original) => ({
  ...(await original<
    typeof import("../../web/src/client/conversation-tree")
  >()),
  useConversationTree: () => ({
    tree: { nodes: workspace.nodes, truncated: false, leaf: "leaf" },
    current: true,
    refresh: workspace.no,
  }),
}));
vi.mock("../../web/src/client/use-model-catalog", () => ({
  useModelCatalog: () => ({ loading: false, reread: workspace.no }),
}));
vi.mock("../../web/src/components/workspace/AgentDock", () => ({
  useWorkflowRuns: () => ({ runs: workspace.runs, unreadable: new Set() }),
}));
vi.mock("../../web/src/components/workspace/ChatImages", () => ({
  useImageDraft: () => ({
    files: [],
    remove: workspace.no,
    add: workspace.no,
    replace: workspace.no,
    key: workspace.no,
  }),
}));
vi.mock("../../web/src/i18n/locale", async (original) => ({
  ...(await original<typeof import("../../web/src/i18n/locale")>()),
  useT: () => ({ t: workspace.t, tx: workspace.t, locale: "en" }),
}));
function render<T>(hook: () => T): T {
  hooks.cursor = 0;
  return hook();
}
function commit() {
  const effects = [...hooks.effects];
  hooks.effects.clear();
  for (const [index, effect] of effects) {
    hooks.cells[index].cleanup?.();
    const cleanup = effect();
    hooks.cells[index].cleanup =
      typeof cleanup === "function" ? cleanup : undefined;
  }
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
// A child gets its own hook cells, addressed by the ancestor/child keys the
// actual element tree supplies. This is not a React DOM reconciler.
const children = new Map<string, Pick<typeof hooks, "cells" | "effects">>();
function child<T>(key: string, body: () => T): T {
  const parent = {
    cells: hooks.cells,
    effects: hooks.effects,
    cursor: hooks.cursor,
  };
  const scope = children.get(key) ?? { cells: [], effects: new Map() };
  children.set(key, scope);
  Object.assign(hooks, scope);
  try {
    return render(body);
  } finally {
    Object.assign(hooks, parent);
  }
}
afterEach(() => {
  for (const scope of [hooks, ...children.values()])
    for (const cell of scope.cells) cell.cleanup?.();
  hooks.cells = [];
  hooks.cursor = 0;
  hooks.effects.clear();
  children.clear();
  workspace.conversation = undefined;
  workspace.nodes = [];
  workspace.runs = new Map();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const requests: {
    signal: AbortSignal;
    resolve(value: { text: string; args: string }): void;
  }[] = [];
  const detail = vi.fn(
    (_index: number, _parts: number, signal: AbortSignal) =>
      new Promise<{ text: string; args: string }>((resolve) => {
        requests.push({ signal, resolve });
      }),
  );
  const step: ChatStep = {
    id: "preview",
    renderId: "capture:m:2",
    version: "v1",
    state: "running",
    role: "tool",
    parts: 1,
    text: "",
    clipped: false,
    error: false,
    name: "bash",
    target: "",
  };
  const turn: TurnSource = {
    renderId: "command:user",
    header: {
      id: "turn",
      status: "running",
      steps: 1,
      stable: 0,
      entry: null,
      at: 0,
      notice: "",
      omitted: { thinking: false, other: false, media: false },
    },
    steps: [step],
    detail,
  };
  return { step, turn, requests, detail };
}

it("reads only opened details, refreshes equal-part revisions and every reply terminal transition", async () => {
  const { turn, step, requests, detail } = fixture();
  render(() => useStepDetail(turn, 0, step, false));
  commit();
  expect(detail).not.toHaveBeenCalled();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  requests[0].resolve({ text: "first", args: "{}" });
  await settle();
  expect(render(() => useStepDetail(turn, 0, step, true)).value?.text).toBe(
    "first",
  );
  const changed = { ...step, version: "v2" };
  // Pending update keeps the text already displayed, not a blank loading card.
  expect(render(() => useStepDetail(turn, 0, changed, true)).value?.text).toBe(
    "first",
  );
  commit();
  expect(detail).toHaveBeenCalledTimes(2);
  requests[1].resolve({ text: "changed, still one part", args: "{}" });
  await settle();
  expect(render(() => useStepDetail(turn, 0, changed, true)).value?.text).toBe(
    "changed, still one part",
  );
  let calls = 2;
  for (const status of [
    "completed",
    "failed",
    "canceled",
    "unknown",
  ] as const) {
    const final = { ...turn, header: { ...turn.header, status } };
    render(() => useStepDetail(final, 0, changed, true));
    commit();
    expect(detail).toHaveBeenCalledTimes(++calls);
    requests[calls - 1].resolve({ text: status, args: "{}" });
    await settle();
    expect(
      render(() => useStepDetail(final, 0, changed, true)).value?.text,
    ).toBe(status);
  }
  render(() => useStepDetail(turn, 0, changed, false));
  commit();
  expect(requests[calls - 1].signal.aborted).toBe(true);
  expect(detail).toHaveBeenCalledTimes(calls);
});

it("ignores late success before effect cleanup, after closing, on a newer revision and after navigation", async () => {
  const { turn, step, requests } = fixture();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  const next = { ...step, version: "v2" };
  render(() => useStepDetail(turn, 0, next, true));
  requests[0].resolve({ text: "obsolete revision", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(turn, 0, next, true)).value,
  ).toBeUndefined();
  commit();
  render(() => useStepDetail(turn, 0, next, false));
  requests[1].resolve({ text: "closed reply", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(turn, 0, next, false)).value,
  ).toBeUndefined();
  commit();
  render(() => useStepDetail(turn, 0, next, true));
  commit();
  const other = {
    ...turn,
    renderId: "another-session-user",
    header: { ...turn.header, id: "other" },
  };
  render(() => useStepDetail(other, 0, next, true));
  requests[2].resolve({ text: "wrong session", args: "" });
  await settle();
  expect(
    render(() => useStepDetail(other, 0, next, true)).value,
  ).toBeUndefined();
  commit();
  requests[3].resolve({ text: "current", args: "" });
  await settle();
  expect(render(() => useStepDetail(other, 0, next, true)).value?.text).toBe(
    "current",
  );
});

it("keeps a readable detail through coordinate/preview handoff and legacy history remains lazy", async () => {
  const { turn, step, requests } = fixture();
  render(() => useStepDetail(turn, 0, step, true));
  commit();
  requests[0].resolve({ text: "visible", args: "" });
  await settle();
  const durable = { ...turn, header: { ...turn.header, id: "pi-user" } };
  const moved = { ...step, id: "pi-entry:2" };
  expect(render(() => useStepDetail(durable, 3, moved, true)).value?.text).toBe(
    "visible",
  );
  commit();
  expect(requests).toHaveLength(2);
  const legacy = {
    ...moved,
    renderId: undefined,
    version: undefined,
    state: undefined,
  };
  expect(
    render(() => useStepDetail(durable, 3, legacy, false)).value,
  ).toBeUndefined();
  commit();
  expect(requests).toHaveLength(2);
});

it("workflow polling reads a final snapshot when the interval stops and retires a pending live read", async () => {
  vi.useFakeTimers();
  const requests: { signal?: AbortSignal; resolve(value: unknown): void }[] =
    [];
  const client = {
    workbenchRead: vi.fn(
      (_request: unknown, signal?: AbortSignal) =>
        new Promise((resolve) => {
          requests.push({ signal, resolve });
        }),
    ),
  } as unknown as Parameters<typeof useWorkbench>[0];
  const request = {
    kind: "workflow-detail" as const,
    id: crypto.randomUUID(),
    stepId: "step",
  };
  render(() => useWorkbench(client, null, 0));
  commit();
  expect(requests).toHaveLength(0);
  render(() => useWorkbench(client, request, 1000));
  commit();
  requests[0].resolve({ kind: "ok", value: { kind: "file", text: "partial" } });
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests).toHaveLength(2);
  render(() => useWorkbench(client, request, 0));
  commit();
  expect(requests[1].signal?.aborted).toBe(true);
  expect(requests).toHaveLength(3);
  requests[2].resolve({ kind: "ok", value: { kind: "file", text: "final" } });
  await settle();
  requests[1].resolve({
    kind: "ok",
    value: { kind: "file", text: "obsolete" },
  });
  await settle();
  expect(render(() => useWorkbench(client, request, 0)).value).toMatchObject({
    text: "final",
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(requests).toHaveLength(3);
});

it("conversation navigation hides the previous observation and its actions before effects run", async () => {
  vi.useFakeTimers();
  const client: Parameters<typeof useConversation>[0] = {
    workbenchRead: async () => ({
      kind: "ok",
      value: {
        kind: "conversation",
        summary: null,
        leaf: null,
        continues: true,
        turns: 0,
        branches: 0,
        runs: [],
        attempt: null,
      },
    }),
  };
  render(() => useConversation(client, "first", true));
  commit();
  render(() => useConversation(client, "first", true));
  commit();
  await vi.advanceTimersByTimeAsync(0);
  expect(
    render(() => useConversation(client, "first", true)).summary,
  ).toBeNull();
  const next = render(() => useConversation(client, "next", true));
  expect(next.summary).toBeUndefined();
  expect(next.turns).toEqual([]);
  next.choose("old-branch"); // No retired reader is exposed before initialization.
  commit();
  expect(render(() => useConversation(client, "next", true)).pinned).toBe(
    false,
  );
});

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing fixture element or callback");
  return value;
}
function elements<P = { children?: ReactNode }>(
  node: ReactNode,
  type: unknown,
): ReactElement<P>[] {
  if (Array.isArray(node))
    return node.flatMap((item) => elements<P>(item, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [
    ...(node.type === type ? [node as ReactElement<P>] : []),
    ...elements<P>(node.props.children, type),
  ];
}
// The real workflow component owns recordedTurn and the detail closure. Only
// transport replies and hook scheduling are controlled here; no backend import,
// persisted-file claim, or hand-written replacement detail function.
function workflowAgentFixture() {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const runId = crypto.randomUUID(),
    epoch = crypto.randomUUID();
  const childId = crypto.randomUUID(),
    callId = crypto.randomUUID();
  const requests: {
    client: number;
    read: WorkbenchRead;
    signal?: AbortSignal;
    replied: boolean;
    reply(value: WorkbenchResult): void;
  }[] = [];
  let clientSequence = 0;
  const makeClient = () => {
    const id = ++clientSequence;
    return new ServiceClient(
      transport({
        workbenchRead: (read, signal) =>
          new Promise((resolve) => {
            requests.push({
              client: id,
              read,
              signal,
              replied: false,
              reply(value) {
                expect(this.replied).toBe(false);
                this.replied = true;
                resolve({ kind: "ok", value });
              },
            });
          }),
      }),
    );
  };
  const props: ComponentProps<typeof WorkflowAgentView> = {
    client: makeClient(),
    agent: { runId, stepId: "agent", label: "fixture" },
    backLabel: "Back",
    onBack() {},
    onOpenAgent() {},
  };
  const run = (
    status: WorkflowRun["steps"][number]["status"] = "running",
  ): WorkbenchResult => ({
    kind: "workflow",
    commandId: null,
    response: {
      type: "run",
      run: {
        id: props.agent.runId,
        epoch,
        goal: "Fixture workflow",
        status: "running",
        phase: "research",
        notice: "",
        mergedCommit: null,
        humanReviewed: false,
        steps: [
          {
            id: required(props.agent.stepId),
            childRunId: childId,
            kind: "research",
            status,
            text: "",
            exitCode: null,
            truncated: false,
          },
        ],
      },
    },
  });
  const snapshot = (
    text: string,
    status: ChatTurn["status"] = "running",
    state: "running" | "completed" | "failed" = "running",
  ): WorkbenchResult => ({
    kind: "workflow-transcript",
    runId: props.agent.runId,
    stepId: required(props.agent.stepId),
    turn: {
      id: childId,
      epoch,
      status,
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      items: [
        {
          id: callId,
          role: "tool",
          name: "bash",
          args: "{}",
          text,
          state,
          error: state === "failed",
        },
      ],
    },
  });
  const reads = (kind: WorkbenchRead["kind"]) =>
    requests.filter((request) => request.read.kind === kind);
  const pending = (kind: WorkbenchRead["kind"]) =>
    required(
      reads(kind).findLast(
        (request) => !request.replied && !request.signal?.aborted,
      ),
    );
  let activePath = "";
  const draw = () => {
    const wrapper = render(() => WorkflowAgentView(props));
    commit();
    const path = `workflow:${wrapper.key}`;
    if (activePath && path !== activePath) {
      // Retire the child scopes because the real parent supplied a new key.
      // This explicitly models unmount cleanup; it is not DOM reconciliation.
      for (const [key, scope] of children) {
        if (key === activePath || key.startsWith(`${activePath}/`)) {
          for (const cell of scope.cells) cell.cleanup?.();
          children.delete(key);
        }
      }
    }
    activePath = path;
    const tree = child(path, () => {
      const body = (wrapper.type as (p: typeof props) => ReactNode)(
        wrapper.props,
      );
      commit();
      return body;
    });
    const view = elements<ComponentProps<typeof ChatTurnView>>(
      tree,
      ChatTurnView,
    )[0];
    const result = elements<{
      children?: ReactNode;
      "aria-expanded": boolean;
      onClick(): void;
    }>(tree, "button").find(
      (button) => button.props.children === "Read retained step result",
    )?.props;
    let tool:
      | {
          path: string;
          step: ChatStep;
          head: ComponentProps<typeof CollapsibleHead>;
          output: ReactNode[];
        }
      | undefined;
    if (view) {
      // Observe calls to the actual projection, without replacing its behavior.
      if (!vi.isMockFunction(view.props.turn.detail))
        vi.spyOn(view.props.turn, "detail");
      const row = child(`${path}/turn:${view.key}`, () => {
        const body = (
          ChatTurnView as unknown as {
            type(p: ComponentProps<typeof ChatTurnView>): ReactNode;
          }
        ).type(view.props);
        commit();
        return body;
      });
      const element = required(
        elements<ComponentProps<typeof ToolStep>>(row, ToolStep)[0],
      );
      const toolPath = `${path}/turn:${view.key}/tool:${element.key}`;
      tool = child(toolPath, () => {
        const body = ToolStep(element.props);
        commit();
        return {
          path: toolPath,
          step: element.props.step,
          head: required(
            elements<ComponentProps<typeof CollapsibleHead>>(
              body,
              CollapsibleHead,
            )[0],
          ).props,
          output: elements<{ children?: ReactNode }>(body, "pre").map(
            (pre) => pre.props.children,
          ),
        };
      });
    }
    return { tree, path, turn: view?.props.turn, tool, result };
  };
  return {
    props,
    makeClient,
    run,
    snapshot,
    requests,
    reads,
    pending,
    draw,
    tool: () => required(draw().tool),
  };
}

it.each(["completed", "failed", "canceled", "unknown"] as const)(
  "WorkflowAgentView polls equal-part tool snapshots, keeps expanded output until refreshed, and reads a final %s snapshot",
  async (status) => {
    const f = workflowAgentFixture();
    f.draw();
    f.pending("workflow").reply(f.run());
    f.pending("workflow-transcript").reply(f.snapshot("first retained output"));
    await vi.advanceTimersByTimeAsync(0);
    const first = f.draw();
    expect(first.tool?.head.open).toBe(false);
    expect(first.turn?.detail).not.toHaveBeenCalled();
    expect(f.reads("workflow-detail")).toHaveLength(0);
    required(first.tool).head.onToggle();
    expect(f.tool().head.open).toBe(true);
    await settle();
    expect(f.tool().output).toContain("first retained output");
    expect(first.turn?.detail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(f.reads("workflow-transcript")).toHaveLength(2);
    expect(f.tool().output).toContain("first retained output");
    expect(f.tool().head.open).toBe(true);
    f.pending("workflow").reply(f.run());
    f.pending("workflow-transcript").reply(
      f.snapshot("second retained output"),
    );
    await vi.advanceTimersByTimeAsync(0);
    const second = f.draw();
    expect(second.tool?.path).toBe(first.tool?.path);
    expect(second.tool?.step.id).toBe(first.tool?.step.id);
    expect(second.tool?.step.parts).toBe(1);
    expect(second.tool?.step.parts).toBe(first.tool?.step.parts);
    expect(second.tool?.step.version).toBeUndefined(); // Retained workflow format.
    expect(second.tool?.head.open).toBe(true);
    expect(second.tool?.output).toContain("first retained output");
    await settle();
    expect(f.tool().output).toContain("second retained output");
    expect(f.tool().output).not.toContain("first retained output");
    expect(second.turn?.detail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    const obsolete = f.pending("workflow-transcript");
    f.pending("workflow").reply(f.run(status));
    await vi.advanceTimersByTimeAsync(0);
    const ending = f.draw(); // live interval -> zero initiates the final read.
    expect(ending.tool?.output).toContain("second retained output");
    expect(ending.tool?.head.open).toBe(true);
    expect(obsolete.signal?.aborted).toBe(true);
    expect(f.reads("workflow-transcript")).toHaveLength(4);
    f.pending("workflow-transcript").reply(
      f.snapshot("final retained output", status, "completed"),
    );
    await vi.advanceTimersByTimeAsync(0);
    const final = f.draw();
    expect(final.tool?.path).toBe(first.tool?.path);
    expect(final.tool?.step).toMatchObject({
      id: first.tool?.step.id,
      parts: 1,
      state: "completed",
    });
    expect(final.turn?.header.status).toBe(status);
    expect(final.tool?.head.open).toBe(true);
    expect(final.tool?.output).toContain("second retained output");
    await settle();
    expect(f.tool().output).toContain("final retained output");
    expect(final.turn?.detail).toHaveBeenCalledTimes(1);
    obsolete.reply(f.snapshot("obsolete live output"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.tool().output).toContain("final retained output");
    expect(f.tool().output).not.toContain("obsolete live output");
    expect(f.reads("workflow-transcript")).toHaveLength(4);
    expect(f.reads("workflow-detail")).toHaveLength(0);
    f.tool().head.onToggle();
    expect(f.tool().head.open).toBe(false);
    expect(final.turn?.detail).toHaveBeenCalledTimes(1);
  },
);

it("closed workflow tool and step-result details remain lazy through updates and settlement", async () => {
  const f = workflowAgentFixture();
  f.draw();
  f.pending("workflow").reply(f.run());
  f.pending("workflow-transcript").reply(f.snapshot("unopened first output"));
  await vi.advanceTimersByTimeAsync(0);
  const first = f.draw();
  expect(first.tool?.head.open).toBe(false);
  expect(first.turn?.detail).not.toHaveBeenCalled();
  required(first.tool).head.onToggle();
  f.draw();
  await settle();
  expect(f.tool().output).toContain("unopened first output");
  f.tool().head.onToggle();
  expect(f.tool().head.open).toBe(false);
  expect(first.turn?.detail).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  f.pending("workflow").reply(f.run());
  f.pending("workflow-transcript").reply(f.snapshot("unopened second output"));
  await vi.advanceTimersByTimeAsync(0);
  const second = f.draw();
  expect(second.tool?.output).toEqual([]);
  expect(second.turn?.detail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  f.pending("workflow").reply(f.run("failed"));
  await vi.advanceTimersByTimeAsync(0);
  f.draw();
  f.pending("workflow-transcript").reply(
    f.snapshot("unopened final output", "failed", "completed"),
  );
  await vi.advanceTimersByTimeAsync(0);
  const final = f.draw();
  expect(final.tool?.head.open).toBe(false);
  expect(final.tool?.output).toEqual([]);
  expect(final.turn?.detail).not.toHaveBeenCalled();
  expect(f.reads("workflow-detail")).toHaveLength(0);
});

it.each(["client", "run", "step"] as const)(
  "workflow %s navigation retires the actual polling and expanded tool/result lifetimes; late reads cannot write back",
  async (change) => {
    const f = workflowAgentFixture();
    f.draw();
    f.pending("workflow").reply(f.run());
    f.pending("workflow-transcript").reply(f.snapshot("old tool output"));
    await vi.advanceTimersByTimeAsync(0);
    const old = f.draw();
    required(old.tool).head.onToggle();
    required(old.result).onClick();
    f.draw();
    await settle();
    expect(f.tool().output).toContain("old tool output");
    f.pending("workflow-detail").reply({
      kind: "file",
      path: "step.txt",
      limited: false,
      text: "old step result",
    });
    await vi.advanceTimersByTimeAsync(1000);
    const obsolete = f.requests.filter((request) => !request.replied);
    expect(obsolete.map((request) => request.read.kind).sort()).toEqual([
      "workflow",
      "workflow-detail",
      "workflow-transcript",
    ]);
    // Capture old response identities before navigating; the call id/child id
    // intentionally collide so only the component lifetime can isolate them.
    const oldRun = f.run("failed"),
      oldTranscript = f.snapshot("late old tool output");
    if (change === "client") f.props.client = f.makeClient();
    else
      f.props.agent = {
        ...f.props.agent,
        ...(change === "run"
          ? { runId: crypto.randomUUID() }
          : { stepId: "other-agent" }),
      };
    const next = f.draw();
    expect(next.path).not.toBe(old.path);
    expect(next.turn).toBeUndefined();
    expect(next.tool).toBeUndefined();
    for (const request of obsolete) expect(request.signal?.aborted).toBe(true);
    expect(f.pending("workflow-transcript").read).toEqual({
      kind: "workflow-transcript",
      id: f.props.agent.runId,
      stepId: f.props.agent.stepId,
    });
    expect(f.pending("workflow-transcript").client).toBe(
      change === "client" ? 2 : 1,
    );
    f.pending("workflow").reply(f.run());
    f.pending("workflow-transcript").reply(f.snapshot("current tool output"));
    await vi.advanceTimersByTimeAsync(0);
    const current = f.draw();
    expect(current.tool?.head.open).toBe(false);
    expect(current.result?.["aria-expanded"]).toBe(false);
    expect(current.turn?.detail).not.toHaveBeenCalled();
    required(current.tool).head.onToggle();
    required(current.result).onClick();
    f.draw();
    f.pending("workflow-detail").reply({
      kind: "file",
      path: "step.txt",
      limited: false,
      text: "current step result",
    });
    await vi.advanceTimersByTimeAsync(0);
    for (const request of obsolete)
      request.reply(
        request.read.kind === "workflow"
          ? oldRun
          : request.read.kind === "workflow-transcript"
            ? oldTranscript
            : {
                kind: "file",
                path: "step.txt",
                limited: false,
                text: "late old step result",
              },
      );
    await vi.advanceTimersByTimeAsync(0);
    const settled = f.draw();
    expect(settled.tool?.output).toContain("current tool output");
    expect(settled.tool?.output).not.toContain("late old tool output");
    expect(settled.turn?.header.status).toBe("running");
    expect(
      elements<{ children?: ReactNode }>(settled.tree, "pre").map(
        (pre) => pre.props.children,
      ),
    ).toEqual(["current step result"]);
  },
);

function timelineRows(tree: ReactNode) {
  return elements(tree, Fragment).flatMap((outer) => {
    const lazy = elements<ComponentProps<typeof LazyMount>>(
      outer,
      LazyMount,
    )[0];
    const view = elements<ComponentProps<typeof ChatTurnView>>(
      outer,
      ChatTurnView,
    )[0];
    return lazy && view ? [{ outer, lazy, view }] : [];
  });
}
function loaded(
  id: string,
  renderId: string | undefined,
  ordinal: number,
): LoadedTurn {
  const { turn, step } = fixture();
  const steps: ChatStep[] = [
    {
      ...step,
      id: `${id}:user`,
      renderId: `${renderId ?? id}:user`,
      role: "user",
      text: "Same question",
    },
    {
      ...step,
      id: `${id}:text`,
      renderId: `${renderId ?? id}:text`,
      role: "assistant",
      text: "Same answer",
    },
    { ...step, renderId: `${renderId ?? id}:tool` },
  ];
  return {
    ...turn,
    renderId,
    ordinal,
    steps,
    header: {
      ...turn.header,
      id,
      at: 100 + ordinal * 100,
      entry: `${id}-end`,
      parent: `${id}-parent`,
      steps: steps.length,
    },
  };
}
function workspaceFixture(turns: LoadedTurn[]) {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++sequence, fn);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const fn of pending) fn(0);
  };
  class Observer {
    static all: Observer[] = [];
    targets = new Set<Element>();
    observe = vi.fn((el: Element) => this.targets.add(el));
    unobserve = vi.fn((el: Element) => this.targets.delete(el));
    disconnect = vi.fn(() => this.targets.clear());
    constructor(readonly callback: ResizeObserverCallback) {
      Observer.all.push(this);
    }
    resize(el: Element) {
      expect(this.targets.has(el)).toBe(true);
      this.callback(
        [{ target: el } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const conversation: ReturnType<typeof useConversation> = {
    summary: {
      id: "chat",
      title: "Fixture",
      status: "completed",
      leaf: "leaf",
      origin: "webui",
      updatedAt: 1,
    },
    leaf: "leaf",
    turns,
    commands: [],
    pending: [],
    undelivered: [],
    runs: [],
    attempt: null,
    count: Math.max(...turns.map((turn) => turn.ordinal)) + 1,
    branches: 1,
    pinned: false,
    earlier: false,
    loadingEarlier: false,
    error: "",
    refresh: vi.fn(),
    choose: vi.fn(),
    loadEarlier: vi.fn(),
    showFrom: vi.fn(),
  };
  workspace.conversation = conversation;
  workspace.nodes = turns.map((turn, i) => ({
    id: turn.header.id,
    parent: turns[i - 1]?.header.id ?? null,
    leaf: "leaf",
    current: true,
    text: "Same question",
    at: turn.header.at,
  }));
  const model = {
    provider: "fixture",
    model: "model",
    api: "openai-completions",
    thinking: "off",
    sourceSelectionId: "source",
  };
  const client = {
    models: vi.fn(async () => ({
      kind: "ok",
      value: {
        version: {
          epoch: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          catalogId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          conversation: { id: "chat", cwd: "/project" },
          configRev: 1,
          accessGeneration: 1,
        },
        selected: model,
        remembered: null,
        status: "complete",
        withheld: 0,
        entries: [],
      },
    })),
    workbenchCommand: vi.fn(async (_command: unknown) => ({
      kind: "ok",
      value: {},
    })),
  };
  // Controlled dimensions: scrollTop deliberately records the requested value,
  // not browser clamping, anchoring or event dispatch.
  const root = {
    scrollTop: 1400,
    scrollHeight: 2000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => [...mounted.values()].map((row) => row.el),
  };
  const mounted = new Map<
    string,
    {
      el: HTMLDivElement;
      ref: NonNullable<ComponentProps<typeof LazyMount>["lazyRef"]>;
      top: number;
      height: number;
    }
  >();
  let tree: ReactNode;
  const draw = (hidden = false) => {
    tree = render(() =>
      ChatWorkspace({
        client: client as never,
        id: "chat",
        workspaceId: "workspace",
        initialCwd: "/project",
        enabled: true,
        hidden,
        modelAvailability: {
          status: "ready",
          epoch: "epoch",
          attachmentVersion: 1,
        },
        onModelChanged: workspace.no,
        onChanged: workspace.no,
        onReferenceUsed: workspace.no,
      }),
    );
    const messages = required(
      elements<{
        className?: string;
        ref: { current: unknown };
        onScroll(): void;
      }>(tree, "div").find((el) => el.props.className === "chat-messages"),
    );
    messages.props.ref.current = root;
    const rows = timelineRows(tree);
    const present = new Set(rows.map((row) => String(row.outer.key)));
    for (const [key, row] of mounted)
      if (!present.has(key)) {
        row.ref(null);
        mounted.delete(key);
      }
    for (const { outer, lazy } of rows) {
      const key = String(outer.key);
      let row = mounted.get(key);
      if (!row) {
        row = {
          el: undefined as unknown as HTMLDivElement,
          ref: required(lazy.props.lazyRef),
          top: 0,
          height: 320,
        };
        const geometry = row;
        row.el = {
          dataset: { lazyId: lazy.props.id },
          get offsetHeight() {
            return geometry.height;
          },
          getBoundingClientRect: () => ({
            top: geometry.top,
            bottom: geometry.top + geometry.height,
            height: geometry.height,
          }),
          scrollIntoView: vi.fn(),
          classList: { remove: vi.fn(), add: vi.fn() },
          offsetWidth: 100,
        } as unknown as HTMLDivElement;
        mounted.set(key, row);
      } else if (row.ref !== lazy.props.lazyRef) row.ref(null);
      row.ref = required(lazy.props.lazyRef);
      row.el.dataset.lazyId = lazy.props.id;
      row.ref(row.el);
    }
    commit();
    return {
      tree,
      rows,
      scroll: messages.props.onScroll,
      composer: elements<ComponentProps<typeof ChatComposer>>(
        tree,
        ChatComposer,
      )[0].props,
      rail: elements<ComponentProps<typeof QuestionRail>>(tree, QuestionRail)[0]
        ?.props,
      latest: elements<{ className?: string; onClick(): void }>(
        tree,
        "button",
      ).find((el) => el.props.className === "scroll-bottom")?.props.onClick,
    };
  };
  const rowAt = (id: string) =>
    required([...mounted.values()].find((row) => row.el.dataset.lazyId === id));
  return {
    draw,
    root,
    rowAt,
    conversation,
    client,
    storage,
    flushFrames,
    frames,
    observers: Observer.all,
  };
}

it("ChatWorkspace keeps outer row identities through Pi handoff, inserted blocks, settlement, re-observation and earlier pages, without merging equal bodies", () => {
  const preview = loaded("command", "command:user", 1);
  const other = loaded("other-command", "other:user", 2);
  const f = workspaceFixture([preview, other]);
  const initial = f.draw().rows;
  expect(initial.map((row) => row.outer.key)).toEqual([
    "command:user",
    "other:user",
  ]);
  const durable: LoadedTurn = {
    ...preview,
    header: { ...preview.header, id: "pi-user" },
    steps: [
      preview.steps[0],
      preview.steps[1],
      {
        ...preview.steps[2],
        id: "thinking",
        renderId: "capture:thinking:0",
        role: "thinking",
        parts: 0,
      },
      {
        ...preview.steps[2],
        id: "inserted-call",
        renderId: "capture:inserted-tool:0",
      },
      { ...preview.steps[2], id: "pi-tool", state: "completed" },
    ],
  };
  const final = {
    ...durable,
    header: { ...durable.header, status: "completed" as const },
  };
  const sameRow = f.rowAt("command").el;
  for (const turns of [
    [durable, other],
    [final, other],
    [loaded("old-pi", undefined, 0), final, other],
    [
      loaded("old-pi", undefined, 0),
      { ...final, header: { ...final.header } },
      other,
    ],
  ]) {
    f.conversation.turns = turns;
    const rows = f.draw().rows;
    expect(rows.find((row) => row.view.props.turn === other)?.outer.key).toBe(
      initial[1].outer.key,
    );
    expect(rows.find((row) => row.lazy.props.id === "pi-user")?.outer.key).toBe(
      initial[0].outer.key,
    );
    expect(f.rowAt("pi-user").el).toBe(sameRow);
    expect(rows.map((row) => row.view.props.turn.steps[1].text)).toEqual(
      turns.map(() => "Same answer"),
    );
  }
  const rows = f.draw().rows;
  expect(rows[0].outer.key).toBe("old-pi"); // No invented links for legacy history.
  expect(new Set(rows.map((row) => row.outer.key)).size).toBe(3);
  // Window registration/measurement and navigation keep actual read ids.
  expect(rows.map((row) => row.lazy.props.id)).toEqual([
    "old-pi",
    "pi-user",
    "other-command",
  ]);
  const measured = f.rowAt("pi-user");
  measured.height = 777;
  f.observers[0].resize(measured.el);
  f.flushFrames();
  expect(f.draw().rows[1].lazy.props.height).toBe(777);
});

// Inspect the actual memoized segment elements and their inner renderer, not a
// parallel key calculator. These are controlled component trees, NOT mounted
// React DOM continuity or layout evidence.
function markdownSegments(props: ComponentProps<typeof StreamMarkdown>) {
  const body = (
    StreamMarkdown as unknown as {
      type(props: ComponentProps<typeof StreamMarkdown>): ReactElement<{
        children: ReactElement<{ text: string }>[];
      }>;
    }
  ).type(props);
  return body.props.children.map((element) => {
    const renderer = (
      element.type as unknown as {
        type(props: { text: string }): ReactElement<{ text: string }>;
      }
    ).type(element.props);
    return {
      key: element.key,
      type: element.type,
      text: element.props.text,
      renderer: renderer.type,
      renderedText: renderer.props.text,
    };
  });
}

it("the real chat path keeps source-position Markdown identities across append, active-to-frozen, durable/terminal handoff, tool insertion and history observations", () => {
  const text = "Header 🚀\r\n\r\n- item\r\n\r\n  continuation\r\n\r\nTail";
  const base = loaded("command", "command:user", 1);
  const preview: LoadedTurn = {
    ...base,
    steps: base.steps.map((step, i) =>
      i === 1 ? { ...step, text, state: "streaming" } : step,
    ),
  };
  const f = workspaceFixture([preview]);
  const draw = () => {
    const { outer, view } = required(
      f
        .draw()
        .rows.find((row) => row.view.props.turn.renderId === preview.renderId),
    );
    const rowPath = `row:${outer.key}`;
    const row = child(rowPath, () => {
      const tree = (
        ChatTurnView as unknown as {
          type(props: ComponentProps<typeof ChatTurnView>): ReactNode;
        }
      ).type(view.props);
      commit();
      return tree;
    });
    const part = required(
      elements<{ className?: string; children?: ReactNode }>(row, "div").find(
        (element) => element.props.className === "msg-part",
      ),
    );
    const step = required(
      elements<ComponentProps<typeof StepText>>(part, StepText)[0],
    );
    const partPath = `${rowPath}/part:${part.key}`;
    const content = child(partPath, () => {
      const tree = StepText(step.props);
      commit();
      return tree;
    });
    const markdown = required(
      elements<ComponentProps<typeof StreamMarkdown>>(
        content,
        StreamMarkdown,
      )[0],
    );
    return {
      row: outer.key,
      part: part.key,
      type: markdown.type,
      streaming: markdown.props.streaming,
      segments: child(`${partPath}/markdown`, () =>
        markdownSegments(markdown.props),
      ),
    };
  };
  const initial = draw();
  expect(initial.streaming).toBe(true);
  expect(initial.segments.map((segment) => segment.key)).toEqual([
    "stream-offset:0",
    `stream-offset:${text.indexOf("- item")}`,
    `stream-offset:${text.indexOf("Tail")}`,
  ]);
  expect(initial.segments.map((segment) => segment.renderedText).join("")).toBe(
    text,
  );
  expect(
    initial.segments.every((segment) => segment.renderer === MarkdownBody),
  ).toBe(true);

  const appended: LoadedTurn = {
    ...preview,
    steps: preview.steps.map((step, i) =>
      i === 1
        ? { ...step, text: `${text}\r\n\r\n## Next\r\n\r\nnew tail` }
        : step,
    ),
  };
  f.conversation.turns = [appended];
  const next = draw();
  // Complete prefix props and identities do not change. The old active tail
  // gains only its source separator and keeps both component/renderer types.
  expect(next.segments.slice(0, 2)).toEqual(initial.segments.slice(0, 2));
  expect(next.segments[2]).toEqual({
    ...initial.segments[2],
    text: "Tail\r\n\r\n",
    renderedText: "Tail\r\n\r\n",
  });
  expect(next.segments.map((segment) => segment.text).join("")).toBe(
    appended.steps[1].text,
  );

  const durable: LoadedTurn = {
    ...appended,
    header: { ...appended.header, id: "pi-user" },
    steps: [
      appended.steps[0],
      { ...appended.steps[2], id: "new-tool", renderId: "capture:unrelated:0" },
      { ...appended.steps[1], id: "pi-text", state: "completed" },
      appended.steps[2],
    ],
  };
  const terminal: LoadedTurn = {
    ...durable,
    header: {
      ...durable.header,
      status: "completed",
      stable: durable.steps.length,
    },
  };
  for (const turns of [
    [durable],
    [terminal],
    [{ ...terminal, steps: terminal.steps.map((step) => ({ ...step })) }],
    [loaded("older-pi", undefined, 0), terminal],
  ]) {
    f.conversation.turns = turns;
    const observed = draw();
    expect(observed.streaming).toBe(false);
    expect(observed).toEqual({ ...next, streaming: false });
  }
});

it.each([
  {
    before: "Unchanged prefix\n\n\\[\na\n\nb",
    append: "\n\\]\n\nAfter",
  },
  {
    before: "Unchanged prefix\n\n[ref]\n\nMiddle",
    append: "\n\n> [ref]: https://example.com/",
  },
  {
    before: "Unchanged prefix\n\nNote[^n]\n\nMiddle",
    append: "\n\n[^n]: note",
  },
])(
  "new syntax only revises the dependent suffix, without replacing the unaffected prefix ($append)",
  ({ before, append }) => {
    const initial = render(() =>
      markdownSegments({ text: before, streaming: true }),
    );
    const next = render(() =>
      markdownSegments({ text: before + append, streaming: true }),
    );
    expect(next[0]).toEqual(initial[0]);
    expect(next[1].key).toBe(initial[1].key);
    expect(next[1].type).toBe(initial[1].type);
    expect(next[1].renderer).toBe(MarkdownBody);
    expect(next.map((segment) => segment.text).join("")).toBe(before + append);
    for (const streaming of [false, true, false])
      expect(
        render(() => markdownSegments({ text: before + append, streaming })),
      ).toEqual(next);
  },
);

it("the main row's actual ancestor and step keys preserve an opened tool and its read value during handoff and a pending final read", async () => {
  const source = fixture();
  const preview = {
    ...loaded("command", "command:user", 0),
    detail: source.detail,
  };
  const f = workspaceFixture([preview]);
  // Execute only the actual row/tool components, in hook cells addressed by
  // their returned keys. No inner-key-only assertion can hide an outer remount.
  const tool = () => {
    const { outer, view } = required(
      f
        .draw()
        .rows.find((row) => row.view.props.turn.renderId === preview.renderId),
    );
    const rowTree = child(`row:${outer.key}`, () => {
      const body = (
        ChatTurnView as unknown as {
          type(props: ComponentProps<typeof ChatTurnView>): ReactNode;
        }
      ).type(view.props);
      commit();
      return body;
    });
    const element = elements<ComponentProps<typeof ToolStep>>(
      rowTree,
      ToolStep,
    )[0];
    return child(`row:${outer.key}/tool:${element.key}`, () => {
      const body = ToolStep(element.props);
      commit();
      return {
        head: elements<ComponentProps<typeof CollapsibleHead>>(
          body,
          CollapsibleHead,
        )[0].props,
        output: elements<{ children?: ReactNode }>(body, "pre").map(
          (node) => node.props.children,
        ),
      };
    });
  };
  expect(tool().head.open).toBe(false);
  expect(source.detail).not.toHaveBeenCalled();
  tool().head.onToggle();
  expect(tool().head.open).toBe(true);
  source.requests[0].resolve({ text: "already visible output", args: "" });
  await settle();
  expect(tool().output).toContain("already visible output");
  f.conversation.turns = [
    {
      ...preview,
      header: { ...preview.header, id: "pi-user", status: "completed" },
      steps: [
        ...preview.steps.slice(0, 2),
        {
          ...preview.steps[2],
          id: "thinking",
          renderId: "thinking",
          role: "thinking",
          parts: 0,
        },
        {
          ...preview.steps[2],
          id: "pi-call",
          state: "completed",
          version: "final",
        },
      ],
    },
  ];
  const handoff = tool();
  expect(handoff.head.open).toBe(true);
  expect(handoff.output).toContain("already visible output");
  expect(source.detail).toHaveBeenLastCalledWith(3, 1, expect.any(AbortSignal));
  expect(source.requests[0].signal.aborted).toBe(true);
  source.requests[1].resolve({ text: "final output", args: "" });
  await settle();
  expect(tool().output).toContain("final output");
  f.conversation.turns = [
    loaded("earlier-pi", undefined, 0),
    ...f.conversation.turns,
  ];
  expect(tool().head.open).toBe(true);
  expect(tool().output).toContain("final output");
  tool().head.onToggle();
  expect(tool().head.open).toBe(false);
  expect(source.requests[1].signal.aborted).toBe(true);
  expect(source.detail).toHaveBeenCalledTimes(2);
});

it("registered row resize follows without a new observation, respects the 80px intent boundary, and Latest resumes it; observers clean up", () => {
  const f = workspaceFixture([loaded("pi-user", "command:user", 0)]);
  let view = f.draw();
  const observer = f.observers[0];
  const row = f.rowAt("pi-user");
  expect(f.observers).toHaveLength(1);
  expect(observer.targets).toEqual(new Set([f.root, row.el]));
  const summary = f.conversation.summary;
  const turns = f.conversation.turns;
  const grow = (height: number) => {
    f.root.scrollHeight += height;
    row.height += height;
    observer.resize(row.el);
    f.flushFrames();
  };
  grow(400); // Image/detail completion, no parent read or render.
  expect(f.root.scrollTop).toBe(2400);
  f.root.scrollTop = f.root.scrollHeight - f.root.clientHeight - 79;
  view.scroll();
  grow(100);
  expect(f.root.scrollTop).toBe(2500);
  f.root.scrollTop = f.root.scrollHeight - f.root.clientHeight - 80;
  view.scroll();
  const paused = f.root.scrollTop;
  grow(300);
  expect(f.root.scrollTop).toBe(paused);
  view = f.draw();
  expect(view.latest).toBeTypeOf("function");
  f.root.scrollHeight += 100;
  required(view.composer.onResized)();
  expect(f.root.scrollTop).toBe(paused); // Composer keeps the same intent rule.
  required(view.latest)();
  expect(f.root.scrollTop).toBe(2900);
  grow(200); // The original observer reads the current stick ref.
  expect(f.root.scrollTop).toBe(3100);
  view = f.draw();
  expect(view.latest).toBeUndefined();
  f.root.scrollHeight += 100;
  required(view.composer.onResized)();
  expect(f.root.scrollTop).toBe(3200);
  expect(f.conversation.summary).toBe(summary);
  expect(f.conversation.turns).toBe(turns);
  expect(f.observers).toHaveLength(1);
  f.conversation.turns = [];
  f.draw();
  expect(observer.unobserve).toHaveBeenCalledWith(row.el);
  expect(observer.targets).toEqual(new Set([f.root]));
  observer.resize(f.root as unknown as Element);
  expect(f.frames.size).toBeGreaterThan(0);
  for (const cell of hooks.cells) {
    cell.cleanup?.();
    cell.cleanup = undefined;
  }
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(observer.targets.size).toBe(0);
  expect(f.frames.size).toBe(0);
});

it("up-scroll survives hiding and earlier-page anchoring, while user return to the bottom restores resize following", () => {
  const recent = loaded("pi-recent", "command:recent", 1);
  const f = workspaceFixture([recent]);
  f.conversation.earlier = true;
  let view = f.draw();
  f.root.scrollTop = 500;
  view.scroll();
  expect(f.conversation.loadEarlier).toHaveBeenCalledTimes(1);
  view = f.draw(true);
  f.root.scrollTop = 0; // display:none loses the browser's scroll offset.
  view.scroll(); // Hidden scroll events must not overwrite lastTop or stick.
  f.root.scrollHeight += 200;
  f.observers[0].resize(f.rowAt("pi-recent").el);
  expect(f.root.scrollTop).toBe(0);
  view = f.draw(false);
  expect(f.root.scrollTop).toBe(500);
  f.root.scrollHeight += 320;
  f.conversation.turns = [loaded("pi-old", undefined, 0), recent];
  view = f.draw();
  expect(f.root.scrollTop).toBe(820); // Non-native anchoring fixture.
  f.root.scrollHeight += 100;
  f.observers[0].resize(f.rowAt("pi-recent").el);
  expect(f.root.scrollTop).toBe(820);
  f.root.scrollTop = f.root.scrollHeight - f.root.clientHeight;
  view.scroll();
  f.root.scrollHeight += 150;
  f.observers[0].resize(f.rowAt("pi-recent").el);
  expect(f.root.scrollTop).toBe(f.root.scrollHeight);
  expect(f.draw().latest).toBeUndefined();
});

it("versions, question tracking/jump pin, workflow placement, edit/continue and Send anchors use Pi read coordinates, not render ids", async () => {
  const first = loaded("pi-first", "command:first", 0);
  const second = loaded("pi-second", "command:second", 1);
  first.header.status = second.header.status = "completed";
  const f = workspaceFixture([first, second]);
  workspace.nodes = [
    ...workspace.nodes,
    {
      ...workspace.nodes[0],
      id: "pi-alternate",
      leaf: "alternate-leaf",
      current: false,
    },
  ];
  const run: WorkflowRun = {
    id: "workflow",
    epoch: "epoch",
    goal: "Work",
    status: "running",
    phase: "implementing",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [],
    diagnostics: {
      acceptedAt: 150,
      acquiredAt: null,
      settledAt: null,
      owner: {
        version: "fixture",
        build: "fixture",
        entry: "fixture",
        pid: 1,
        node: "fixture",
        platform: "fixture",
        startedAt: 1,
      },
    },
  };
  workspace.runs = new Map([[run.id, run]]);
  f.conversation.runs = [run.id];
  let view = f.draw();
  expect(view.rows[0].view.props).toMatchObject({ version: 1, versions: 2 });
  expect(
    elements<ComponentProps<typeof WorkflowLine>>(
      view.rows[0].outer,
      WorkflowLine,
    )[0].props.run,
  ).toBe(run);
  expect(elements(view.rows[1].outer, WorkflowLine)).toHaveLength(0);
  expect(view.rail.questions.map((q) => q.id)).toEqual([
    "pi-first",
    "pi-second",
  ]);
  f.root.scrollTop = 400;
  f.rowAt("pi-first").top = 0;
  f.rowAt("pi-second").top = 500;
  view.scroll();
  f.flushFrames();
  view = f.draw();
  expect(view.rail.active).toBe(0);
  view.rail.onJump("pi-first");
  f.draw();
  view = f.draw();
  f.flushFrames();
  expect(f.rowAt("pi-first").el.scrollIntoView).toHaveBeenCalledWith({
    block: "start",
  });
  // Force it beyond the lazy window and its measured tail budget: only the
  // read-id jump pin can keep this row mounted.
  f.rowAt("pi-first").top = -6000;
  f.rowAt("pi-second").height = 3000;
  f.observers[0].resize(f.rowAt("pi-second").el);
  f.flushFrames();
  f.conversation.turns = [...f.conversation.turns];
  f.draw();
  view = f.draw();
  expect(view.rows[0].lazy.props.show).toBe(true);
  required(view.rows[0].view.props.onContinue)("pi-first");
  f.draw();
  view = f.draw();
  expect(
    JSON.parse(required(f.storage.get("cadence:draft:workspace:chat:anchor"))),
  ).toMatchObject({
    turnId: "pi-first",
    entry: "pi-first-end",
    kind: "continue",
  });
  expect(view.rows.map((row) => row.view.props.off)).toEqual([false, true]);
  expect(
    elements<{ className?: string }>(view.rows[1].outer, "p").some(
      (el) => el.props.className === "chat-anchor-divider",
    ),
  ).toBe(true);
  required(view.rows[0].view.props.onEdit)("pi-first");
  f.draw();
  view = f.draw();
  expect(
    JSON.parse(required(f.storage.get("cadence:draft:workspace:chat:anchor"))),
  ).toMatchObject({
    turnId: "pi-first",
    entry: "pi-first-parent",
    kind: "edit",
  });
  expect(view.rows.map((row) => row.view.props.off)).toEqual([true, true]);
  expect(
    elements<{ className?: string }>(view.rows[0].outer, "p").some(
      (el) => el.props.className === "chat-anchor-divider",
    ),
  ).toBe(true);
  view.composer.onSend();
  for (let i = 0; i < 12; ++i) await Promise.resolve();
  expect(f.client.workbenchCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "send",
      head: "pi-first-parent",
      text: "Same question",
    }),
  );
  required(view.rows[0].view.props.onVersion)("pi-first", 1);
  expect(f.conversation.choose).toHaveBeenCalledWith("alternate-leaf", 0);
});

// This consumes the backend-checked shared contract through the real reader.
// The workspace's observation hook is controlled, but no LoadedTurn or detail
// closure is fabricated: all rows and lazy reads originate in ConversationReader.
async function independentViewFixture(
  kind: IndependentCase,
  order: TimelineOrder,
  terminal: IndependentCheckpoint["status"] = "completed",
) {
  vi.useFakeTimers();
  const ids = independentFixtureIds(),
    points = independentTimeline(order, terminal);
  let snapshot = independentResults(ids, kind, points[0]);
  const requests: {
    read: WorkbenchRead;
    signal?: AbortSignal;
    value: WorkbenchResult;
    replied: boolean;
    reply(): void;
  }[] = [];
  const client = new ServiceClient(
    transport({
      workbenchRead: (read, signal) => {
        const value = decodeWorkbenchResult(independentRead(snapshot, read));
        if (read.kind !== "conversation-step")
          return Promise.resolve({ kind: "ok", value });
        return new Promise((resolve) =>
          requests.push({
            read,
            signal,
            value,
            replied: false,
            reply() {
              expect(this.replied).toBe(false);
              this.replied = true;
              resolve({ kind: "ok", value });
            },
          }),
        );
      },
    }),
  );
  let reader = new ConversationReader(client, ids.conversation, () => {});
  reader.setActive(true);
  await vi.advanceTimersByTimeAsync(0);
  const f = workspaceFixture(reader.view().turns);
  const orderedSteps = (node: ReactNode): ChatStep[] => {
    if (Array.isArray(node)) return node.flatMap(orderedSteps);
    if (!isValidElement<{ children?: ReactNode; step?: ChatStep }>(node))
      return [];
    if (node.type === ToolStep || node.type === StepText)
      return [required(node.props.step)];
    return orderedSteps(node.props.children);
  };
  const draw = () => {
    Object.assign(f.conversation, reader.view());
    const rows = f.draw().rows;
    const { outer, view } = required(
      rows.find(
        (r) => r.view.props.turn.renderId === `command:${ids.command}:user`,
      ),
    );
    const rowPath = `row:${outer.key}/view:${view.key}`;
    const tree = child(rowPath, () => {
      const body = (
        ChatTurnView as unknown as {
          type(p: ComponentProps<typeof ChatTurnView>): ReactNode;
        }
      ).type(view.props);
      commit();
      return body;
    });
    const tools = elements<ComponentProps<typeof ToolStep>>(tree, ToolStep).map(
      (element) => {
        const path = `${rowPath}/tool:${element.key}`;
        return child(path, () => {
          const body = ToolStep(element.props);
          commit();
          return {
            path,
            step: element.props.step,
            head: required(
              elements<ComponentProps<typeof CollapsibleHead>>(
                body,
                CollapsibleHead,
              )[0],
            ).props,
            output: elements<{ children?: ReactNode }>(body, "pre").map(
              (pre) => pre.props.children,
            ),
          };
        });
      },
    );
    expect(orderedSteps(tree).map((s) => s.renderId)).toEqual(
      snapshot.turn.steps.map((s) => s.renderId),
    );
    return { rowPath, tools, rows, turn: view.props.turn };
  };
  return {
    ids,
    points,
    requests,
    draw,
    tool: () =>
      required(
        draw().tools.find((t) => t.step.renderId === `call:${ids.execution}`),
      ),
    pending: () =>
      required(requests.findLast((r) => !r.replied && !r.signal?.aborted)),
    async observe(point: IndependentCheckpoint) {
      snapshot = independentResults(ids, kind, point);
      if (point.action === "reconnect") {
        reader.close();
        reader = new ConversationReader(client, ids.conversation, () => {});
        reader.setActive(true);
      } else reader.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(reader.view().error).toBe("");
    },
    async earlier() {
      reader.loadEarlier();
      await vi.advanceTimersByTimeAsync(0);
    },
    close() {
      reader.close();
    },
  };
}

it.each(independentScenarios)(
  "$kind/$order/$terminal: actual reader and ChatTurnView/ToolStep keep an opened independent execution across handoff, equal-part updates, final reads, history and cold observation",
  async ({ kind, order, terminal }) => {
    const f = await independentViewFixture(kind, order, terminal);
    let path = "",
      visible = "",
      priorReadCount = 0;
    try {
      const rowPath = f.draw().rowPath;
      expect(f.requests).toHaveLength(0);
      for (const point of f.points.slice(1)) {
        await f.observe(point);
        const drawn = f.draw();
        expect(drawn.rowPath).toBe(rowPath);
        expect(drawn.tools).toHaveLength(
          (kind === "ambiguous" ? 2 : 0) + 1 + (point.repeated ? 1 : 0),
        );
        let tool = f.tool();
        if (point.action === "tool-start") {
          expect(tool.head.open).toBe(false);
          expect(f.requests).toHaveLength(0);
          path = tool.path;
          tool.head.onToggle();
          tool = f.tool();
        }
        expect(tool.path, point.action).toBe(path);
        expect(tool.head.open, point.action).toBe(true);
        expect(tool.step.parts).toBe(1);
        if (visible) expect(tool.output, point.action).toContain(visible);
        if (
          [
            "tool-first",
            "tool-later",
            "tool-end",
            "result-mark",
            "reply-end",
            "reconnect",
          ].includes(point.action)
        )
          expect(f.requests.length, point.action).toBeGreaterThan(
            priorReadCount,
          );
        // Complete only the currently wanted request, retaining the displayed
        // prior snapshot above while the same-part revision/final read waits.
        const pending = f.requests.findLast(
          (r) => !r.replied && !r.signal?.aborted,
        );
        if (pending) {
          pending.reply();
          await vi.advanceTimersByTimeAsync(0);
        }
        visible = point.output;
        if (visible) expect(f.tool().output).toContain(visible);
        expect(
          f.requests.every(
            (r) =>
              r.value.kind === "conversation-step" &&
              r.value.item.renderId === `call:${f.ids.execution}`,
          ),
        ).toBe(true);
        expect(
          f
            .draw()
            .tools.filter((t) => t.step.renderId !== `call:${f.ids.execution}`)
            .every((t) => !t.head.open),
        ).toBe(true);
        if (point.action === "result-mark") {
          await f.earlier();
          expect(f.draw().rows).toHaveLength(4);
          expect(f.tool().path).toBe(path);
          expect(f.tool().head.open).toBe(true);
          expect(f.tool().output).toContain(visible);
        }
        if (point.repeated) {
          const executions = f
            .draw()
            .tools.filter((t) => t.step.renderId?.startsWith("call:"));
          expect(executions.map((t) => t.step.renderId)).toEqual([
            `call:${f.ids.execution}`,
            `call:${f.ids.repeatExecution}`,
          ]);
          expect(executions[0].step.version).toBe(executions[1].step.version);
        }
        priorReadCount = f.requests.length;
      }
      const repeated = required(
        f
          .draw()
          .tools.find(
            (t) => t.step.renderId === `call:${f.ids.repeatExecution}`,
          ),
      );
      repeated.head.onToggle();
      f.draw();
      expect(f.requests).toHaveLength(priorReadCount + 1);
      const duplicateRead = f.pending();
      expect(duplicateRead.value).toMatchObject({
        kind: "conversation-step",
        item: {
          renderId: `call:${f.ids.repeatExecution}`,
          text: "final output",
        },
      });
      duplicateRead.reply();
      await vi.advanceTimersByTimeAsync(0);
      const executions = f
        .draw()
        .tools.filter((t) => t.step.renderId?.startsWith("call:"));
      expect(executions.map((t) => t.output)).toEqual([
        ["final output"],
        ["final output"],
      ]);
      for (const tool of executions) tool.head.onToggle();
      priorReadCount = f.requests.length;
      expect(f.tool().head.open).toBe(false);
      await f.observe(required(f.points.at(-1)));
      expect(f.tool().head.open).toBe(false);
      expect(f.requests).toHaveLength(priorReadCount);
    } finally {
      f.close();
    }
  },
);

it("an independent tool's late revision and retired-conversation replies cannot replace the currently opened output", async () => {
  const old = await independentViewFixture("ambiguous", "marker-first");
  let current: Awaited<ReturnType<typeof independentViewFixture>> | undefined;
  const point = (action: IndependentCheckpoint["action"]) =>
    required(old.points.find((p) => p.action === action));
  try {
    await old.observe(point("tool-first"));
    old.tool().head.onToggle();
    old.tool();
    const first = old.pending();
    first.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(old.tool().output).toContain("first output");
    await old.observe(point("tool-later"));
    expect(old.tool().output).toContain("first output");
    const staleRevision = old.pending();
    await old.observe(point("tool-end"));
    expect(old.tool().output).toContain("first output");
    expect(staleRevision.signal?.aborted).toBe(true);
    const final = old.pending();
    final.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(old.tool().output).toContain("final output");
    staleRevision.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(old.tool().output).toContain("final output");
    await old.observe(point("result-mark"));
    old.tool();
    const retired = old.pending();
    old.close();
    expect(retired.signal?.aborted).toBe(true);
    current = await independentViewFixture("undeclared", "final-first");
    await current.observe(
      required(current.points.find((p) => p.action === "tool-first")),
    );
    expect(current.tool().head.open).toBe(false);
    expect(current.requests).toHaveLength(0);
    current.tool().head.onToggle();
    current.tool();
    current.pending().reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.tool().output).toContain("first output");
    retired.reply();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.tool().output).toContain("first output");
    expect(current.tool().output).not.toContain("final output");
  } finally {
    old.close();
    current?.close();
  }
});
