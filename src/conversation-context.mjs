/** Private ordinary-chat context. No Pi session import, hidden thinking or provider envelopes. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import {
  canonicalJson,
  closed,
  integer,
  list,
  oneOf,
  parseWireJson,
  text,
} from "./worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "./worker-redaction.mjs";

export const CONTEXT_BYTES = 2 * 1024 * 1024;
const clean = (s, secrets, max = CONTEXT_BYTES) =>
  sanitizeText(text(s, max), secrets);
function argumentsData(value, secrets) {
  const sanitizer = new DetailSanitizer("canonical-json", secrets);
  const source =
    sanitizer.write(canonicalJson(value, 64 * 1024)) + sanitizer.end();
  if (sanitizer.limited) throw new Error("Unsupported context arguments");
  return parseWireJson(source, 64 * 1024);
}
function own(value, key) {
  const d =
    value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, key)
      : undefined;
  if (!d || !("value" in d)) throw new Error("Invalid usage");
  return d.value;
}
// Pi adds optional usage breakdowns per provider and release (reasoning, cacheWrite1h);
// retain only the counts every assistant message carries, read as own data properties.
function counts(value, keys) {
  const out = Object.create(null);
  for (const key of keys) {
    const n = own(value, key);
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0)
      throw new Error("Invalid usage");
    out[key] = n;
  }
  return out;
}
/** Deliberately retain text and tool exchanges, not just last assistant prose. */
export function conversationMessages(messages, secrets = []) {
  return list(messages, 4096, (message) => {
    if (!message || typeof message !== "object")
      throw new Error("Invalid context");
    const role = oneOf(message.role, ["user", "assistant", "toolResult"]);
    const timestamp = integer(message.timestamp, 0);
    const content =
      typeof message.content === "string"
        ? [{ type: "text", text: clean(message.content, secrets) }]
        : list(message.content, 256, (block) => {
            if (block.type === "text")
              return { type: "text", text: clean(block.text, secrets) };
            if (role === "assistant" && block.type === "toolCall")
              return {
                type: "toolCall",
                id: clean(block.id, secrets, 512),
                name: clean(block.name, secrets, 128),
                arguments: argumentsData(block.arguments, secrets),
              };
            // Images, hidden thinking and opaque provider signatures never become retained context.
            return null;
          }).filter(Boolean);
    if (role === "user") return { role, timestamp, content };
    if (role === "toolResult")
      return {
        role,
        timestamp,
        content,
        toolCallId: clean(message.toolCallId, secrets, 512),
        toolName: clean(message.toolName, secrets, 128),
        isError: message.isError === true,
      };
    const usage = counts(message.usage, [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "totalTokens",
    ]);
    usage.cost = counts(own(message.usage, "cost"), [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "total",
    ]);
    return {
      role,
      timestamp,
      content,
      api: clean(message.api, secrets, 128),
      provider: clean(message.provider, secrets, 128),
      model: clean(message.model, secrets, 256),
      usage,
      stopReason: oneOf(message.stopReason, [
        "stop",
        "length",
        "toolUse",
        "error",
        "aborted",
      ]),
    };
  });
}
export function readConversationContext(path) {
  if (path === null) return [];
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.nlink !== 1 ||
      st.size > CONTEXT_BYTES ||
      (process.platform !== "win32" &&
        (st.mode & 0o077 || st.uid !== process.getuid()))
    )
      throw new Error("Invalid context file");
    const buffer = Buffer.alloc(st.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    const after = fstatSync(fd);
    if (
      size !== st.size ||
      after.size !== st.size ||
      after.mtimeMs !== st.mtimeMs
    )
      throw new Error("Changed context file");
    const o = closed(
      parseWireJson(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, size),
        ),
        CONTEXT_BYTES,
      ),
      ["schema", "messages"],
    );
    if (o.schema !== "cadence-conversation-context/1")
      throw new Error("Invalid context format");
    return conversationMessages(o.messages);
  } finally {
    closeSync(fd);
  }
}
export function encodeConversationContext(messages, secrets) {
  return canonicalJson(
    {
      schema: "cadence-conversation-context/1",
      messages: conversationMessages(messages, secrets),
    },
    CONTEXT_BYTES,
  );
}
