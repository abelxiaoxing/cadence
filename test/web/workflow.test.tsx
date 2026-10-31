import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type {
  CadenceConversation,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../web/src/client/workflow-entry";
import { WorkflowPanel } from "../../web/src/components/workspace/WorkflowPanel";
import { plan } from "../helpers/workflow-plan.ts";
import { transport } from "./fixtures";

function state(): CadenceConversation {
  return {
    id: randomUUID(),
    revision: 3,
    enabled: true,
    head: randomUUID(),
    runs: [],
    proposal: {
      id: randomUUID(),
      epoch: randomUUID(),
      digest: "a".repeat(64),
      observation: "b".repeat(64),
      cwd: "/fixture",
      plan: plan(),
      model: {
        epoch: randomUUID(),
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
    },
  };
}
function client(
  s: CadenceConversation,
  change?: (c: WorkbenchCommand) => void,
) {
  const commands: WorkbenchCommand[] = [];
  const api = new ServiceClient({
    ...transport(),
    workbenchCommand: async (c) => {
      commands.push(c);
      change?.(c);
      return {
        kind: "ok",
        value:
          c.kind === "cadence-prepare"
            ? {
                kind: "cadence-grant",
                commandId: c.commandId,
                revision: s.revision,
                proposal: s.proposal,
                grant: randomUUID(),
                expiresAt: Date.now() + 120000,
              }
            : { kind: "accepted", commandId: c.commandId },
      };
    },
  });
  return { api, commands };
}
it("one explicit approval prepares and submits the exact displayed revision, persisting identity before submission", async () => {
  const s = state();
  let attempted = "";
  const c = client(s, (request) => {
    if (request.kind === "cadence-approve")
      expect(attempted).toBe(request.commandId);
  });
  await approveWorkflow({
    client: c.api,
    state: s,
    current: () => true,
    submitting: (id) => {
      attempted = id;
    },
  });
  expect(c.commands.map((c) => c.kind)).toEqual([
    "cadence-prepare",
    "cadence-approve",
  ]);
});
it("departure during preparation never starts accepted work", async () => {
  const s = state();
  let current = true;
  const c = client(s, () => {
    current = false;
  });
  await expect(
    approveWorkflow({
      client: c.api,
      state: s,
      current: () => current,
      submitting: () => {
        throw Error("must not submit");
      },
    }),
  ).rejects.toThrow("stale");
  expect(c.commands).toHaveLength(1);
});
it("a different plan returned by preparation is not silently approved", async () => {
  const s = state(),
    other = state(),
    c = client(other);
  await expect(
    approveWorkflow({
      client: c.api,
      state: s,
      current: () => true,
      submitting: () => {},
    }),
  ).rejects.toThrow("stale");
  expect(c.commands).toHaveLength(1);
});
it("only exact unquoted approval/exit inputs are action intents", () => {
  expect(cadenceApproval("按计划实施")).toBe(true);
  expect(cadenceExit("退出 Cadence")).toBe(true);
  for (const text of [
    "好的",
    "他说按计划实施",
    "`按计划实施`",
    "```\nexit cadence\n```",
    "请解释退出 Cadence",
  ]) {
    expect(cadenceApproval(text)).toBe(false);
    expect(cadenceExit(text)).toBe(false);
  }
});
it("plan cards expose actual checks and local delivery, not old Save/Start/Review steps", () => {
  const s = state();
  const html = renderToStaticMarkup(
    <WorkflowPanel
      client={new ServiceClient(transport())}
      state={s}
      pending=""
      canApprove={false}
      onApprove={() => {}}
      onChanged={() => {}}
    />,
  );
  expect(html).toContain("Implement this plan");
  expect(html).toContain("No push, publication or deployment");
  expect(html).toContain("disabled");
  expect(html).not.toContain("Confirm start");
});
