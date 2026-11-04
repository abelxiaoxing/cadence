export const IMAGE_LIMITS: Readonly<{
  count: number;
  bytes: number;
  totalBytes: number;
  chunkChars: number;
  stagedBytes: number;
  stagedCount: number;
  idleMs: number;
  pixels: number;
  dimension: number;
  wireBytes: number;
}>;
export const IMAGE_TYPES: readonly string[];
export interface InputImage {
  type: "image";
  data: string;
  mimeType: string;
}
export function decodeImageBase64(data: string, maxBytes?: number): Uint8Array;
export function validateImageBytes(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number };
