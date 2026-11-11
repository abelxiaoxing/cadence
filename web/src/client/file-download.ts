/* Saving is adapted from pi-web-ui web/src/download.ts @ 29bd28df: the save
 * picker with an anchor fallback and Windows-safe names.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: the bytes come from bounded `file-part` reads of one file version,
 * never from a URL; nothing is retried, and a handed-over save is not reported
 * as a completed one. */
import {
  FILE_PART_BYTES,
  type WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** A file's exact bytes, read part by part. Every part must continue the one
 * before it and state the same size and version: a file that changed while
 * it was read is refused as stale, never saved as a mixture. */
export async function readFileParts(
  read: (offset: number) => Promise<WorkbenchResult>,
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0,
    size = 0,
    version = "";
  for (;;) {
    const part = await read(offset);
    if (part.kind !== "file-part") throw new Error("invalid");
    if (offset === 0) ({ size, version } = part);
    else if (part.size !== size || part.version !== version)
      throw new Error("stale");
    const bytes = decodeBase64(part.data);
    const end = offset + bytes.length;
    if (
      part.next === null
        ? end !== size
        : part.next !== end || bytes.length !== FILE_PART_BYTES
    )
      throw new Error("invalid");
    parts.push(bytes);
    if (part.next === null) break;
    offset = part.next;
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in a Windows file name
const WINDOWS_INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_TRAILING = /[. ]+$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A name Windows accepts for a saved file. */
export function windowsFileName(name: string): string {
  const cleaned = name
    .replace(WINDOWS_INVALID_CHARS, "_")
    .replace(WINDOWS_TRAILING, "");
  if (!cleaned) return "_";
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

type SavePicker = (options?: {
  suggestedName?: string;
}) => Promise<FileSystemFileHandle>;

function saveViaAnchor(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hand the bytes to the browser: its save picker where there is one, else an
 * ordinary download. `cancelled` is the user closing the picker; a failed
 * write throws. */
export async function saveBlob(
  blob: Blob,
  fileName: string,
): Promise<"handed" | "cancelled"> {
  const name = /windows/i.test(navigator.userAgent)
    ? windowsFileName(fileName)
    : fileName;
  const picker = (window as { showSaveFilePicker?: SavePicker })
    .showSaveFilePicker;
  if (!picker || !window.isSecureContext) {
    saveViaAnchor(blob, name);
    return "handed";
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await picker.call(window, { suggestedName: name });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return "cancelled";
    // The picker refuses once the click's activation has lapsed (a long
    // read); the ordinary download needs none.
    saveViaAnchor(blob, name);
    return "handed";
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return "handed";
}
