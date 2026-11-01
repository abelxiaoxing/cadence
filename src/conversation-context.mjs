/** Private ordinary-chat context. No Pi session import, hidden thinking or provider envelopes. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  closed,
  integer,
  LIMITS,
  list,
  oneOf,
  parseWireJson,
  text,
} from "./worker-public.mjs";
import { DetailSanitizer, sanitizeText } from "./worker-redaction.mjs";

export const CONTEXT_BYTES = 2 * 1024 * 1024;
// One message/pipe record, not the lifetime context. Same logical body bound as capture.
export const CONTEXT_RECORD_BYTES = LIMITS.detailBytes;
const clean = (s, secrets, max = CONTEXT_RECORD_BYTES) =>
  sanitizeText(text(s, max), secrets);
function argumentsData(value, secrets) {
  const sanitizer = new DetailSanitizer("canonical-json", secrets);
  const source =
    sanitizer.write(canonicalJson(value, CONTEXT_RECORD_BYTES)) +
    sanitizer.end();
  if (sanitizer.limited) throw new Error("Unsupported context arguments");
  return parseWireJson(source, CONTEXT_RECORD_BYTES);
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
function readPrivateContext(path, maximum) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.nlink !== 1 ||
      st.size > maximum ||
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
      after.mtimeMs !== st.mtimeMs ||
      after.ctimeMs !== st.ctimeMs ||
      lstatSync(path).ino !== st.ino
    )
      throw new Error("Changed context file");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, size),
    );
  } finally {
    closeSync(fd);
  }
}
/** Old checkpoints remain readable without migration. New checkpoints hash-chain
 * private per-message records, so no aggregate JSON/pipe size is required. */
export function* iterateConversationContext(path) {
  if (path === null) return;
  const source = readPrivateContext(path, CONTEXT_BYTES);
  const value = parseWireJson(source, CONTEXT_BYTES);
  if (value.schema === "cadence-conversation-context/1") {
    const o = closed(value, ["schema", "messages"]);
    yield* conversationMessages(o.messages);
    return;
  }
  const o = closed(value, ["schema", "messages", "head"]);
  if (o.schema !== "cadence-conversation-context/2")
    throw new Error("Invalid context format");
  const count = integer(o.messages, 0);
  let head = null;
  for (let index = 0; index < count; index++) {
    const body = readPrivateContext(
      join(dirname(path), `context-${index}.json`),
      CONTEXT_RECORD_BYTES,
    );
    const record = closed(parseWireJson(body, CONTEXT_RECORD_BYTES), [
      "schema",
      "index",
      "previous",
      "message",
    ]);
    if (
      record.schema !== "cadence-conversation-message/1" ||
      record.index !== index ||
      record.previous !== head
    )
      throw new Error("Invalid context chain");
    head = createHash("sha256").update(body).digest("hex");
    yield conversationMessages([record.message])[0];
  }
  if (o.head !== head) throw new Error("Changed context chain");
}
export function readConversationContext(path) {
  return [...iterateConversationContext(path)];
}
/** Anonymous pipe framing: each message is bounded, the stream is not. The
 * owner sanitizes each record again before persisting it and commits only on
 * the end marker plus original successful process closure. */
export function* conversationContextRecords(messages, secrets = []) {
  if (!Array.isArray(messages)) throw new Error("Invalid context");
  let count = 0;
  for (const message of messages) {
    yield `${canonicalJson(
      {
        schema: "cadence-conversation-stream/1",
        message: conversationMessages([message], secrets)[0],
      },
      CONTEXT_RECORD_BYTES - 4096,
    )}\n`;
    count++;
  }
  yield canonicalJson({ schema: "cadence-conversation-stream-end/1", count }) +
    "\n";
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
