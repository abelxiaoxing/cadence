import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  decodeImageBase64,
  IMAGE_LIMITS,
  validateImageBytes,
} from "../src/image-content.mjs";
import {
  decodeChatItem,
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
  for (const size of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => decodeWorkbenchCommand({ ...c, size })).toThrow();
  expect(
    decodeWorkbenchCommand({ ...c, size: 128 * 1024 * 1024 }),
  ).toMatchObject({
    size: 128 * 1024 * 1024,
  });
  expect(
    decodeWorkbenchRead({ ...media, index: 1025, offset: 8 * 1024 * 1024 }),
  ).toMatchObject({
    index: 1025,
    offset: 8 * 1024 * 1024,
  });
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
it("chunk offsets, early EOF, duplicates and idle expiry cannot admit images", () => {
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
  now += IMAGE_LIMITS.idleMs + 1;
  expect(() =>
    store.claim({ ...command, images: [c.imageId] }, caller),
  ).toThrow();
  expect(() => store.upload(upload(command), caller)).not.toThrow();
});
it("malformed encodings, misleading MIME and invalid headers still refuse", () => {
  const store = new ConversationImages();
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
  const invalid = pngBytes();
  invalid.writeUInt32BE(0, 16);
  expect(() => validateImageBytes(invalid, "image/png")).toThrow();
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

it("image count and staged byte declarations have no image-specific quota", () => {
  const store = new ConversationImages(),
    command = send();
  const uploads = Array.from({ length: 65 }, () => upload(command));
  for (const c of uploads) store.upload(c, caller);
  const claim = decodeWorkbenchCommand({
    ...command,
    images: uploads.map((c) => c.imageId),
  }) as ImageSend;
  expect(store.claim(claim, caller)).toHaveLength(65);
  for (let i = 0; i < 65; i++)
    store.upload(
      { ...upload(command), size: 128 * 1024 * 1024, data: PNG.slice(0, 4) },
      caller,
    );
  store.clear();
  const c = upload(command);
  store.upload(c, caller);
  expect(store.claim({ ...command, images: [c.imageId] }, caller)).toHaveLength(
    1,
  );
});
it("complete images above the former per-file and message byte limits can be claimed", () => {
  const store = new ConversationImages(),
    command = send();
  // Padding exercises byte transport; header validation is not codec decoding.
  const bytes = Buffer.concat([pngBytes(), Buffer.alloc(5 * 1024 * 1024)]);
  const data = bytes.toString("base64");
  const images: string[] = [];
  for (let i = 0; i < 2; i++) {
    const c = { ...upload(command), size: bytes.length };
    for (
      let offset = 0;
      offset < data.length;
      offset += IMAGE_LIMITS.chunkChars
    )
      store.upload(
        decodeWorkbenchCommand({
          ...c,
          offset,
          data: data.slice(offset, offset + IMAGE_LIMITS.chunkChars),
        }) as typeof c,
        caller,
      );
    images.push(c.imageId);
  }
  const claimed = store.claim({ ...command, images }, caller);
  expect(claimed.map((image) => image.data.length)).toEqual([
    data.length,
    data.length,
  ]);
  expect(claimed[1].data).toBe(data);
});

it("retained image descriptors decode without a count or content-index quota", () => {
  const images = Array.from({ length: 65 }, (_, i) => ({
    entry: "user",
    index: 1025 + i,
    mimeType: "image/png",
  }));
  expect(
    decodeChatItem({
      id: "user",
      role: "user",
      text: "",
      name: "",
      args: "",
      error: false,
      images,
    }),
  ).toMatchObject({ images });
});
