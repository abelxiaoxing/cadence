import {
  decodeImageBase64,
  IMAGE_LIMITS,
  IMAGE_TYPES,
  validateImageBytes,
} from "../../../src/image-content.mjs";
import type {
  ChatImage,
  ImageSend,
  WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";

export function validateImageFiles(files: readonly File[]): void {
  if (
    files.length > IMAGE_LIMITS.count ||
    files.reduce((size, f) => size + f.size, 0) > IMAGE_LIMITS.totalBytes
  )
    throw new Error("Too many images or total image size exceeded.");
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type))
      throw new Error("Use PNG, JPEG or WebP images.");
    if (!file.size || file.size > IMAGE_LIMITS.bytes)
      throw new Error("Image is empty or too large.");
  }
}
/** Validate compressed bytes and dimensions before creating any preview URL. */
export async function validatedImageFile(file: File): Promise<Uint8Array> {
  validateImageFiles([file]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateImageBytes(bytes, file.type);
  return bytes;
}
const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let p = 0; p < bytes.length; p += 8192)
    text += String.fromCharCode(...bytes.subarray(p, p + 8192));
  return btoa(text);
};
/** Only an explicit Send uploads. Every await rechecks the original navigation
 * generation; a lost upload reply never retries or submits the message. */
export async function uploadImages(
  client: Pick<ServiceClient, "workbenchCommand">,
  command: ImageSend,
  files: readonly File[],
  current: () => boolean,
): Promise<ImageSend> {
  validateImageFiles(files);
  const images: string[] = [];
  for (const file of files) {
    if (!current()) throw new Error("stale");
    const bytes = await validatedImageFile(file);
    if (!current()) throw new Error("stale");
    const data = base64(bytes),
      imageId = crypto.randomUUID();
    for (
      let offset = 0;
      offset < data.length;
      offset += IMAGE_LIMITS.chunkChars
    ) {
      if (!current()) throw new Error("stale");
      const chunk = data.slice(offset, offset + IMAGE_LIMITS.chunkChars);
      const reply = await client.workbenchCommand({
        kind: "image-upload",
        commandId: crypto.randomUUID(),
        imageId,
        send: command,
        mimeType: file.type,
        size: bytes.length,
        offset,
        data: chunk,
      });
      if (!current()) throw new Error("stale");
      if (reply.kind === "error") throw new Error(reply.error.code);
      if (
        reply.value.kind !== "image-upload" ||
        reply.value.imageId !== imageId ||
        reply.value.offset !== offset + chunk.length
      )
        throw new Error("invalid");
    }
    images.push(imageId);
  }
  return images.length ? { ...command, images } : command;
}
/** Bounded lazy read. The caller supplies the original branch and abort signal. */
export async function readImage(
  image: ChatImage,
  read: (offset: number) => Promise<WorkbenchResult>,
): Promise<Blob> {
  const parts: string[] = [];
  let offset = 0;
  for (;;) {
    const reply = await read(offset);
    if (
      reply.kind !== "conversation-image" ||
      reply.mimeType !== image.mimeType ||
      !reply.data.length ||
      reply.data.length > IMAGE_LIMITS.chunkChars
    )
      throw new Error("invalid");
    parts.push(reply.data);
    offset += reply.data.length;
    if (offset > 4 * Math.ceil(IMAGE_LIMITS.bytes / 3))
      throw new Error("capacity");
    if (reply.next === null) break;
    if (reply.next !== offset || reply.data.length !== IMAGE_LIMITS.chunkChars)
      throw new Error("invalid");
  }
  const bytes = decodeImageBase64(parts.join(""));
  validateImageBytes(bytes, image.mimeType);
  return new Blob([new Uint8Array(bytes)], { type: image.mimeType });
}
