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
      state: () => ({ head: null, enabled: kind !== "send" }),
      send: (_request: unknown, accepting?: () => void) => refuse(accepting),
    },
    conversations: {
      attempted: () => prior,
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
