import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ServiceClient } from "../../src/service-client.ts";
import {
  type ModelCatalog,
  publicError,
  type Reply,
} from "../../src/service-contract.ts";
import {
  assertSendModel,
  captureSend,
  dispatchSend,
  draftKey,
  installSendModel,
  sendCommand,
  sendFailureMessage,
  withSendModel,
} from "../../web/src/client/conversation-send";
import { transport } from "./fixtures";

const model = {
  epoch: randomUUID(),
  accessGeneration: 1,
  configRev: 1,
  catalogId: randomUUID(),
};
afterEach(() => vi.unstubAllGlobals());
it("startup/model waits keep the exact original message, head, mode revision and command identity", () => {
  const input = {
    id: randomUUID(),
    head: randomUUID(),
    text: "original goal",
    revision: 7,
    intent: "message" as const,
  };
  const waiting = captureSend(input);
  input.head = randomUUID();
  input.text = "later draft";
  input.revision = 8;
  const command = sendCommand(waiting, model);
  expect(command).toMatchObject({
    kind: "cadence-send",
    head: waiting.command.head,
    text: "original goal",
    revision: 7,
    intent: "message",
    model,
  });
  expect(Object.isFrozen(waiting.command)).toBe(true);
  expect(sendCommand(waiting, { ...model, configRev: 2 })).toMatchObject({
    commandId: command.commandId,
    head: waiting.command.head,
    revision: 7,
    text: "original goal",
  });
});
it("ordinary Send stays ordinary and exit needs neither a model nor an approval grant", () => {
  const base = { id: randomUUID(), head: null, text: "hello", revision: 0 };
  expect(
    sendCommand(captureSend({ ...base, intent: "ordinary" }), model),
  ).toMatchObject({ kind: "send", text: "hello" });
  expect(
    sendCommand(captureSend({ ...base, text: "exit cadence", intent: "exit" })),
  ).toMatchObject({ kind: "cadence-exit", revision: 0 });
  expect(() =>
    sendCommand(captureSend({ ...base, intent: "enter" })),
  ).toThrow();
  expect(() =>
    captureSend({ ...base, intent: "ordinary", text: "字".repeat(16384) }),
  ).toThrow();
});
it("draft lookup keeps existing namespaces and never copies, clears or resurrects an intentionally empty draft", () => {
  const values = new Map<string, string>();
  const writes = vi.fn();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: writes,
    removeItem: writes,
  });
  const id = randomUUID(),
    old = `cadence:draft:old:${id}`,
    primary = `cadence:draft:directory:${id}`;
  values.set(`${old}:pending`, randomUUID());
  expect(draftKey("directory", id, "old")).toBe(old);
  expect(
    draftKey("checkout:/root", id, "unknown", "old", "other-directory"),
  ).toBe(old);
  values.set(primary, "");
  expect(draftKey("directory", id, "old")).toBe(primary);
  expect(writes).not.toHaveBeenCalled();
});

it("a pending Send pins cwd and the shown model; an explicit picker continuation cannot change its other fields", () => {
  const location = { id: randomUUID(), cwd: "/checkout/a" };
  const choice = {
    provider: "p",
    model: "a",
    api: "openai-completions" as const,
    thinking: "off" as const,
  };
  const pending = captureSend({
    id: location.id,
    head: randomUUID(),
    text: "original",
    revision: 3,
    intent: "message",
    location,
    model: choice,
  });
  location.cwd = "/checkout/b";
  choice.model = "b";
  expect(pending.location?.cwd).toBe("/checkout/a");
  expect(() => assertSendModel(pending, choice)).toThrow("stale");
  expect(() =>
    sendCommand(pending, { ...model, conversation: location }),
  ).toThrow("stale");
  const selected = withSendModel(pending, choice);
  expect(selected.command).toBe(pending.command);
  expect(selected.location).toBe(pending.location);
  expect(() => assertSendModel(selected, choice)).not.toThrow();
  const exit = captureSend({
    id: location.id,
    head: null,
    text: "exit cadence",
    revision: 3,
    intent: "exit",
    location,
  });
  expect(sendCommand(exit)).toMatchObject({ kind: "cadence-exit", location });
});

it.each(["lost", "uncertain", "none"])(
  "final Send %s retains draft/context and only reliable effect:none clears the original pending ID",
  async (outcome) => {
    const intent = captureSend({
      id: randomUUID(),
      head: randomUUID(),
      text: "kept draft",
      revision: 8,
      intent: "message",
    });
    const command = sendCommand(intent, model);
    const call = vi.fn(async () => {
      if (outcome === "lost") throw new Error("reply lost");
      return {
        kind: "error",
        error: publicError(
          "unavailable",
          outcome === "none" ? "none" : "uncertain",
        ),
      };
    });
    const client = new ServiceClient(transport({ workbenchCommand: call }));
    const pending = vi.fn();
    const reply = await dispatchSend(client, command, pending);
    expect(call.mock.calls).toHaveLength(1);
    expect(call).toHaveBeenCalledWith(command);
    expect(pending.mock.calls).toEqual(
      outcome === "none" ? [[command.commandId], [""]] : [[command.commandId]],
    );
    expect(intent.text).toBe("kept draft");
    expect(intent.command).toMatchObject({
      commandId: command.commandId,
      head: command.head,
      revision: 8,
    });
    expect(reply.kind).toBe("error");
    if (reply.kind === "error") {
      expect(sendFailureMessage(reply.error.effect)).toContain(
        outcome === "none" ? "not accepted" : "original command",
      );
      expect(sendFailureMessage(reply.error.effect)).not.toContain("16 KiB");
    }
  },
);

function preselected() {
  const choice = {
    provider: "fixture",
    model: "chosen",
    api: "openai-completions",
    thinking: "high",
  } as const;
  const location = { id: "conversation", cwd: "/project" };
  const intent = captureSend({
    id: location.id,
    location,
    text: "original",
    head: null,
    revision: 1,
    intent: "ordinary",
    model: choice,
    installModel: true,
  });
  const catalog: ModelCatalog = {
    version: { ...model, conversation: location },
    selected: null,
    remembered: null,
    status: "complete",
    withheld: 0,
    entries: [
      {
        ...choice,
        thinking: [{ level: "high", selectable: true }],
        eligibility: "candidate",
      },
    ],
  };
  const selected = { ...choice, sourceSelectionId: "fresh-source" };
  const client = {
    chooseModel: vi.fn(async () => ({
      kind: "ok" as const,
      value: { version: catalog.version, selected },
    })),
    models: vi.fn(
      async (): Promise<Reply<ModelCatalog>> => ({
        kind: "ok" as const,
        value: { ...catalog, selected },
      }),
    ),
  };
  return { choice, location, intent, catalog, selected, client };
}
it("Send installs only its captured preselection against a fresh live catalog, without changing message identity", async () => {
  const f = preselected();
  const result = await installSendModel(
    f.client,
    f.intent,
    f.catalog,
    () => true,
  );
  expect(f.client.chooseModel).toHaveBeenCalledExactlyOnceWith(
    { expected: f.catalog.version, choice: f.choice },
    f.location,
  );
  expect(f.client.models).toHaveBeenCalledExactlyOnceWith(
    undefined,
    f.location,
  );
  expect(result.selected).toEqual(f.selected);
  expect(sendCommand(f.intent, result.version)).toMatchObject({
    text: "original",
    commandId: f.intent.command.commandId,
    conversationId: f.location.id,
  });
  expect(f.intent.installModel).toBe(true);
});
it("an unavailable preselection refuses without substitution, startup replay or a model write", async () => {
  const f = preselected();
  await expect(
    installSendModel(
      f.client,
      f.intent,
      { ...f.catalog, entries: [] },
      () => true,
    ),
  ).rejects.toThrow("unsupported-context");
  expect(f.client.chooseModel).not.toHaveBeenCalled();
  expect(f.client.models).not.toHaveBeenCalled();
});
it("a choice lost or made obsolete while installing never continues a message", async () => {
  const f = preselected();
  let current = true;
  f.client.chooseModel.mockImplementationOnce(async () => {
    current = false;
    return {
      kind: "ok",
      value: { version: f.catalog.version, selected: f.selected },
    };
  });
  await expect(
    installSendModel(f.client, f.intent, f.catalog, () => current),
  ).rejects.toThrow("stale");
  expect(f.client.models).not.toHaveBeenCalled();
  const client = {
    ...f.client,
    chooseModel: vi.fn(async () => ({
      kind: "error" as const,
      error: publicError("unavailable", "uncertain"),
    })),
  };
  await expect(
    installSendModel(client, f.intent, f.catalog, () => true),
  ).rejects.toThrow("unavailable");
  expect(client.chooseModel).toHaveBeenCalledTimes(1);
  expect(f.intent.text).toBe("original");
});
it("a confirmed choice still cannot substitute a different observed model", async () => {
  const f = preselected();
  f.client.models.mockResolvedValueOnce({
    kind: "ok",
    value: {
      ...f.catalog,
      selected: { ...f.selected, model: "another-model" },
    },
  });
  await expect(
    installSendModel(f.client, f.intent, f.catalog, () => true),
  ).rejects.toThrow("stale");
});
it("an already installed exact preselection needs no mutation, and remembered models never acquire preselection authority", async () => {
  const f = preselected();
  const catalog = { ...f.catalog, selected: f.selected };
  expect(await installSendModel(f.client, f.intent, catalog, () => true)).toBe(
    catalog,
  );
  expect(
    await installSendModel(
      f.client,
      { ...f.intent, installModel: false },
      f.catalog,
      () => true,
    ),
  ).toBe(f.catalog);
  expect(f.client.chooseModel).not.toHaveBeenCalled();
});

it("a new owner or choice revision after installation cannot rebind the waiting Send", async () => {
  for (const version of [
    { ...model, epoch: "replacement" },
    { ...model, configRev: 2 },
  ]) {
    const f = preselected();
    f.client.models.mockResolvedValueOnce({
      kind: "ok",
      value: {
        ...f.catalog,
        selected: f.selected,
        version: { ...version, conversation: f.location },
      },
    });
    await expect(
      installSendModel(f.client, f.intent, f.catalog, () => true),
    ).rejects.toThrow("stale");
  }
});
