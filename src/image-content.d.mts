export const IMAGE_LIMITS: Readonly<{
  chunkChars: number;
  idleMs: number;
}>;
export const IMAGE_TYPES: readonly string[];
export interface InputImage {
  type: "image";
  data: string;
  mimeType: string;
}
export function decodeImageBase64(data: string): Uint8Array;
export function validateImageBytes(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number };
