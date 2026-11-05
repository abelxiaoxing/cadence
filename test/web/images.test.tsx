import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { IMAGE_LIMITS } from "../../src/image-content.mjs";
import type { ImageSend } from "../../src/service/contracts/workbench.ts";
import { ConversationImages } from "../../src/service/conversation-images.ts";
import {
  captureSend,
  sendCommand,
} from "../../web/src/client/conversation-send";
import {
  readImage,
  uploadImages,
  validatedImageFile,
  validateImageFiles,
} from "../../web/src/client/images";
import { PNG, pngBytes } from "../helpers/images.ts";

const file = () =>
  new File([pngBytes()], "screenshot.png", { type: "image/png" });
const model = {
  epoch: randomUUID(),
  catalogId: randomUUID(),
  configRev: 1,
  accessGeneration: 1,
};
const pending = (files: File[]) =>
  captureSend({
    id: randomUUID(),
    head: null,
    text: "",
    images: files,
    revision: 0,
    intent: "ordinary",
  });
it("a Send pins its image-only draft before any preparation/model await", () => {
  const images = [file()];
  const intent = pending(images);
  images.length = 0;
  expect(intent.images).toHaveLength(1);
  expect(Object.isFrozen(intent.images)).toBe(true);
  expect(sendCommand(intent, model)).toMatchObject({ kind: "send", text: "" });
});
it("uploads are separate from admission and a departed or lost upload never sends/retries", async () => {
  const intent = pending([file()]),
    command = sendCommand(intent, model) as ImageSend;
  const store = new ConversationImages();
  const caller = {
    attachmentId: randomUUID(),
    accessGeneration: 1,
    authority: "browser" as const,
  };
  let calls = 0;
  const client = {
    workbenchCommand: async (
      c: Parameters<ConversationImages["upload"]>[0],
    ) => {
      calls++;
      return { kind: "ok" as const, value: store.upload(c, caller) };
    },
  };
  const sent = await uploadImages(client, command, intent.images, () => true);
  expect(sent.images).toHaveLength(1);
  expect(store.claim(sent, caller)[0].data).toBe(PNG);
  expect(calls).toBe(1);
  await expect(
    uploadImages(client, command, intent.images, () => false),
  ).rejects.toThrow("stale");
  expect(calls).toBe(1);
  await expect(
    uploadImages(
      {
        workbenchCommand: async () => {
          calls++;
          throw Error("lost");
        },
      },
      command,
      intent.images,
      () => true,
    ),
  ).rejects.toThrow("lost");
  expect(calls).toBe(2);
});
it("selections have no image count or byte quota, but unsupported and empty files refuse", () => {
  expect(() =>
    validateImageFiles(Array.from({ length: 65 }, file)),
  ).not.toThrow();
  const large = new File([new Uint8Array(5 * 1024 * 1024)], "x.png", {
    type: "image/png",
  });
  expect(() => validateImageFiles([large, large])).not.toThrow();
  expect(() =>
    validateImageFiles([
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }),
    ]),
  ).toThrow("Use PNG, JPEG or WebP images.");
  expect(() =>
    validateImageFiles([new File([], "x.png", { type: "image/png" })]),
  ).toThrow("Image is empty.");
});
it("history reads only forward chunks with exact MIME, not arbitrary URLs or nonadvancing cursors", async () => {
  const image = { entry: "user", index: 0, mimeType: "image/png" };
  const blob = await readImage(image, async () => ({
    kind: "conversation-image",
    data: PNG,
    next: null,
    mimeType: "image/png",
  }));
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
    new Uint8Array(pngBytes()),
  );
  for (const next of [0, 4])
    await expect(
      readImage(image, async () => ({
        kind: "conversation-image",
        data: PNG,
        next,
        mimeType: "image/png",
      })),
    ).rejects.toThrow();
  await expect(
    readImage(image, async () => ({
      kind: "conversation-image",
      data: PNG,
      next: null,
      mimeType: "image/jpeg",
    })),
  ).rejects.toThrow();
});

it("preview validation accepts large dimensions but still rejects invalid headers", async () => {
  const bytes = pngBytes();
  bytes.writeUInt32BE(100000, 16);
  bytes.writeUInt32BE(100000, 20);
  expect(
    await validatedImageFile(
      new File([bytes], "large.png", { type: "image/png" }),
    ),
  ).toEqual(new Uint8Array(bytes));
  bytes.writeUInt32BE(0, 16);
  await expect(
    validatedImageFile(new File([bytes], "invalid.png", { type: "image/png" })),
  ).rejects.toThrow("Invalid image dimensions");
  expect(await validatedImageFile(file())).toEqual(new Uint8Array(pngBytes()));
});
it("uploads and history reads cross the old file and message limits without changing chunk bounds", async () => {
  const bytes = Buffer.concat([pngBytes(), Buffer.alloc(5 * 1024 * 1024)]);
  const files = [
    new File([bytes], "large.png", { type: "image/png" }),
    new File([bytes], "another.png", { type: "image/png" }),
    ...Array.from({ length: 5 }, file),
  ];
  const intent = pending(files),
    command = sendCommand(intent, model) as ImageSend;
  const store = new ConversationImages();
  const caller = {
    attachmentId: randomUUID(),
    accessGeneration: 1,
    authority: "browser" as const,
  };
  const sent = await uploadImages(
    {
      workbenchCommand: async (c) => {
        if (c.kind !== "image-upload") throw new Error("unexpected command");
        expect(c.data.length).toBeLessThanOrEqual(IMAGE_LIMITS.chunkChars);
        return { kind: "ok" as const, value: store.upload(c, caller) };
      },
    },
    command,
    intent.images,
    () => true,
  );
  expect(sent.images).toHaveLength(7);
  const admitted = store.claim(sent, caller);
  expect(admitted).toHaveLength(7);
  const blob = await readImage(
    { entry: "user", index: 0, mimeType: "image/png" },
    async (offset) => {
      const data = admitted[0].data.slice(
        offset,
        offset + IMAGE_LIMITS.chunkChars,
      );
      return {
        kind: "conversation-image",
        mimeType: "image/png",
        data,
        next:
          offset + data.length < admitted[0].data.length
            ? offset + data.length
            : null,
      };
    },
  );
  expect(Buffer.from(await blob.arrayBuffer()).equals(bytes)).toBe(true);
});
