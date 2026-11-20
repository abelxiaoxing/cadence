// Drive only the title disclosure and new readonly snapshots. React's own SSR
// render-phase updates let us examine the next render with the same local state.
import { Children, isValidElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ChoiceVersion } from "../../src/service/contracts/models.ts";
import type { CadenceConversation } from "../../src/service/contracts/workbench.ts";
import {
  decodeWorkflowPlan,
  readableWorkflowPlan,
} from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
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

function toggleTitle(tree: ReturnType<typeof ChatWorkspace>) {
  // Only a header button is driven, never the plan's action controls.
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
  if (!isValidElement<{ onClick(): void }>(trigger))
    throw Error("missing trigger");
  trigger.props.onClick();
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
