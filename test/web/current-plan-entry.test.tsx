// Drive only the title disclosure and new readonly snapshots. React's own SSR
// render-phase updates let us examine the next render with the same local state.
import { Children, isValidElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CadenceConversation } from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { ChatWorkspace } from "../../web/src/components/workspace/ChatWorkspace";
import { plan } from "../helpers/workflow-plan";
import { transport } from "./fixtures";

const f = vi.hoisted(() => ({
  state: undefined as CadenceConversation | undefined,
  no: () => {},
}));
vi.mock("../../web/src/client/use-workbench", async (load) => ({
  ...(await load<typeof import("../../web/src/client/use-workbench")>()),
  useWorkbench: (_: unknown, r: { kind: string } | null) => ({
    refresh: f.no,
    value:
      r?.kind === "cadence-conversation"
        ? { kind: r.kind, state: f.state }
        : undefined,
  }),
}));
vi.mock("../../web/src/client/use-conversation", () => ({
  useConversation: () => ({
    summary: {
      id: "chat",
      title: "Fixture discussion",
      status: "completed",
      origin: "webui",
    },
    leaf: "leaf",
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
      modelAvailability: { status: "stopped" },
      prepareForPlan: prepare,
      onChanged: f.no,
      onReferenceUsed: f.no,
      onModelChanged: f.no,
    });
    snapshots.push(tree);
    if (!f.state) throw Error("missing observation");
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
    switch (n) {
      case 0:
      case 1:
      case 2:
      case 4:
      case 6:
        trigger.props.onClick();
        break;
      case 3:
        f.state = { ...f.state, revision: 2, head: "turn-2" };
        break;
      case 5:
        f.state = { ...f.state, revision: 3, proposal: replacement };
        break;
      default:
        return tree;
    }
    advance(n + 1);
    return tree;
  }
  renderToStaticMarkup(<Probe />);
  expect(snapshots).toHaveLength(8);
  for (const [index, tree] of snapshots.entries()) {
    const html = renderToStaticMarkup(tree);
    const expanded = [1, 3, 5, 7].includes(index);
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
  function Cold() {
    return (
      <ChatWorkspace
        client={client}
        id="chat"
        workspaceId="project"
        enabled
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
