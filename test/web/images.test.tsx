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
it("unsupported/oversized file selections fail without partial acceptance", () => {
  expect(() =>
    validateImageFiles([
      new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }),
    ]),
  ).toThrow();
  expect(() =>
    validateImageFiles(Array.from({ length: IMAGE_LIMITS.count + 1 }, file)),
  ).toThrow();
  expect(() =>
    validateImageFiles([
      new File([new Uint8Array(IMAGE_LIMITS.bytes + 1)], "x.png", {
        type: "image/png",
      }),
    ]),
  ).toThrow();
});
it("history reads only bounded forward parts with exact MIME, not arbitrary URLs or endless cursors", async () => {
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

it("oversized image dimensions are rejected before a preview may be created", async () => {
  const bytes = pngBytes();
  bytes.writeUInt32BE(16384, 16);
  bytes.writeUInt32BE(16384, 20);
  await expect(
    validatedImageFile(new File([bytes], "bomb.png", { type: "image/png" })),
  ).rejects.toThrow("Invalid image dimensions");
  expect(await validatedImageFile(file())).toEqual(new Uint8Array(pngBytes()));
});
