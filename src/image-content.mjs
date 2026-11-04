import { IMAGE_COUNT } from "./worker-public.mjs";
/** Shared image ceilings. Upload chunks and history parts fit existing control replies;
 * image bytes never enlarge the public worker request or become prompt text. */
export const IMAGE_LIMITS = Object.freeze({
  count: IMAGE_COUNT,
  bytes: 4 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  chunkChars: 256 * 1024,
  stagedBytes: 64 * 1024 * 1024,
  stagedCount: 64,
  idleMs: 10 * 60 * 1000,
  pixels: 32 * 1024 * 1024,
  dimension: 16384,
  wireBytes: 12 * 1024 * 1024,
});
export const IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function decodeImageBase64(data, maxBytes = IMAGE_LIMITS.bytes) {
  if (
    typeof data !== "string" ||
    !data.length ||
    data.length % 4 ||
    data.length > 4 * Math.ceil(maxBytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error("Invalid image encoding");
  const raw = atob(data);
  if (raw.length > maxBytes) throw new Error("Image is too large");
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Bounded header validation, not an image transcoder. No SVG/HTML or remote URLs. */
export function validateImageBytes(bytes, mimeType) {
  if (
    !IMAGE_TYPES.includes(mimeType) ||
    !bytes.length ||
    bytes.length > IMAGE_LIMITS.bytes
  )
    throw new Error("Unsupported image or size");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, value) =>
    [...value].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  let width = 0,
    height = 0;
  if (
    mimeType === "image/png" &&
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    ascii(1, "PNG\r\n\u001a\n") &&
    v.getUint32(8) === 13 &&
    ascii(12, "IHDR")
  ) {
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (
    mimeType === "image/jpeg" &&
    bytes[0] === 255 &&
    bytes[1] === 216
  ) {
    for (let p = 2; p + 3 < bytes.length; ) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > bytes.length) break;
      const length = v.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      ) {
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        break;
      }
      p += length;
    }
  } else if (
    mimeType === "image/webp" &&
    bytes.length >= 30 &&
    ascii(0, "RIFF") &&
    ascii(8, "WEBP") &&
    v.getUint32(4, true) + 8 === bytes.length
  ) {
    if (ascii(12, "VP8X")) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (
      ascii(12, "VP8 ") &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = v.getUint16(26, true) & 16383;
      height = v.getUint16(28, true) & 16383;
    } else if (ascii(12, "VP8L") && bytes[20] === 47) {
      const bits = v.getUint32(21, true);
      width = 1 + (bits & 16383);
      height = 1 + ((bits >>> 14) & 16383);
    }
  }
  if (
    !width ||
    !height ||
    width > IMAGE_LIMITS.dimension ||
    height > IMAGE_LIMITS.dimension ||
    width * height > IMAGE_LIMITS.pixels
  )
    throw new Error("Invalid image dimensions or header");
  return { width, height };
}
