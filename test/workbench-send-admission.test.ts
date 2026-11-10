import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import type { WorkbenchCommand } from "../src/service/contracts/workbench.ts";
import { Workbench } from "../src/service/workbench.ts";
import { UnacceptedConversationCommand } from "../src/service/workbench-send-refusal.ts";

// Fault-injection unit seam: the real registration/persistence marker is tested
// separately through generated-owner HTTP. No fake native-success qualification.
function fixture(
  kind: "send" | "cadence-send" | "cadence-exit",
  prior: boolean,
  afterAcceptance: boolean,
) {
  const commandId = randomUUID(),
    conversationId = randomUUID();
  const model = {
    epoch: randomUUID(),
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const common = { commandId, conversationId, head: null };
  const request: WorkbenchCommand =
    kind === "cadence-exit"
      ? { kind, ...common, revision: 0 }
      : kind === "send"
        ? { kind, ...common, text: "hello", model }
        : {
            kind,
            ...common,
            text: "hello",
            model,
            revision: 0,
            intent: "message",
          };
  const refuse = (accepting?: () => void) => {
    if (afterAcceptance) accepting?.();
    throw new ContractError("stale");
  };
  const workbench = Object.assign(Object.create(Workbench.prototype), {
    o: {
      owner: { state: "idle" },
      choice: { snapshot: () => ({ version: model }) },
    },
    cadence: {
      records: { state: () => ({ head: null, enabled: kind !== "send" }) },
      send: (_request: unknown, accepting?: () => void) => refuse(accepting),
    },
    conversations: {
      attempted: () => prior,
      receipt: () => undefined,
      send: (_request: unknown, _control: unknown, accepting?: () => void) =>
        refuse(accepting),
    },
  }) as Workbench;
  return () => workbench.command(request);
}

it.each(["send", "cadence-send", "cadence-exit"] as const)(
  "%s distinguishes fresh pre-acceptance refusal from prior/partial acceptance",
  (kind) => {
    expect(fixture(kind, false, false)).toThrow(UnacceptedConversationCommand);
    for (const invoke of [
      fixture(kind, true, false),
      fixture(kind, false, true),
    ]) {
      try {
        invoke();
        throw Error("must refuse");
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError);
        expect(error).not.toBeInstanceOf(UnacceptedConversationCommand);
      }
    }
  },
);

// A message for a running reply binds that run: in Cadence mode it must be
// the coordinator turn the mode names. A withdrawal changes one record.
function inputFixture(
  o: {
    prior?: boolean;
    receipt?: boolean;
    cadence?: { enabled: boolean; head: string | null; notice?: string };
  } = {},
) {
  const run = {
    commandId: randomUUID(),
    conversationId: randomUUID(),
    turnId: randomUUID(),
    epoch: randomUUID(),
  };
  const owner = { state: "idle" };
  const admitted: boolean[] = [];
  let admission: (accepting?: () => void) => unknown = () => ({
    kind: "accepted",
  });
  let withdrawal: () => unknown = () => ({ kind: "accepted" });
  const workbench = Object.assign(Object.create(Workbench.prototype), {
    o: { owner },
    cadence: {
      records: { state: () => o.cadence ?? { enabled: false, head: null } },
    },
    conversations: {
      attempted: () => !!o.prior,
      receipt: () => (o.receipt ? { kind: "accepted" } : undefined),
      input(_request: unknown, coordinator: boolean, accepting?: () => void) {
        admitted.push(coordinator);
        return admission(accepting);
      },
      cancelInput: () => withdrawal(),
    },
  }) as Workbench;
  return {
    owner,
    admitted,
    turnId: run.turnId,
    refuseInput(afterAcceptance: boolean) {
      admission = (accepting) => {
        if (afterAcceptance) accepting?.();
        throw new ContractError("stale");
      };
    },
    withdrawal(next: () => unknown) {
      withdrawal = next;
    },
    input: (turnId = run.turnId) =>
      workbench.command({
        kind: "conversation-input",
        ...run,
        turnId,
        mode: "steer",
        text: "Steer",
      }),
    withdraw: () =>
      workbench.command({
        kind: "conversation-input-cancel",
        ...run,
        inputId: randomUUID(),
      }),
  };
}
const refusal = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return {
      code: error.code,
      unaccepted: error instanceof UnacceptedConversationCommand,
    };
  }
  throw Error("must refuse");
};
it("a message for a running reply joins the run its conversation's mode admits, and a fresh refusal has no effect", async () => {
  const ordinary = inputFixture();
  expect(ordinary.input()).toEqual({ kind: "accepted" });
  expect(ordinary.admitted).toEqual([false]);
  // Cadence mode names its coordinator turn: only that run takes a message,
  // and takes it as a coordinator's.
  const turnId = randomUUID();
  const mode = inputFixture({ cadence: { enabled: true, head: turnId } });
  expect(await refusal(() => mode.input())).toEqual({
    code: "stale",
    unaccepted: true,
  });
  expect(mode.admitted).toEqual([]);
  expect(mode.input(turnId)).toEqual({ kind: "accepted" });
  expect(mode.admitted).toEqual([true]);
  // An unusable control record refuses every command of its conversation,
  // but a lost reply still observes its original acceptance first.
  const cadence = { enabled: false, head: null, notice: "unusable" };
  const degraded = inputFixture({ cadence });
  expect(await refusal(() => degraded.input())).toEqual({
    code: "corrupt-selected",
    unaccepted: true,
  });
  expect(degraded.admitted).toEqual([]);
  expect(inputFixture({ cadence, receipt: true }).input()).toEqual({
    kind: "accepted",
  });
  for (const [o, afterAcceptance, unaccepted] of [
    [{}, false, true],
    [{ prior: true }, false, false],
    [{}, true, false],
  ] as const) {
    const f = inputFixture(o);
    f.refuseInput(afterAcceptance);
    expect(await refusal(() => f.input())).toEqual({
      code: "stale",
      unaccepted,
    });
  }
});
it("a refused withdrawal changed nothing; only a failed record write leaves it uncertain", async () => {
  const f = inputFixture();
  expect(f.withdraw()).toEqual({ kind: "accepted" });
  f.withdrawal(() => {
    throw new ContractError("invalid");
  });
  expect(await refusal(f.withdraw)).toEqual({
    code: "invalid",
    unaccepted: true,
  });
  // The worker's answer arrives later: Pi already had the message.
  f.withdrawal(() => Promise.reject(new ContractError("conflict")));
  expect(await refusal(f.withdraw)).toEqual({
    code: "conflict",
    unaccepted: true,
  });
  // A record write that failed has quarantined the owner.
  f.withdrawal(() => {
    f.owner.state = "quarantined";
    throw new ContractError("corrupt-selected");
  });
  expect(await refusal(f.withdraw)).toEqual({
    code: "corrupt-selected",
    unaccepted: false,
  });
});
