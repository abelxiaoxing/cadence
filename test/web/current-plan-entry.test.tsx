// React's own SSR render-phase updates let us examine the next render with the
// same workspace state. All command transports below are in-memory fixtures.
import { Children, isValidElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ChoiceVersion } from "../../src/service/contracts/models.ts";
import type {
  CadenceConversation,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import {
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  readableWorkflowPlan,
} from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  ChatComposer,
  type ChatComposerProps,
} from "../../web/src/components/workspace/ChatComposer";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { currentToasts } from "../../web/src/layout/toasts";
import { plan } from "../helpers/workflow-plan";
import { transport } from "./fixtures";

const f = vi.hoisted(() => ({
  state: undefined as CadenceConversation | undefined,
  pinned: false,
  catalog: undefined as ChoiceVersion | undefined,
  no: () => {},
}));
vi.mock("../../web/src/client/use-workbench", async (load) => ({
  ...(await load<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_: unknown, r: { kind: string } | null) => ({
    refresh: f.no,
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
    summary: {
      id: "chat",
      title: "Fixture discussion",
      status: "completed",
      origin: "webui",
      leaf: "leaf",
    },
    pinned: f.pinned,
    leaf: f.pinned ? "earlier-leaf" : "leaf",
    turns: [],
    runs: [],
    pending: [],
    undelivered: [],
    commands: [],
    count: 1,
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

it.each([2, undefined, 3] as const)(
  "version %s: real title disclosure and workspace eligibility under matched and stale bindings",
  (version) => {
    const p = proposal("Recorded material");
    if (version !== 3) {
      const {
        version: _version,
        assumptions,
        documents,
        reviewReads,
        policy,
        tasks,
        ...retained
      } = p.plan;
      p.plan = decodeWorkflowPlan({
        ...retained,
        tasks: tasks.map(({ reads, ...task }) => task),
        ...(version === 2
          ? { version, knowledge: [] }
          : { projectContext: "Older context", repairAttempts: 2 }),
      });
    }
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
      if (version !== 3) {
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

it("Enter cannot transfer A's phrase to approvable B; a fresh edit after reviewing B names only B", async () => {
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
          (cmd.kind !== "cadence-prepare" && cmd.kind !== "cadence-approve") ||
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
  let fresh: ChatComposerProps | undefined;
  const reviewed: ReturnType<typeof ChatWorkspace>[] = [];
  function Probe() {
    const [step, advance] = useState(0);
    const tree = ChatWorkspace({
      client,
      id: "chat",
      workspaceId: "workspace",
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
      title = titleButton(tree);
    switch (step) {
      case 0:
        title.onClick();
        break;
      case 1:
        reviewed.push(tree);
        edit.onDraft(phrase);
        break;
      case 2:
        expect(edit.draft).toBe(phrase);
        f.state = { ...state, revision: 2, proposal: second };
        break;
      case 3:
      case 4:
        expect(title.title).toBe(second.plan.goal);
        expect(title["aria-expanded"]).toBe(step === 4);
        expect(edit.canSend).toBe(true);
        expect(edit.draft).toBe(phrase);
        edit.onSend();
        expect(currentToasts().at(-1)?.text).toContain(
          "Review it from the conversation title",
        );
        expect(commands).toEqual([]);
        if (step === 3) title.onClick();
        else {
          reviewed.push(tree);
          edit.onDraft("");
        }
        break;
      case 5:
        edit.onDraft(phrase);
        break;
      case 6:
        // A poll returns new objects, not a new proposal or grant.
        f.state = structuredClone(f.state);
        f.catalog = structuredClone(f.catalog);
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
    expect(commands).toEqual([]);
    expect(reviewed).toHaveLength(2);
    for (const tree of reviewed)
      expect(renderToStaticMarkup(tree)).toMatch(
        /class="primary"(?![^>]*disabled)[^>]*>Implement this plan</,
      );
    expect(fresh?.draft).toBe(phrase);
    allowB = true;
    fresh?.onSend();
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
});
