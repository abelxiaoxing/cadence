import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertSendModel,
  captureSend,
  draftKey,
  sendCommand,
  withSendModel,
} from "../../web/src/client/conversation-send";

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
