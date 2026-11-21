import assert from "node:assert/strict";
import { CombinedAutocompleteProvider, Editor } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, it } from "vitest";
import { CadenceUserInput, registerCadenceMode } from "../src/cadence-mode.ts";
import {
  registerHistoryShell,
  TerminalEntryLatch,
} from "../src/history-shell.ts";
import { NativeConnection } from "../src/native-client.ts";
import { commandTerminalInput } from "../src/native-command-input.ts";

let child;
beforeEach(() => {
  child = process.env.CADENCE_SUBAGENT_CHILD;
  delete process.env.CADENCE_SUBAGENT_CHILD;
});
afterEach(() => {
  if (child === undefined) delete process.env.CADENCE_SUBAGENT_CHILD;
  else process.env.CADENCE_SUBAGENT_CHILD = child;
});

function host(command) {
  const events = new Map();
  const commands = new Map();
  const listeners = new Set();
  const messages = [];
  const notices = [];
  let tools = ["read"];
  const pi = {
    on(name, handler) {
      events.set(name, [...(events.get(name) ?? []), handler]);
    },
    registerCommand: (name, value) => commands.set(name, value),
    registerTool() {},
    getActiveTools: () => tools,
    setActiveTools: (value) => {
      tools = value;
    },
    appendEntry() {},
    sendMessage: (value) => messages.push(value),
    sendUserMessage: (value) => messages.push(value),
  };
  const editor = new Editor(
    { requestRender() {} },
    { borderColor: (value) => value, selectList: {} },
  );
  const base = new CombinedAutocompleteProvider(
    [{ name: "cadence" }, { name: "cadence-history" }],
    process.cwd(),
  );
  let suggestion;
  let ready;
  const suggestions = new Promise((resolve) => {
    ready = resolve;
  });
  let provider = {
    getSuggestions: async (...args) => {
      const result = await base.getSuggestions(...args);
      suggestion = result;
      queueMicrotask(ready);
      return result;
    },
    applyCompletion: (...args) => base.applyCompletion(...args),
  };
  const ctx = {
    cwd: process.cwd(),
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    isProjectTrusted: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => [], getSessionId: () => "fixture" },
    ui: {
      getEditorText: () => editor.getText(),
      onTerminalInput: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      addAutocompleteProvider: (factory) => {
        provider = factory(provider);
      },
      setStatus() {},
      notify: (value) => notices.push(value),
    },
  };
  registerHistoryShell(pi);
  registerCadenceMode(pi);
  let submitted;
  editor.onSubmit = (text) => {
    const [name, ...args] = text.split(" ");
    submitted = commands.get(name.slice(1)).handler(args.join(" "), ctx);
  };
  return {
    editor,
    messages,
    notices,
    get suggestion() {
      return suggestion;
    },
    async start() {
      for (const fn of events.get("session_start") ?? []) await fn({}, ctx);
      editor.setAutocompleteProvider(provider);
    },
    async typePrefix() {
      editor.handleInput(command === "cadence" ? "/caden" : "/cadence-his");
      await suggestions;
      // Let the actual editor apply its awaited suggestion list.
      await new Promise((resolve) => setImmediate(resolve));
    },
    key(data) {
      for (const fn of listeners) fn(data);
      editor.handleInput(data);
      return submitted;
    },
    async stop() {
      for (const fn of events.get("session_shutdown") ?? []) await fn({}, ctx);
    },
  };
}

for (const command of ["cadence", "cadence-history"]) {
  for (const method of ["Enter", "Tab then Enter", "typed Enter"]) {
    it(`${method} admits /${command} through the actual editor and both registrars`, async () => {
      const h = host(command);
      const attach = NativeConnection.prototype.attach;
      NativeConnection.prototype.attach = async () => {
        h.notices.push("history-opened");
        throw new Error("Controlled attachment refusal; no service access");
      };
      try {
        await h.start();
        if (method === "typed Enter") h.editor.setText(`/${command}`);
        else {
          await h.typePrefix();
          assert.ok(h.suggestion.items.some((item) => item.value === command));
          if (method === "Tab then Enter") {
            h.key("\t");
            assert.equal(h.messages.length, 0);
            assert.equal(h.notices.length, 0);
            assert.equal(h.editor.getText(), `/${command} `);
          }
        }
        await h.key("\r");
        assert.equal(h.editor.getText(), "");
        if (command === "cadence")
          assert.ok(
            h.messages.some((message) => message.customType === "cadence-mode"),
          );
        else assert.ok(h.notices.includes("history-opened"));
      } finally {
        await h.stop();
        NativeConnection.prototype.attach = attach;
      }
    });
  }
}

for (const command of ["cadence", "cadence-history"]) {
  it(`/${command} completion keeps raw input, exact arguments, expiry and single-use guards`, async () => {
    const latch =
      command === "cadence"
        ? new CadenceUserInput()
        : new TerminalEntryLatch(command);
    const consume = (args, at) =>
      command === "cadence"
        ? latch.consumeCommand(args, at)
        : latch.consume(args, at);
    const prefix = "/caden";
    let text = prefix;
    let eligible = true;
    let listener;
    let provider = new CombinedAutocompleteProvider(
      [{ name: command }],
      process.cwd(),
    );
    const stop = commandTerminalInput(
      {
        ui: {
          getEditorText: () => text,
          addAutocompleteProvider: (wrap) => {
            provider = wrap(provider);
          },
          onTerminalInput: (fn) => {
            listener = fn;
            return () => {};
          },
        },
      },
      command,
      (data) => latch.input(data, text, eligible, 100),
      (before, after) => latch.completeCommand(before, after),
    );
    const complete = (value = command, source = text) =>
      provider.applyCompletion(
        [source],
        0,
        prefix.length,
        { value, label: value },
        prefix,
      );
    // No Enter, Tab alone, paste Enter or ineligible Enter cannot create proof.
    complete();
    assert.equal(consume("", 100), false);
    for (const key of ["\t", "\x1b[200~\r"]) {
      listener(key);
      complete();
      assert.equal(consume("", 100), false);
      listener("\x1b[201~");
    }
    eligible = false;
    listener("\r");
    complete();
    assert.equal(consume("", 100), false);
    eligible = true;
    // A completion outside this input dispatch cannot adopt an old Enter.
    listener("\r");
    await Promise.resolve();
    complete();
    assert.equal(consume("", 100), false);
    // Another key or navigation retires the original proof.
    listener("\r");
    listener("x");
    complete();
    assert.equal(consume("", 100), false);
    listener("\r");
    latch.clear();
    complete();
    assert.equal(consume("", 100), false);
    // Different source text and another command cannot borrow it.
    listener("\r");
    complete(command, "/other");
    assert.equal(consume("", 100), false);
    listener("\r");
    complete("other");
    assert.equal(consume("", 100), false);
    // Completion must not renew the 1500 ms window.
    listener("\r");
    complete();
    assert.equal(consume("", 1600), false);
    listener("\r");
    complete();
    assert.equal(consume("", 99), false);
    // Preserve the suffix at the cursor and bind the complete submitted args.
    text = `${prefix}goal`;
    listener("\r");
    complete();
    assert.equal(consume("different", 100), false);
    listener("\r");
    complete();
    assert.equal(consume("goal", 1599), true);
    assert.equal(consume("goal", 1599), false);
    // Disposal disables even a completion in the same dispatch.
    text = prefix;
    listener("\r");
    stop();
    complete();
    assert.equal(consume("", 100), false);
  });
}
