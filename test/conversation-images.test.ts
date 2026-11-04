import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  decodeImageBase64,
  IMAGE_LIMITS,
  validateImageBytes,
} from "../src/image-content.mjs";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
  type ImageSend,
} from "../src/service/contracts/workbench.ts";
import { ConversationImages } from "../src/service/conversation-images.ts";
import { PNG, pngBytes } from "./helpers/images.ts";

const caller = {
  attachmentId: randomUUID(),
  authority: "browser" as const,
  accessGeneration: 1,
};
const send = (): ImageSend => ({
  kind: "send",
  commandId: randomUUID(),
  conversationId: randomUUID(),
  head: null,
  text: "",
  model: {
    epoch: randomUUID(),
    catalogId: randomUUID(),
    configRev: 1,
    accessGeneration: 1,
  },
});
const upload = (command: ImageSend, imageId = randomUUID()) => ({
  kind: "image-upload" as const,
  commandId: randomUUID(),
  imageId,
  send: command,
  mimeType: "image/png",
  size: pngBytes().length,
  offset: 0,
  data: PNG,
});

it("closed image uploads/reads keep existing control bounds and forbid nested uploads", () => {
  const c = upload(send());
  expect(decodeWorkbenchCommand(c)).toEqual(c);
  const media = {
    kind: "conversation-image",
    id: c.send.conversationId,
    leaf: null,
    entry: c.send.commandId,
    index: 0,
    offset: 0,
  };
  expect(decodeWorkbenchRead({ ...media, live: true })).toMatchObject({
    live: true,
  });
  expect(() => decodeWorkbenchRead({ ...media, live: false })).toThrow();
  expect(() => decodeWorkbenchCommand({ ...c, send: c })).toThrow();
  expect(() =>
    decodeWorkbenchCommand({ ...c, path: "/tmp/user.png" }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({ ...c, size: IMAGE_LIMITS.bytes + 1 }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({
      ...c,
      data: "x".repeat(IMAGE_LIMITS.chunkChars + 1),
    }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({ ...c, mimeType: "image/svg+xml" }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchRead({
      kind: "conversation-image",
      id: c.send.conversationId,
      leaf: null,
      entry: "user",
      index: 0,
      offset: 1,
    }),
  ).toThrow();
});
it("claim binds exact send/context/model/revision and authenticated attachment, and consumes once", () => {
  const store = new ConversationImages(),
    command = send(),
    c = upload(command);
  expect(decodeWorkbenchResult(store.upload(c, caller))).toMatchObject({
    kind: "image-upload",
    commandId: c.commandId,
    offset: PNG.length,
  });
  const claim = { ...command, images: [c.imageId] };
  for (const changed of [
    { ...claim, text: "other" },
    { ...claim, head: "other" },
    { ...claim, conversationId: randomUUID() },
    { ...claim, model: { ...claim.model, configRev: 2 } },
  ])
    expect(() => store.claim(changed, caller)).toThrow();
  expect(() =>
    store.claim(claim, { ...caller, attachmentId: randomUUID() }),
  ).toThrow();
  expect(() =>
    store.claim(claim, { ...caller, accessGeneration: 2 }),
  ).toThrow();
  expect(() =>
    store.claim({ ...claim, images: [c.imageId, randomUUID()] }, caller),
  ).toThrow();
  expect(store.claim(claim, caller)).toEqual([
    { type: "image", data: PNG, mimeType: "image/png" },
  ]);
  expect(() => store.claim(claim, caller)).toThrow();
});
it("chunk offsets, early EOF, duplicates, count limits and idle expiry cannot admit images", () => {
  let now = 1;
  const store = new ConversationImages(() => now),
    command = send(),
    c = upload(command);
  store.upload({ ...c, data: PNG.slice(0, 4) }, caller);
  expect(() =>
    store.claim({ ...command, images: [c.imageId] }, caller),
  ).toThrow();
  expect(() => store.upload(c, caller)).toThrow();
  store.upload({ ...c, offset: 4, data: PNG.slice(4) }, caller);
  expect(() =>
    store.claim({ ...command, images: [c.imageId, c.imageId] }, caller),
  ).toThrow();
  for (let i = 1; i < IMAGE_LIMITS.count; i++)
    store.upload(upload(command), caller);
  expect(() => store.upload(upload(command), caller)).toThrow();
  now += IMAGE_LIMITS.idleMs + 1;
  expect(() =>
    store.claim({ ...command, images: [c.imageId] }, caller),
  ).toThrow();
  expect(() => store.upload(upload(command), caller)).not.toThrow();
});
it("staging reserves aggregate size up front; malformed, misleading MIME and pixel bombs refuse", () => {
  const store = new ConversationImages(),
    command = send();
  for (let i = 0; i < 2; i++)
    store.upload(
      { ...upload(command), size: IMAGE_LIMITS.bytes, data: PNG.slice(0, 4) },
      caller,
    );
  expect(() => store.upload(upload(command), caller)).toThrow();
  expect(() =>
    store.upload({ ...upload(send()), data: "!!!!" }, caller),
  ).toThrow();
  expect(() =>
    store.upload({ ...upload(send()), mimeType: "image/jpeg" }, caller),
  ).toThrow();
  expect(() => decodeImageBase64("a===")).toThrow();
  expect(validateImageBytes(pngBytes(), "image/png")).toEqual({
    width: 1,
    height: 1,
  });
  const bomb = pngBytes();
  bomb.writeUInt32BE(100000, 16);
  expect(() => validateImageBytes(bomb, "image/png")).toThrow();
  expect(() =>
    validateImageBytes(Buffer.from("<svg></svg>"), "image/png"),
  ).toThrow();
  const cadence: ImageSend = {
    ...send(),
    kind: "cadence-send",
    intent: "message",
    revision: 1,
  };
  const c = upload(cadence);
  store.upload(c, caller);
  expect(() =>
    store.claim({ ...cadence, revision: 2, images: [c.imageId] }, caller),
  ).toThrow();
});
