// React's own SSR render-phase updates let us examine the next render with the
// same workspace state. All command transports below are in-memory fixtures.
import {
  act,
  Children,
  type ComponentProps,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ChoiceVersion } from "../../src/service/contracts/models.ts";
import type {
  CadenceConversation,
  ChatAttempt,
  ChatPending,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import {
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  readableWorkflowPlan,
} from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import type { LoadedTurn } from "../../web/src/client/conversation-reader";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../../web/src/components/workspace/ChatComposer";
import {
  ChatTurnView,
  ChatWorkspace,
} from "../../web/src/components/workspace/ChatWorkspace";
import { MessageAction } from "../../web/src/components/workspace/MessageActions";
import { WaitingMessages } from "../../web/src/components/workspace/WaitingMessages";
import { currentToasts } from "../../web/src/layout/toasts";
import { plan, v4Plan } from "../helpers/workflow-plan";
import { transport } from "./fixtures";

const f = vi.hoisted(() => ({
  state: undefined as CadenceConversation | undefined,
  empty: false,
  pinned: false,
  turns: [] as LoadedTurn[],
  undelivered: [] as ChatAttempt[],
  pending: [] as ChatPending[],
  modeError: false,
  live: undefined as { epoch: string; commandId: string } | undefined,
  catalog: undefined as ChoiceVersion | undefined,
  no: () => {},
}));
vi.mock("../../web/src/client/use-workbench", async (load) => ({
  ...(await load<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_: unknown, r: { kind: string } | null) => ({
    refresh: f.no,
    error:
      r?.kind === "cadence-conversation" && f.modeError
        ? "unavailable"
        : undefined,
    value:
      r?.kind === "cadence-conversation"
        ? { kind: r.kind, state: f.state }
        : r?.kind === "conversation-context"
          ? {
              kind: r.kind,
              context: {
                id: "chat",
                cwd: "/fixture",
                revision: 0,
                model: {
                  provider: "fixture",
                  model: "fixture",
                  api: "openai-completions",
                  thinking: "low",
                },
              },
            }
          : undefined,
  }),
}));
vi.mock("../../web/src/client/use-model-catalog", () => ({
  useModelCatalog: () => ({
    catalog: f.catalog && {
      version: f.catalog,
      entries: [],
      status: "complete",
    },
    reread: f.no,
    isCurrent: () => true,
  }),
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    summary: f.empty
      ? null
      : {
          id: "chat",
          title: "Fixture discussion",
          status: f.live
            ? "running"
            : (f.undelivered.at(-1)?.status ?? "completed"),
          live: f.live,
          origin: "webui",
          leaf: "leaf",
        },
    pinned: f.pinned,
    leaf: f.empty ? null : f.pinned ? "earlier-leaf" : "leaf",
    turns: f.turns,
    runs: [],
    pending: f.pending,
    choose: f.no,
    undelivered: f.undelivered,
    commands: [],
    count: f.empty ? 0 : 1,
    refresh: f.no,
  }),
}));
const proposal = (goal: string) => ({
  id: crypto.randomUUID(),
  digest: "a".repeat(64),
  epoch: "fixture",
  cwd: "/fixture",
  observation: "b".repeat(64),
  model: {
    epoch: "fixture",
    accessGeneration: 1,
    catalogId: "catalog",
    configRev: 1,
  },
  plan: { ...plan(), goal },
});

function titleButton(tree: ReturnType<typeof ChatWorkspace>) {
  const header = Children.toArray(tree.props.children).find(
    (el) => isValidElement(el) && el.type === "header",
  );
  if (!isValidElement<{ children: React.ReactNode }>(header))
    throw Error("missing header");
  const trigger = Children.toArray(header.props.children).find(
    (el) =>
      isValidElement<{ className?: string }>(el) &&
      el.props.className === "current-plan-trigger",
  );
  if (
    !isValidElement<{
      onClick(): void;
      title: string;
      "aria-expanded": boolean;
    }>(trigger)
  )
    throw Error("missing trigger");
  return trigger.props;
}

function toggleTitle(tree: ReturnType<typeof ChatWorkspace>) {
  titleButton(tree).onClick();
}

it("opens and closes the current plan at the title, not the stream tail; later discussion, replacement and cold mount start collapsed", () => {
  const first = proposal("First agreement"),
    replacement = proposal("Replacement agreement");
  f.state = {
    id: "chat",
    revision: 1,
    head: "turn-1",
    enabled: true,
    runs: [],
    proposal: first,
  };
  const read = vi.fn(),
    command = vi.fn(),
    prepare = vi.fn();
  const client = new ServiceClient(
    transport({ workbenchRead: read, workbenchCommand: command }),
  );
  const snapshots: ReturnType<typeof ChatWorkspace>[] = [];
  function Probe() {
    const [n, advance] = useState(0);
    const tree = ChatWorkspace({
      client,
      id: "chat",
      workspaceId: "project",
      initialCwd: "/fixture",
      enabled: true,
      actionsReady: false,
      modelAvailability: { status: "stopped" },
      prepareForPlan: prepare,
      onChanged: f.no,
      onReferenceUsed: f.no,
      onModelChanged: f.no,
    });
    snapshots.push(tree);
    if (!f.state) throw Error("missing observation");
    switch (n) {
      case 0:
      case 1:
      case 2:
      case 4:
      case 6:
      case 8:
        toggleTitle(tree);
        break;
      case 3:
        f.state = { ...f.state, revision: 2, head: "turn-2" };
        break;
      case 5:
        f.state = { ...f.state, revision: 3, proposal: replacement };
        break;
      case 7:
        f.pinned = true;
        break;
      default:
        return tree;
    }
    advance(n + 1);
    return tree;
  }
  renderToStaticMarkup(<Probe />);
  expect(snapshots).toHaveLength(10);
  for (const [index, tree] of snapshots.entries()) {
    const html = renderToStaticMarkup(tree);
    const expanded = [1, 3, 5, 7, 9].includes(index);
    if (index === 9) {
      expect(html).toContain(
        "Show the latest branch before acting on the current plan.",
      );
      expect(html).toMatch(
        /class="primary"[^>]*disabled=""[^>]*>Restore execution and validate plan</,
      );
    }
    expect(html).toContain(
      expanded ? "Hide current plan" : "View current plan",
    );
    expect(html.includes('class="current-plan-panel"')).toBe(expanded);
    expect((html.match(/class="workflow-plan"/g) ?? []).length).toBe(
      expanded ? 1 : 0,
    );
    if (expanded) {
      expect(html.indexOf('class="workflow-plan"')).toBeLessThan(
        html.indexOf('class="chat-messages"'),
      );
      expect(html).toContain(
        index < 6 ? first.plan.goal : replacement.plan.goal,
      );
      expect(html).not.toContain(
        index < 6 ? replacement.plan.goal : first.plan.goal,
      );
    } else expect(html).not.toContain("Restore execution and validate plan");
  }
  f.pinned = false;
  function Cold() {
    return (
      <ChatWorkspace
        client={client}
        id="chat"
        workspaceId="project"
        enabled
        actionsReady={false}
        modelAvailability={{ status: "stopped" }}
        prepareForPlan={prepare}
        onChanged={f.no}
        onReferenceUsed={f.no}
        onModelChanged={f.no}
      />
    );
  }
  const cold = renderToStaticMarkup(<Cold />);
  expect(cold).toContain("View current plan");
  expect(cold).not.toContain('class="workflow-plan"');
  expect(command).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

function recordedProposal(version: 2 | 3 | 4 | 5 | undefined) {
  const p = proposal("Recorded material");
  if (version === 5) return p;
  const legacy = { ...v4Plan(), goal: "Recorded material" };
  if (version === 4) {
    p.plan = decodeWorkflowPlan(legacy);
    return p;
  }
  const {
    version: _version,
    assumptions,
    documents,
    reviewReads,
    policy,
    build: _build,
    links: _links,
    tasks,
    ...retained
  } = legacy;
  p.plan = decodeWorkflowPlan({
    ...retained,
    tasks: version === 3 ? tasks : tasks.map(({ reads, ...task }) => task),
    ...(version === 3
      ? { version, assumptions, documents, reviewReads, policy }
      : version === 2
        ? { version, knowledge: [] }
        : { projectContext: "Older context", repairAttempts: 2 }),
  });
  return p;
}

it.each([2, 3, 4, undefined, 5] as const)(
  "version %s: real title disclosure and workspace eligibility under matched and stale bindings",
  (version) => {
    const p = recordedProposal(version);
    f.state = {
      id: "chat",
      revision: 1,
      head: "turn-1",
      enabled: true,
      runs: [],
      proposal: p,
    };
    const command = vi.fn(),
      prepare = vi.fn();
    const client = new ServiceClient(transport({ workbenchCommand: command }));
    for (const disposition of ["approve", "validate", "restore"]) {
      f.catalog = {
        ...p.model,
        catalogId: disposition === "validate" ? "changed" : p.model.catalogId,
      };
      function Probe() {
        const [opened, setOpened] = useState(false);
        const tree = ChatWorkspace({
          client,
          id: "chat",
          workspaceId: "workspace",
          initialCwd: "/fixture",
          enabled: true,
          actionsReady: disposition !== "restore",
          prepareForPlan: prepare,
          modelAvailability: {
            status: "ready",
            epoch: "fixture",
            attachmentVersion: 1,
          },
          onModelChanged: f.no,
          onChanged: f.no,
          onReferenceUsed: f.no,
        });
        if (!opened) {
          toggleTitle(tree);
          setOpened(true);
        }
        return tree;
      }
      const html = renderToStaticMarkup(<Probe />);
      const card = html
        .split('class="workflow-plan"')[1]
        ?.split('class="chat-messages"')[0];
      expect(card).toContain(
        renderToStaticMarkup(<pre>{readableWorkflowPlan(p.plan)}</pre>),
      );
      if (version !== 5) {
        expect(card).toMatch(
          /class="plan-status" role="status">This plan is read-only. A new proposal is required for implementation.<\/p>/,
        );
        expect(card).not.toMatch(/<button|Awaiting plan approval/);
      } else {
        const label =
          disposition === "approve"
            ? "Implement this plan"
            : disposition === "validate"
              ? "Validate plan again"
              : "Restore execution and validate plan";
        expect(card).toMatch(
          new RegExp(`class="primary"[^>]*>${label}</button>`),
        );
        expect(card).not.toContain('disabled=""');
      }
    }
    f.catalog = undefined;
    expect(command).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  },
);

function composer(tree: ReturnType<typeof ChatWorkspace>) {
  const dock = Children.toArray(tree.props.children).find(
    (el) =>
      isValidElement<{ className?: string }>(el) &&
      el.props.className === "composer-dock",
  );
  if (!isValidElement<{ children: React.ReactNode }>(dock))
    throw Error("missing dock");
  const editor = Children.toArray(dock.props.children).find(
    (el) => isValidElement(el) && el.type === ChatComposer,
  );
  if (!isValidElement<ChatComposerProps>(editor)) throw Error("missing editor");
  return editor.props;
}

it.each(["clear then type", "full replacement"])(
  "only %s, not a whitespace edit to A's phrase, can confirm approvable B",
  async (reentry) => {
    const model = {
      ...proposal("").model,
      epoch: crypto.randomUUID(),
      catalogId: crypto.randomUUID(),
    };
    const first = decodeWorkflowProposal({
      ...proposal("Ship text export"),
      epoch: model.epoch,
      model,
    });
    const second = decodeWorkflowProposal({
      ...first,
      id: crypto.randomUUID(),
      digest: "c".repeat(64),
      plan: { ...first.plan, goal: "Replace export with import" },
    });
    const state = {
      id: "chat",
      head: "turn-1",
      revision: 1,
      enabled: true,
      proposal: first,
      runs: [],
    };
    f.state = state;
    f.catalog = model;
    const commands: WorkbenchCommand[] = [],
      grant = crypto.randomUUID(),
      prepare = vi.fn();
    let allowB = false;
    const client = new ServiceClient(
      transport({
        workbenchCommand: async (cmd) => {
          commands.push(cmd);
          if (
            !allowB ||
            (cmd.kind !== "cadence-prepare" &&
              cmd.kind !== "cadence-approve") ||
            cmd.conversationId !== state.id ||
            cmd.revision !== 2 ||
            cmd.proposalId !== second.id ||
            cmd.digest !== second.digest
          )
            throw Error("not the reviewed fixture proposal");
          if (commands.length === 1 && cmd.kind === "cadence-prepare")
            return {
              kind: "ok",
              value: {
                kind: "cadence-grant",
                commandId: cmd.commandId,
                revision: 2,
                proposal: second,
                expiresAt: Date.now() + 60_000,
                grant,
              },
            };
          if (
            commands.length === 2 &&
            cmd.kind === "cadence-approve" &&
            cmd.grant === grant
          )
            return {
              kind: "ok",
              value: { kind: "accepted", commandId: cmd.commandId },
            };
          throw Error("unexpected command");
        },
      }),
    );
    const phrase = "按计划实施";
    let submit: (() => void) | undefined;
    const reviewed: ReturnType<typeof ChatWorkspace>[] = [];
    function Probe() {
      const [step, advance] = useState(0);
      const tree = ChatWorkspace({
        client,
        id: "chat",
        workspaceId: first.id,
        initialCwd: "/fixture",
        enabled: true,
        modelAvailability: {
          status: "ready",
          epoch: model.epoch,
          attachmentVersion: 1,
        },
        prepareForPlan: prepare,
        prepareForSend: prepare,
        onModelChanged: f.no,
        onChanged: f.no,
        onReferenceUsed: f.no,
      });
      const edit = composer(tree),
        title = titleButton(tree),
        field = useField(edit);
      const refused = (expected: string) => {
        expect(edit.canSend).toBe(true);
        expect(edit.draft).toBe(expected);
        const before = currentToasts().at(-1)?.id;
        field.key("Enter");
        expect(currentToasts().at(-1)?.id).not.toBe(before);
        expect(currentToasts().at(-1)?.text).toContain(
          "Review it from the conversation title",
        );
        expect(commands).toEqual([]);
        expect(prepare).not.toHaveBeenCalled();
      };
      switch (step) {
        case 0:
          title.onClick();
          break;
        case 1:
          reviewed.push(tree);
          field.change(phrase);
          break;
        case 2:
          expect(edit.draft).toBe(phrase);
          f.state = { ...state, revision: 2, proposal: second };
          break;
        case 3:
        case 4:
          expect(title.title).toBe(second.plan.goal);
          expect(title["aria-expanded"]).toBe(step === 4);
          refused(phrase);
          if (step === 3) title.onClick();
          else {
            reviewed.push(tree);
            field.change(`${phrase} `, "insertText", " ");
          }
          break;
        case 5:
          refused(`${phrase} `);
          field.change(phrase, "deleteContentBackward");
          break;
        case 6:
          refused(phrase);
          field.change(`${phrase}\n`, "insertLineBreak");
          break;
        case 7:
          refused(`${phrase}\n`);
          field.change(phrase, "deleteContentBackward");
          break;
        case 8:
          refused(phrase);
          field.change(phrase.slice(0, -1), "deleteContentBackward");
          break;
        case 9:
          field.change(phrase, "insertText", phrase.slice(-1));
          break;
        case 10:
          refused(phrase);
          if (reentry === "clear then type")
            field.change("", "deleteContentBackward");
          else field.change(phrase, "insertText", phrase); // replace even identical text
          break;
        case 11:
          if (reentry === "clear then type") {
            expect(edit.draft).toBe("");
            field.change(phrase.slice(0, -1));
          }
          break;
        case 12:
          if (reentry === "clear then type")
            field.change(phrase, "insertText", phrase.slice(-1));
          break;
        case 13:
          // Whitespace must not lose B's own binding either.
          field.change(` ${phrase}`, "insertText", " ");
          break;
        case 14:
          // A poll returns new objects, not a new proposal or grant.
          f.state = structuredClone(f.state);
          f.catalog = structuredClone(f.catalog);
          break;
        default:
          expect(edit.draft).toBe(` ${phrase}`);
          submit = () => field.key("Enter");
          return tree;
      }
      advance(step + 1);
      return tree;
    }
    try {
      renderToStaticMarkup(<Probe />);
      expect(commands).toEqual([]);
      expect(reviewed).toHaveLength(2);
      for (const tree of reviewed)
        expect(renderToStaticMarkup(tree)).toMatch(
          /class="primary"(?![^>]*disabled)[^>]*>Implement this plan</,
        );
      if (!submit) throw Error("missing confirmation field");
      allowB = true;
      submit();
      await vi.waitFor(() =>
        expect(commands).toEqual([
          expect.objectContaining({
            kind: "cadence-prepare",
            proposalId: second.id,
            digest: second.digest,
            conversationId: "chat",
            revision: 2,
          }),
          expect.objectContaining({
            kind: "cadence-approve",
            proposalId: second.id,
            digest: second.digest,
            conversationId: "chat",
            revision: 2,
            grant,
          }),
        ]),
      );
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      f.catalog = undefined;
    }
  },
);

// Drive the composer's textarea handlers, retaining its recall cursor when the
// workspace re-renders. The native events here are fixtures, not a browser.
function useField(props: ChatComposerProps) {
  const form = ChatComposer(props);
  const field = Children.toArray(form.props.children).find(
    (el) => isValidElement(el) && el.type === "textarea",
  );
  if (
    !isValidElement<{
      onInput(event: unknown): void;
      onKeyDown(event: unknown): void;
    }>(field)
  )
    throw Error("missing textarea");
  const target = (value: string) => ({
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
  });
  return {
    change(
      value: string,
      inputType = "insertText",
      data: string | null = null,
    ) {
      field.props.onInput({
        currentTarget: target(value),
        nativeEvent: { inputType, data },
      });
    },
    key(key: string, altKey = false) {
      field.props.onKeyDown({
        key,
        altKey,
        currentTarget: target(props.draft),
        nativeEvent: {},
        preventDefault() {},
      });
    },
  };
}

function pressEnter(props: ChatComposerProps, altKey = false) {
  let field: ReturnType<typeof useField> | undefined;
  function Keys() {
    field = useField(props);
    return null;
  }
  renderToStaticMarkup(<Keys />);
  if (!field) throw Error("missing Enter handler");
  field.key("Enter", altKey);
}

function usePhraseWorkspace(
  client: ServiceClient,
  prepare: () => Promise<void>,
  preparePlan = prepare,
  reference?: string,
) {
  return ChatWorkspace({
    client,
    id: "chat",
    workspaceId: "workspace",
    initialCwd: "/fixture",
    enabled: true,
    modelAvailability: {
      status: "ready",
      epoch: f.state?.proposal?.epoch ?? "fixture",
      attachmentVersion: 1,
    },
    prepareForPlan: preparePlan,
    prepareForSend: prepare,
    reference,
    onModelChanged: f.no,
    onChanged: f.no,
    onReferenceUsed: f.no,
  });
}

function discussionFixture(version: ChoiceVersion) {
  const prepare = vi.fn(async () => {});
  const command = vi.fn(async (cmd: WorkbenchCommand) => ({
    kind: "ok",
    value: { kind: "accepted", commandId: cmd.commandId },
  }));
  const client = new ServiceClient(transport({ workbenchCommand: command }));
  const model = vi.spyOn(client, "models").mockResolvedValue({
    kind: "ok",
    value: {
      status: "complete",
      withheld: 0,
      remembered: null,
      entries: [],
      version: {
        ...version,
        epoch: crypto.randomUUID(),
        catalogId: crypto.randomUUID(),
        conversation: { id: "chat", cwd: "/fixture" },
      },
      selected: {
        provider: "fixture",
        model: "fixture",
        api: "openai-completions",
        thinking: "low",
        sourceSelectionId: crypto.randomUUID(),
      },
    },
  });
  return { client, command, prepare, model };
}

it.each([2, 3, undefined] as const)(
  "version %s: submitting to the collapsed read-only proposal explains the refusal; discussion still sends",
  async (version) => {
    const p = recordedProposal(version);
    f.state = {
      id: "chat",
      revision: 1,
      enabled: true,
      head: "turn-1",
      proposal: p,
      runs: [],
    };
    const { client, prepare, command, model } = discussionFixture(p.model);
    const phrase = "按计划实施",
      text = "Discuss another option.";
    let discussion: ChatComposerProps | undefined;
    function Probe() {
      const [step, advance] = useState(0);
      const tree = usePhraseWorkspace(client, prepare),
        editor = composer(tree);
      expect(titleButton(tree)["aria-expanded"]).toBe(false);
      if (!step) editor.onDraft(phrase);
      else if (step === 1) {
        const before = currentToasts().at(-1)?.id;
        expect(editor.canSend).toBe(true);
        editor.onSend();
        expect(currentToasts().at(-1)).toMatchObject({
          level: "error",
          text: "This plan is read-only. A new proposal is required for implementation.",
        });
        expect(currentToasts().at(-1)?.id).not.toBe(before);
      } else if (step === 2) {
        expect(editor.draft).toBe(phrase);
        editor.onDraft(text);
      } else {
        discussion = editor;
        return tree;
      }
      advance(step + 1);
      return tree;
    }
    renderToStaticMarkup(<Probe />);
    expect(command).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    if (!discussion) throw Error("missing discussion editor");
    pressEnter(discussion);
    await vi.waitFor(() =>
      expect(command.mock.calls.map(([c]) => c)).toEqual([
        expect.objectContaining({
          kind: "cadence-send",
          intent: "message",
          text,
        }),
      ]),
    );
  },
);

const phrase = "按计划实施";
const discussionText = "Discuss another option.";

function historyFixture(prompt: string, coldDraft?: string) {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) =>
      key === "cadence:prompt-history:workspace"
        ? JSON.stringify([prompt])
        : key === "cadence:draft:workspace:chat"
          ? (coldDraft ?? null)
          : null,
  });
}

it.each(["historyUndo", "historyRedo", "Escape", "ArrowDown"])(
  "%s restores A's text but not B's approval",
  (restore) => {
    const a = proposal("First agreement"),
      b = proposal("Replacement agreement");
    const state = {
      id: "chat",
      head: "turn-1",
      enabled: true,
      revision: 1,
      runs: [],
      proposal: a,
    };
    f.state = state;
    f.catalog = b.model;
    const native = restore.startsWith("history");
    const { client, command, prepare, model } = discussionFixture(b.model);
    historyFixture(native ? discussionText : phrase);
    function Probe() {
      const [step, advance] = useState(0);
      const tree = usePhraseWorkspace(client, prepare),
        edit = composer(tree),
        field = useField(edit);
      switch (step) {
        case 0:
          toggleTitle(tree);
          break;
        case 1:
          field.change(phrase);
          break;
        case 2:
          expect(edit.draft).toBe(phrase);
          if (native)
            field.change(
              discussionText,
              restore === "historyRedo" ? "historyUndo" : "insertText",
            );
          else field.key("ArrowUp");
          break;
        case 3:
          expect(edit.draft).toBe(native ? discussionText : phrase);
          if (native) field.change(phrase, restore);
          else {
            // A history selection never inherits even the currently reviewed A.
            field.key("Enter");
            expect(currentToasts().at(-1)?.text).toContain(
              "Review it from the conversation title",
            );
          }
          break;
        case 4:
          if (native) {
            // A is still displayed and actionable: native history can
            // restore text, but never the source of a plan confirmation.
            expect(edit.draft).toBe(phrase);
            const before = currentToasts().at(-1)?.id;
            field.key("Enter");
            expect(currentToasts().at(-1)?.id).not.toBe(before);
            expect(currentToasts().at(-1)?.text).toContain(
              "Review it from the conversation title",
            );
            field.change(discussionText, "insertText", discussionText);
          }
          f.state = { ...state, revision: 2, proposal: b };
          break;
        case 5:
          toggleTitle(tree);
          break;
        case 6:
          expect(titleButton(tree)).toMatchObject({
            title: b.plan.goal,
            "aria-expanded": true,
          });
          if (native) field.change(phrase, restore);
          else field.key(restore);
          break;
        case 7:
          expect(edit.canSend).toBe(true);
          expect(edit.draft).toBe(phrase);
          field.key("Enter");
          expect(currentToasts().at(-1)?.text).toContain(
            "Review it from the conversation title",
          );
          // The same old text must not fall back to an ordinary Send, even
          // when the native restoration happens after the mode has changed.
          if (native)
            field.change(discussionText, "insertText", discussionText);
          f.state = { ...state, revision: 3, enabled: false, proposal: null };
          break;
        case 8:
          if (native) field.change(phrase, restore);
          break;
        case 9:
          expect(edit.draft).toBe(phrase);
          field.key("Enter");
          expect(currentToasts().at(-1)?.text).toBe(
            "No plan is awaiting approval.",
          );
          break;
        default:
          expect(edit.draft).toBe(phrase);
          return null;
      }
      advance(step + 1);
      return null;
    }
    try {
      renderToStaticMarkup(<Probe />);
      expect(command).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(model).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      f.catalog = undefined;
    }
  },
);

it.each([
  "historyUndo",
  "historyRedo",
  "complete restored prefix",
  "Escape",
  "ArrowDown",
  "remove image",
])(
  "%s: a phrase typed as ordinary discussion sends once as its original text",
  async (restore) => {
    f.state = {
      id: "chat",
      head: "turn-1",
      enabled: false,
      revision: 1,
      runs: [],
      proposal: null,
    };
    const { client, command, prepare } = discussionFixture(proposal("").model);
    const image = new File(["image fixture"], "example.png", {
      type: "image/png",
    });
    // Down/Escape leave the selected prompt and return to our parked draft.
    const recalled = "approve and execute";
    historyFixture(recalled);
    let submit: (() => void) | undefined;
    function Probe() {
      const [step, advance] = useState(0);
      const edit = composer(usePhraseWorkspace(client, prepare)),
        field = useField(edit);
      if (restore === "remove image") {
        if (step === 0) edit.onAddImages([image]);
        if (step === 1) {
          expect(edit.images).toEqual([image]);
          field.change(phrase);
        }
        if (step === 2) edit.onRemoveImage(image);
      } else if (restore === "complete restored prefix") {
        if (step === 0) field.change("按计划", "insertText", "按计划");
        if (step === 1)
          field.change(discussionText, "insertText", discussionText);
        if (step === 2) field.change("按计划", "historyUndo");
        if (step === 3) {
          expect(edit.draft).toBe("按计划");
          field.change(phrase, "insertText", "实施");
        }
      } else if (restore === "historyUndo" || restore === "historyRedo") {
        const redo = restore === "historyRedo";
        if (step === 0) field.change(redo ? discussionText : phrase);
        if (step === 1) {
          const replacement = redo ? phrase : discussionText;
          field.change(replacement, "insertText", replacement);
        }
        if (step === 2)
          field.change(redo ? discussionText : phrase, "historyUndo");
        if (step === 3 && redo) {
          expect(edit.draft).toBe(discussionText);
          field.change(phrase, "historyRedo");
        }
      } else {
        if (step === 0) field.change(phrase);
        if (step === 1) field.key("ArrowUp");
        if (step === 2) {
          expect(edit.draft).toBe(recalled);
          field.key(restore);
        }
      }
      if (
        step ===
        (restore === "historyRedo" || restore === "complete restored prefix"
          ? 4
          : 3)
      ) {
        expect(edit.canSend).toBe(true);
        expect(edit.images).toEqual([]);
        expect(edit.draft).toBe(phrase);
        submit = () => field.key("Enter");
        return null;
      }
      advance(step + 1);
      return null;
    }
    try {
      renderToStaticMarkup(<Probe />);
      expect(prepare).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalled();
      if (!submit) throw Error("missing ordinary Send");
      submit();
      await vi.waitFor(() =>
        expect(command.mock.calls.map(([c]) => c)).toEqual([
          expect.objectContaining({
            kind: "send",
            text: phrase,
            conversationId: "chat",
          }),
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

// Keep the same React state across deferred transport replies. The probe
// renders no host nodes; browser layout and trusted keys are observed separately.
function descendant<P>(
  children: ReactNode,
  match: (e: ReactElement<P>) => boolean,
): P | undefined {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<P & { children?: ReactNode }>(child)) continue;
    if (match(child)) return child.props;
    const nested = descendant<P>(child.props.children, match);
    if (nested) return nested;
  }
}

function recoveryRoot() {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    location: new URL("http://localhost/app"),
    HTMLIFrameElement: class {},
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", f.no);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    ownerDocument: new EventTarget(),
  });
  return createRoot(container as unknown as HTMLElement);
}

function buttonIn(tree: ReactNode, label: string) {
  const button = descendant<{
    children?: ReactNode;
    "aria-label"?: string;
    title?: string;
    onClick(): void;
    disabled?: boolean;
  }>(
    tree,
    (e) =>
      e.type === "button" &&
      (e.props["aria-label"] === label ||
        e.props.title === label ||
        Children.toArray(e.props.children).includes(label)),
  );
  return button && !button.disabled ? button.onClick : undefined;
}

it.each(["reference", "cold draft", "replacement plan", "mode exit"])(
  "%s: local insertions preserve current discussion, never confer approval or re-author older text",
  async (path) => {
    const old = path === "replacement plan" || path === "mode exit";
    const a = proposal("First agreement");
    f.empty = !old;
    f.state = {
      id: "chat",
      revision: 1,
      enabled: old,
      head: old ? "turn-1" : null,
      runs: [],
      proposal: old ? a : null,
    };
    f.catalog = a.model;
    const { client, command, prepare } = discussionFixture(a.model);
    const root = recoveryRoot();
    let tree!: ReturnType<typeof ChatWorkspace>,
      field!: ReturnType<typeof useField>;
    function Probe({ reference }: { reference?: string }) {
      tree = usePhraseWorkspace(client, prepare, prepare, reference);
      field = useField(composer(tree));
      return null;
    }
    const draw = (reference?: string) =>
      act(async () => root.render(<Probe reference={reference} />));
    try {
      if (path === "cold draft")
        sessionStorage.setItem("cadence:draft:workspace:chat", phrase);
      await draw();
      if (old) await act(async () => toggleTitle(tree));
      if (path !== "cold draft")
        await act(async () => field.change(phrase, "insertText", phrase));
      if (old) {
        const b =
          path === "replacement plan"
            ? proposal("Replacement agreement")
            : null;
        f.state = { ...f.state, enabled: !!b, proposal: b, revision: 2 };
        await draw();
        if (b) await act(async () => toggleTitle(tree));
      }
      expect(composer(tree).draft).toBe(phrase);
      await draw("fixture.txt");
      expect(composer(tree).draft).toBe(`${phrase}\n@fixture.txt`);
      await act(async () => field.change(phrase, "deleteContentBackward"));
      expect(composer(tree).draft).toBe(phrase);
      expect(command).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      await act(async () => field.key("Enter"));
      if (path === "reference") {
        expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
          expect.objectContaining({
            kind: "send",
            text: phrase,
            conversationId: "chat",
          }),
        ]);
      } else {
        expect(command).not.toHaveBeenCalled();
        expect(prepare).not.toHaveBeenCalled();
        expect(currentToasts().at(-1)?.text).toContain(
          path === "replacement plan"
            ? "Review it from the conversation title"
            : "No plan is awaiting approval.",
        );
      }
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      f.catalog = undefined;
      f.empty = false;
    }
  },
);

it.each([
  "send",
  "steer",
  "queue",
  "changed turn",
  "changed epoch",
  "occupied",
  "unmatched receipt",
  "failed",
  "canceled",
  "append to draft",
  "append to previous turn draft",
])(
  "%s: explicit message recovery dispatches only the chosen discussion action",
  async (path) => {
    f.state = {
      id: "chat",
      head: "turn-1",
      enabled: false,
      revision: 1,
      runs: [],
      proposal: null,
    };
    const live = { commandId: crypto.randomUUID(), epoch: crypto.randomUUID() };
    f.live = path === "send" ? undefined : live;
    const { client, command, prepare } = discussionFixture(proposal("").model);
    const preparePlan = vi.fn(async () => {});
    const root = recoveryRoot();
    let field!: ReturnType<typeof useField>,
      editor!: ChatComposerProps,
      recall: (() => void) | undefined,
      restore: (() => void) | undefined;
    function Probe() {
      const tree = usePhraseWorkspace(client, prepare, preparePlan);
      editor = composer(tree);
      field = useField(editor);
      const waiting = descendant<Parameters<typeof WaitingMessages>[0]>(
        tree,
        (e) => e.type === WaitingMessages,
      );
      if (!waiting) throw Error("missing waiting list");
      const list = WaitingMessages(waiting);
      recall = buttonIn(list, "Withdraw and put back in the message box");
      restore = buttonIn(list, "Put back in the message box");
      return null;
    }
    const draw = () => act(async () => root.render(<Probe />));
    const target = {
      conversationId: "chat",
      turnId: live.commandId,
      epoch: live.epoch,
    };
    const submit = (alt = false) => act(async () => field.key("Enter", alt));
    try {
      await draw();
      await act(async () => field.change(phrase, "insertText", phrase));
      await submit(path !== "send");
      const first = command.mock.calls[0][0];
      expect(command).toHaveBeenCalledTimes(1);
      expect(editor.draft).toBe("");
      if (path === "send") {
        expect(first).toMatchObject({
          kind: "send",
          conversationId: "chat",
          text: phrase,
        });
        await act(async () => field.key("ArrowUp"));
        expect(editor.draft).toBe(phrase);
        expect(command).toHaveBeenCalledTimes(1);
        await submit();
        expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
          first,
          { ...first, commandId: expect.any(String) },
        ]);
        expect(command.mock.calls[1][0].commandId).not.toBe(first.commandId);
        return;
      }
      expect(first).toEqual({
        kind: "conversation-input",
        commandId: expect.any(String),
        ...target,
        mode: "queue",
        text: phrase,
      });
      f.pending = [{ commandId: first.commandId, mode: "queue", text: phrase }];
      await draw();
      if (
        path === "failed" ||
        path === "canceled" ||
        path.startsWith("append to")
      ) {
        if (path === "append to previous turn draft")
          await act(async () => field.change(discussionText));
        f.live = undefined;
        f.pending = [];
        f.undelivered = [
          {
            commandId: first.commandId,
            status: path === "canceled" ? path : "failed",
            text: phrase,
            notice: "Not delivered.",
          },
        ];
        await draw();
        if (path === "append to draft")
          await act(async () => field.change(discussionText));
        if (!restore) throw Error("missing undelivered action");
        await act(async () => restore?.());
        expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([first]);
        if (path.startsWith("append to")) {
          expect(editor.draft).toBe(`${discussionText}\n${phrase}`);
          await act(async () => field.change(phrase, "deleteContentBackward"));
        }
        expect(editor.draft).toBe(phrase);
        expect(command).toHaveBeenCalledTimes(1);
        await submit();
        if (path === "append to previous turn draft") {
          expect(currentToasts().at(-1)?.text).toBe(
            "No plan is awaiting approval.",
          );
          expect(command).toHaveBeenCalledTimes(1);
        } else {
          expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
            first,
            expect.objectContaining({
              kind: "send",
              conversationId: "chat",
              head: "leaf",
              text: phrase,
            }),
          ]);
        }
        return;
      }
      let release!: () => void;
      command.mockImplementationOnce(async (c) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          kind: "ok",
          value: {
            kind: "accepted",
            commandId:
              path === "unmatched receipt" ? crypto.randomUUID() : c.commandId,
          },
        };
      });
      if (!recall) throw Error("missing recall button");
      await act(async () => recall?.());
      const cancel = {
        kind: "conversation-input-cancel",
        commandId: expect.any(String),
        ...target,
        inputId: first.commandId,
      };
      expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([first, cancel]);
      expect(editor.draft).toBe(""); // no restoration before the exact receipt
      if (path === "changed turn")
        f.live = { ...live, commandId: crypto.randomUUID() };
      if (path === "changed epoch")
        f.live = { ...live, epoch: crypto.randomUUID() };
      if (path === "occupied") await act(async () => editor.onDraft(" "));
      f.pending = [];
      await draw();
      await act(async () => release());
      expect(command).toHaveBeenCalledTimes(2);
      if (path === "occupied" || path === "unmatched receipt") {
        expect(editor.draft).toBe(path === "occupied" ? " " : "");
        return;
      }
      expect(editor.draft).toBe(phrase);
      if (path === "changed turn" || path === "changed epoch") {
        expect(editor.input?.enabled).toBe(true);
        await submit(path === "changed epoch");
        expect(currentToasts().at(-1)?.text).toBe(
          "No plan is awaiting approval.",
        );
        expect(command).toHaveBeenCalledTimes(2);
        return;
      }
      await submit(path === "queue");
      expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
        first,
        cancel,
        {
          kind: "conversation-input",
          commandId: expect.any(String),
          ...target,
          mode: path,
          text: phrase,
        },
      ]);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      f.live = undefined;
      f.pending = [];
      f.undelivered = [];
      expect(preparePlan).not.toHaveBeenCalled();
    }
  },
);

it.each([
  "edit",
  "clipped edit",
  "superseded preview",
  "cancel edit",
  "cancel edit with image",
  "cancel unknown draft",
  "cancel cold edit",
])(
  "%s: historical message recovery changes the draft, not the command stream",
  async (path) => {
    f.state = {
      id: "chat",
      head: "turn-1",
      enabled: false,
      revision: 1,
      runs: [],
      proposal: null,
    };
    const cancel = path.startsWith("cancel"),
      cold = path === "cancel cold edit",
      unknown = path === "cancel unknown draft",
      withImage = path === "cancel edit with image" || cold;
    const clipped = path === "clipped edit" || path === "superseded preview";
    const preview = clipped
      ? "按计划"
      : cancel && !cold && !unknown
        ? discussionText
        : phrase;
    let resolve!: (result: { text: string; args: string }) => void;
    const detail = vi.fn(
      () =>
        new Promise<{ text: string; args: string }>((done) => {
          resolve = done;
        }),
    );
    f.turns = [
      {
        ordinal: 0,
        header: {
          id: "message",
          status: "completed",
          steps: 1,
          stable: 1,
          notice: "",
          at: 1,
          entry: "leaf",
          parent: "parent",
          omitted: { thinking: false, media: false, other: false },
        },
        steps: [
          {
            id: "user",
            role: "user",
            text: preview,
            clipped,
            name: "",
            target: "",
            error: false,
            parts: 1,
          },
        ],
        detail,
      },
    ];
    const { client, command, prepare } = discussionFixture(proposal("").model);
    const preparePlan = vi.fn(async () => {});
    const file = new File(["fixture"], "draft.png", { type: "image/png" });
    const root = recoveryRoot();
    let field!: ReturnType<typeof useField>,
      editor!: ChatComposerProps,
      edit: (() => void) | undefined;
    function Probe() {
      const tree = usePhraseWorkspace(client, prepare, preparePlan);
      editor = composer(tree);
      field = useField(editor);
      const row = descendant<ComponentProps<typeof ChatTurnView>>(
        tree,
        (e) => e.type === ChatTurnView,
      );
      if (!row) throw Error("missing historical turn");
      const body = (
        ChatTurnView as unknown as { type(props: typeof row): ReactNode }
      ).type(row);
      const action = descendant<ComponentProps<typeof MessageAction>>(
        body,
        (e) => e.type === MessageAction && e.props.label === "Edit and resend",
      );
      edit = action && buttonIn(MessageAction(action), "Edit and resend");
      return null;
    }
    const draw = (key: number) =>
      act(async () => root.render(<Probe key={key} />));
    try {
      if (unknown)
        sessionStorage.setItem("cadence:draft:workspace:chat", phrase);
      await draw(0);
      if (cancel && !unknown)
        await act(async () => field.change(phrase, "insertText", phrase));
      if (withImage) await act(async () => editor.onAddImages([file]));
      if (cancel) expect(editor.draft).toBe(phrase);
      if (!edit) throw Error("missing Edit and resend action");
      await act(async () => edit?.());
      expect(editor.draft).toBe(preview);
      expect(editor.images).toEqual([]);
      if (clipped) {
        expect(detail).toHaveBeenCalledTimes(1);
        if (path === "superseded preview") {
          // Even an identical user replacement is no longer the loaded preview.
          await act(async () => field.change(preview, "insertText", preview));
        }
        await act(async () => resolve({ text: phrase, args: "" }));
      }
      if (cancel) {
        if (cold) await draw(1); // same persisted anchor and text, no in-memory source
        const restore = buttonIn(
          editor.anchor,
          "Cancel and restore the draft that was here",
        );
        if (!restore) throw Error("missing Cancel edit action");
        await act(async () => restore());
        expect(editor.images).toEqual(withImage && !cold ? [file] : []);
        if (withImage && !cold)
          await act(async () => editor.onRemoveImage(file));
      }
      const text = path === "superseded preview" ? preview : phrase;
      expect(editor.draft).toBe(text);
      expect(command).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      await act(async () => field.key("Enter"));
      if (cold || unknown) {
        expect(command).not.toHaveBeenCalled();
        expect(currentToasts().at(-1)?.text).toBe(
          "No plan is awaiting approval.",
        );
        expect(prepare).not.toHaveBeenCalled();
      } else
        expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
          expect.objectContaining({
            kind: "send",
            head: cancel ? "leaf" : "parent",
            conversationId: "chat",
            text,
          }),
        ]);
      expect(preparePlan).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
      f.turns = [];
    }
  },
);

it.each(["identical recalled prompt", "mode round trip", "cold prefix"])(
  "%s: native history cannot borrow an ordinary origin for ambiguous or obsolete text",
  (conflict) => {
    const state = {
      id: "chat",
      head: "turn-1",
      enabled: false,
      revision: 1,
      runs: [],
      proposal: null,
    };
    f.state = state;
    const cold = conflict === "cold prefix";
    historyFixture(phrase, cold ? "按计划" : undefined);
    const { client, command, prepare, model } = discussionFixture(
      proposal("").model,
    );
    function Probe() {
      const [step, advance] = useState(0);
      const edit = composer(usePhraseWorkspace(client, prepare)),
        field = useField(edit);
      switch (step) {
        case 0:
          if (cold) expect(edit.draft).toBe("按计划");
          field.change(phrase, "insertText", phrase);
          break;
        case 1:
          if (conflict === "identical recalled prompt") field.key("ArrowUp");
          else if (!cold) f.state = { ...state, enabled: true, revision: 2 };
          break;
        case 2:
          field.change(discussionText, "insertText", discussionText);
          f.state = { ...state, revision: 3 };
          break;
        case 3:
          field.change(cold ? "按计划" : phrase, "historyUndo");
          break;
        case 4:
          if (cold) field.change(phrase, "insertText", "实施");
          else field.change(` ${phrase}`, "insertText", " ");
          break;
        default:
          expect(edit.canSend).toBe(true);
          expect(edit.draft).toBe(cold ? phrase : ` ${phrase}`);
          field.key("Enter");
          expect(currentToasts().at(-1)?.text).toBe(
            "No plan is awaiting approval.",
          );
          return null;
      }
      advance(step + 1);
      return null;
    }
    try {
      renderToStaticMarkup(<Probe />);
      expect(command).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(model).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  { mode: "steer", change: "poll" },
  { mode: "queue", change: "poll" },
  { mode: "steer", change: "commandId" },
  { mode: "queue", change: "epoch" },
])(
  "$mode after native undo and a new $change snapshot belongs only to the original live reply",
  async ({ mode, change }) => {
    f.state = {
      id: "chat",
      head: "turn-1",
      enabled: false,
      revision: 1,
      runs: [],
      proposal: null,
    };
    const live = { commandId: crypto.randomUUID(), epoch: crypto.randomUUID() };
    f.live = live;
    const { client, command, prepare } = discussionFixture(proposal("").model);
    let submit: (() => void) | undefined;
    function Probe() {
      const [step, advance] = useState(0);
      const edit = composer(usePhraseWorkspace(client, prepare)),
        field = useField(edit);
      switch (step) {
        case 0:
          field.change(phrase, "insertText", phrase);
          break;
        case 1:
          field.change(discussionText, "insertText", discussionText);
          f.live =
            change === "poll"
              ? { ...live }
              : { ...live, [change]: crypto.randomUUID() };
          break;
        case 2:
          field.change(phrase, "historyUndo");
          break;
        default:
          expect(edit.draft).toBe(phrase);
          expect(edit.input?.enabled).toBe(true);
          submit = () => field.key("Enter", mode === "queue");
          return null;
      }
      advance(step + 1);
      return null;
    }
    try {
      renderToStaticMarkup(<Probe />);
      expect(command).not.toHaveBeenCalled();
      if (!submit) throw Error("missing live input");
      const before = currentToasts().at(-1)?.id;
      submit();
      if (change === "poll") {
        await vi.waitFor(() =>
          expect(command.mock.calls.map(([c]) => c)).toEqual([
            {
              kind: "conversation-input",
              commandId: expect.any(String),
              conversationId: "chat",
              turnId: live.commandId,
              epoch: live.epoch,
              mode,
              text: phrase,
            },
          ]),
        );
      } else {
        expect(currentToasts().at(-1)?.id).not.toBe(before);
        expect(currentToasts().at(-1)?.text).toBe(
          "No plan is awaiting approval.",
        );
        expect(command).not.toHaveBeenCalled();
      }
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      f.live = undefined;
    }
  },
);

it("a failed mode read allows a newly typed ordinary Send but cannot convert a prior plan confirmation", async () => {
  const p = proposal("Review A");
  f.state = {
    id: "chat",
    revision: 1,
    enabled: true,
    proposal: p,
    runs: [],
    head: "turn-1",
  };
  const { client, command, prepare, model } = discussionFixture(p.model);
  const phrase = "按计划实施";
  let fresh: ChatComposerProps | undefined;
  function Probe() {
    const [step, advance] = useState(0);
    const tree = usePhraseWorkspace(client, prepare),
      edit = composer(tree);
    switch (step) {
      case 0:
        toggleTitle(tree);
        break;
      case 1:
        edit.onDraft(phrase);
        break;
      case 2:
        f.state = undefined;
        f.modeError = true;
        break;
      case 3:
        expect(edit.canSend).toBe(true);
        edit.onSend();
        break;
      case 4:
        expect(edit.draft).toBe(phrase);
        expect(prepare).not.toHaveBeenCalled();
        expect(command).not.toHaveBeenCalled();
        expect(model).not.toHaveBeenCalled();
        edit.onDraft("");
        break;
      case 5:
        edit.onDraft(phrase);
        break;
      default:
        fresh = edit;
        return tree;
    }
    advance(step + 1);
    return tree;
  }
  try {
    renderToStaticMarkup(<Probe />);
    if (!fresh?.canSend) throw Error("missing ordinary Send");
    pressEnter(fresh);
    await vi.waitFor(() =>
      expect(command.mock.calls.map(([c]) => c)).toEqual([
        expect.objectContaining({
          kind: "send",
          text: phrase,
          conversationId: "chat",
        }),
      ]),
    );
  } finally {
    f.modeError = false;
  }
});

it.each(["steer", "queue"])(
  "%s: a failed mode read cannot repurpose an approval draft or block fresh input to a live turn",
  async (mode) => {
    const p = proposal("Review A");
    f.state = {
      id: "chat",
      revision: 1,
      enabled: true,
      head: "turn-1",
      proposal: p,
      runs: [],
    };
    const phrase = "按计划实施",
      live = { commandId: crypto.randomUUID(), epoch: crypto.randomUUID() };
    const prepare = vi.fn(async () => {});
    const command = vi.fn(async (cmd: WorkbenchCommand) => ({
      kind: "ok",
      value: { kind: "accepted", commandId: cmd.commandId },
    }));
    const client = new ServiceClient(transport({ workbenchCommand: command }));
    let fresh: ChatComposerProps | undefined;
    function Probe() {
      const [step, advance] = useState(0);
      const tree = usePhraseWorkspace(client, prepare),
        edit = composer(tree);
      switch (step) {
        case 0:
          toggleTitle(tree);
          break;
        case 1:
          edit.onDraft(phrase);
          break;
        case 2:
          f.live = live;
          f.modeError = true;
          break;
        case 3:
          expect(edit.input?.enabled).toBe(true);
          expect(edit.draft).toBe(phrase);
          edit.input?.onInput("steer");
          expect(command).not.toHaveBeenCalled();
          expect(currentToasts().at(-1)?.text).toContain(
            "Review it from the conversation title",
          );
          break;
        case 4:
          expect(edit.draft).toBe(phrase);
          edit.onDraft("");
          break;
        case 5:
          edit.onDraft(phrase);
          break;
        default:
          fresh = edit;
          return tree;
      }
      advance(step + 1);
      return tree;
    }
    try {
      renderToStaticMarkup(<Probe />);
      if (!fresh?.input?.enabled) throw Error("missing live input");
      pressEnter(fresh, mode === "queue");
      await vi.waitFor(() =>
        expect(command.mock.calls.map(([c]) => c)).toEqual([
          expect.objectContaining({
            kind: "conversation-input",
            mode,
            text: phrase,
            conversationId: "chat",
            turnId: live.commandId,
            epoch: live.epoch,
          }),
        ]),
      );
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      f.live = undefined;
      f.modeError = false;
    }
  },
);

it("approving a plan clears pending exit, and toggling off refuses a stale approval phrase without silent reinterpretation", async () => {
  const model = {
    ...proposal("").model,
    epoch: crypto.randomUUID(),
    catalogId: crypto.randomUUID(),
    conversation: { id: "chat", cwd: "/fixture" },
  };
  const p = decodeWorkflowProposal({
    ...proposal("Review before exit"),
    epoch: model.epoch,
    model,
  });
  f.state = {
    id: "chat",
    revision: 1,
    enabled: true,
    head: "turn-1",
    proposal: p,
    runs: [],
  };
  f.catalog = model;
  const grant = crypto.randomUUID();
  const prepare = vi.fn(async () => {});
  const command = vi.fn(async (cmd: WorkbenchCommand) =>
    cmd.kind === "cadence-prepare"
      ? {
          kind: "ok" as const,
          value: {
            kind: "cadence-grant" as const,
            commandId: cmd.commandId,
            revision: f.state?.revision ?? 0,
            proposal: p,
            expiresAt: Date.now() + 60_000,
            grant,
          },
        }
      : {
          kind: "ok" as const,
          value: { kind: "accepted" as const, commandId: cmd.commandId },
        },
  );
  const client = new ServiceClient(transport({ workbenchCommand: command }));
  vi.spyOn(client, "models").mockResolvedValue({
    kind: "ok",
    value: {
      status: "complete",
      withheld: 0,
      remembered: null,
      entries: [],
      version: model,
      selected: {
        provider: "fixture",
        model: "fixture",
        api: "openai-completions",
        thinking: "low",
        sourceSelectionId: crypto.randomUUID(),
      },
    },
  });
  const root = recoveryRoot();
  let tree!: ReturnType<typeof ChatWorkspace>,
    field!: ReturnType<typeof useField>;
  function Probe() {
    tree = usePhraseWorkspace(client, prepare, prepare);
    field = useField(composer(tree));
    return null;
  }
  const draw = () => act(async () => root.render(<Probe />));
  try {
    await draw();
    // 1. Enter approval phrase in Cadence mode, then toggle Cadence OFF.
    await act(async () => toggleTitle(tree));
    await act(async () => field.change(phrase, "insertText", phrase));
    await act(async () => composer(tree).cadence.onClick());
    expect(composer(tree).cadence.armed).toBe(false);
    // Sending the pre-toggle approval phrase must refuse with an exit-specific notice.
    await act(async () => field.key("Enter"));
    expect(command).not.toHaveBeenCalled();
    expect(currentToasts().at(-1)?.text).toContain(
      "before turning Cadence off",
    );
    // Re-entering the text after toggling OFF sends as an atomic ordinary exit-send.
    await act(async () => field.change("", "deleteContentBackward"));
    await act(async () => field.change(phrase, "insertText", phrase));
    await act(async () => field.key("Enter"));
    expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
      expect.objectContaining({
        kind: "send",
        text: phrase,
        exitRevision: 1,
      }),
    ]);

    // 2. Approving a plan clears a lingering pending exit so the next message stays in Cadence.
    command.mockClear();
    f.state = {
      id: "chat",
      revision: 2,
      enabled: true,
      head: "turn-2",
      proposal: p,
      runs: [],
    };
    await draw();
    await act(async () => toggleTitle(tree));
    await act(async () => composer(tree).cadence.onClick());
    expect(composer(tree).cadence.armed).toBe(false);
    const planCard = descendant<{ onApprove(): void; canApprove?: boolean }>(
      tree,
      (e) => typeof e.props.onApprove === "function",
    );
    if (!planCard?.canApprove) throw Error("missing approvable PlanCard");
    await act(async () => planCard.onApprove());
    expect(command.mock.calls.map(([cmd]) => cmd.kind)).toEqual([
      "cadence-prepare",
      "cadence-approve",
    ]);
    // After approval, pending exit is gone and the toggle stays ON.
    expect(composer(tree).cadence.armed).toBe(true);
    command.mockClear();
    await act(async () =>
      field.change("Check status", "insertText", "Check status"),
    );
    await act(async () => field.key("Enter"));
    expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
      expect.objectContaining({
        kind: "cadence-send",
        intent: "message",
        text: "Check status",
      }),
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    f.catalog = undefined;
  }
});
