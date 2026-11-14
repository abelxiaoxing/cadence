import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ConversationContext } from "../../src/service/contracts/models.ts";
import type {
  CadenceConversation,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  approveWorkflow,
  cadenceApproval,
  planAction,
  revalidateWorkflow,
} from "../../web/src/client/workflow-entry";
import { PlanCard } from "../../web/src/components/workspace/WorkflowPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { plan } from "../helpers/workflow-plan.ts";
import { transport } from "./fixtures";

function fixture() {
  const id = randomUUID();
  const context = {
    id,
    cwd: "/fixture",
    revision: 1,
    model: {
      provider: "fixture",
      model: "fixed",
      api: "openai-completions",
      thinking: "off",
    },
  } satisfies ConversationContext;
  const version = {
    conversation: { id, cwd: context.cwd },
    epoch: randomUUID(),
    accessGeneration: 1,
    configRev: 2,
    catalogId: randomUUID(),
  };
  const state = {
    id,
    revision: 3,
    enabled: true,
    head: randomUUID(),
    runs: [],
    proposal: {
      id: randomUUID(),
      epoch: version.epoch,
      digest: "a".repeat(64),
      observation: "b".repeat(64),
      cwd: context.cwd,
      checkoutRoot: context.cwd,
      model: version,
      plan: plan(),
      display: {
        model: "fixture/fixed · off",
        branch: "main",
        baseCommit: "1".repeat(40),
        runtime: "Original runtime",
      },
    },
  } satisfies CadenceConversation;
  const original = structuredClone(state);
  const nextVersion = {
    ...version,
    epoch: randomUUID(),
    catalogId: randomUUID(),
  };
  const commands: WorkbenchCommand[] = [];
  let after: CadenceConversation | undefined;
  let lost = false;
  let alter: ((state: CadenceConversation) => void) | undefined;
  const client = new ServiceClient({
    ...transport(),
    workbenchRead: async (request) => {
      if (request.kind !== "conversation-models")
        throw Error("unexpected read");
      return {
        kind: "ok",
        value: {
          kind: "conversation-models",
          catalog: {
            selected: null,
            version: nextVersion,
            status: "complete",
            entries: [],
            withheld: 0,
            remembered: null,
          },
        },
      };
    },
    workbenchCommand: async (command) => {
      commands.push(command);
      if (lost) throw Error("response lost");
      if (command.kind === "cadence-revalidate") {
        after = {
          ...structuredClone(original),
          revision: original.revision + 1,
          proposal: {
            ...original.proposal,
            id: command.commandId,
            revalidatedFrom: original.proposal.id,
            epoch: nextVersion.epoch,
            model: nextVersion,
          },
        };
        alter?.(after);
        return {
          kind: "ok",
          value: {
            kind: "cadence-revalidated",
            commandId: command.commandId,
            state: after,
          },
        };
      }
      if (command.kind === "cadence-prepare")
        return {
          kind: "ok",
          value: {
            kind: "cadence-grant",
            commandId: command.commandId,
            proposal: after?.proposal,
            revision: after?.revision,
            grant: randomUUID(),
            expiresAt: Date.now() + 120000,
          },
        };
      if (command.kind === "cadence-approve")
        return {
          kind: "ok",
          value: { kind: "accepted", commandId: command.commandId },
        };
      throw Error("must not send a message or call a native workflow");
    },
  });
  const options = {
    client,
    state,
    context,
    model: context.model,
    head: "abcdef01",
    signal: new AbortController().signal,
    current: () => true,
  };
  return {
    state,
    context,
    version,
    nextVersion,
    commands,
    client,
    options,
    lose: () => {
      lost = true;
    },
    alter: (fn: (state: CadenceConversation) => void) => {
      alter = fn;
    },
  };
}

it("stopped-owner validation prepares once, pins the original intent, and ends without approval until a second explicit action", async () => {
  const f = fixture();
  expect(cadenceApproval("按计划实施")).toBe(true);
  expect(planAction(f.state.proposal, false)).toBe("restore");
  const prepare = vi.fn(async () => {});
  const next = await revalidateWorkflow({ ...f.options, prepare });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(f.commands.map((c) => c.kind)).toEqual(["cadence-revalidate"]);
  expect(f.commands[0]).toMatchObject({
    revision: f.state.revision,
    proposalId: f.state.proposal?.id,
    digest: f.state.proposal?.digest,
    context: f.context,
    head: "abcdef01",
    expected: f.nextVersion,
  });
  expect(next.proposal?.plan).toEqual(f.state.proposal?.plan);
  if (!next.proposal) throw Error("validated proposal");
  expect(planAction(next.proposal, true, f.nextVersion)).toBe("approve");
  await approveWorkflow({
    client: f.client,
    state: next,
    current: () => true,
    submitting: () => {},
  });
  expect(f.commands.map((c) => c.kind)).toEqual([
    "cadence-revalidate",
    "cadence-prepare",
    "cadence-approve",
  ]);
});

it.each(["departure", "context"])(
  "%s during owner preparation cannot continue into model installation, validation or execution",
  async (changed) => {
    const f = fixture();
    const abort = new AbortController();
    let current = true;
    await expect(
      revalidateWorkflow({
        ...f.options,
        signal: abort.signal,
        current: () => current,
        prepare: async () => {
          if (changed === "departure") abort.abort();
          else current = false;
        },
      }),
    ).rejects.toThrow("stale");
    expect(f.commands).toEqual([]);
  },
);

it("preparation cannot rebase the captured plan, context, model or head", async () => {
  const f = fixture();
  const original = structuredClone({
    state: f.state,
    context: f.context,
    model: f.options.model,
    head: f.options.head,
  });
  const options = {
    ...f.options,
    prepare: async () => {
      f.state.revision++;
      f.context.revision++;
      f.options.model.model = "another model";
      options.head = "abcdef02";
    },
  };
  await revalidateWorkflow(options);
  expect(f.commands[0]).toMatchObject({
    revision: original.state.revision,
    context: original.context,
    model: original.model,
    head: original.head,
  });
});

it("a lost validation response is not retried or converted into approval", async () => {
  const f = fixture();
  f.lose();
  await expect(revalidateWorkflow(f.options)).rejects.toThrow("unavailable");
  expect(f.commands.map((c) => c.kind)).toEqual(["cadence-revalidate"]);
});

it.each(["plan", "conversation", "revision", "parent", "epoch", "head"])(
  "a changed %s in a validation response is never approved",
  async (changed) => {
    const f = fixture();
    f.alter((state) => {
      if (!state.proposal) throw Error("fixture proposal");
      if (changed === "plan") state.proposal.plan.goal = "different agreement";
      if (changed === "conversation") state.id = randomUUID();
      if (changed === "revision") state.revision++;
      if (changed === "parent") state.proposal.revalidatedFrom = randomUUID();
      if (changed === "epoch") state.proposal.epoch = randomUUID();
      if (changed === "head") state.head = randomUUID();
    });
    await expect(revalidateWorkflow(f.options)).rejects.toThrow("stale");
    expect(f.commands.map((c) => c.kind)).toEqual(["cadence-revalidate"]);
  },
);

it("departure after validation dispatch abandons the reply without undoing or approving the recorded binding", async () => {
  const f = fixture();
  let current = true;
  f.alter(() => {
    current = false;
  });
  await expect(
    revalidateWorkflow({ ...f.options, current: () => current }),
  ).rejects.toThrow("stale");
  expect(f.commands.map((c) => c.kind)).toEqual(["cadence-revalidate"]);
});

it("readiness and plan binding are independent; a replaced model/owner or rejected observation needs explicit validation", () => {
  const f = fixture();
  expect(planAction(f.state.proposal, true, f.version)).toBe("approve");
  expect(planAction(f.state.proposal, true, f.nextVersion)).toBe("validate");
  expect(planAction(f.state.proposal, true, f.version, true)).toBe("validate");
});

it.each(["en", "zh"] as const)(
  "%s plan cards offer recovery without a message and display revalidated context before fresh confirmation",
  (locale) => {
    const f = fixture();
    const restore = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <PlanCard
          proposal={f.state.proposal}
          canApprove={false}
          action="restore"
          canValidate
          onValidate={() => {}}
          onApprove={() => {
            throw Error("approval");
          }}
        />
      </LocaleProvider>,
    );
    expect(restore).toContain(
      locale === "en"
        ? "Restore execution and validate plan"
        : "恢复执行服务并核验计划",
    );
    expect(restore).not.toContain("disabled");
    const next = {
      ...f.state.proposal,
      revalidatedFrom: f.state.proposal.id,
      observation: "c".repeat(64),
      display: {
        ...f.state.proposal.display,
        branch: "release",
        runtime: "Current runtime",
      },
    };
    const current = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <PlanCard
          proposal={next}
          previous={f.state.proposal}
          canApprove
          onApprove={() => {}}
        />
      </LocaleProvider>,
    );
    expect(current).toContain(
      locale === "en" ? "Confirm implementation" : "确认实施",
    );
    expect(current).toContain(
      locale === "en" ? "Nothing was approved" : "尚未批准任何实施",
    );
    expect(current).toContain("Original runtime");
    expect(current).toContain("Current runtime");
    expect(current).toContain("release");
  },
);
