// A download: bounded parts of one file version assembled in the browser.
import { expect, it } from "vitest";
import {
  FILE_PART_BYTES,
  type WorkbenchResult,
} from "../../src/service/contracts/workbench.ts";
import {
  readFileParts,
  windowsFileName,
} from "../../web/src/client/file-download";
import { hostPath } from "../../web/src/components/workspace/FilesPanel";

const VERSION = "a".repeat(32);
const bytes = (length: number, seed = 7) =>
  Uint8Array.from({ length }, (_, at) => (at * seed + 3) % 256);
/** A reader over `data` as the service states its parts. */
function served(data: Uint8Array, change?: (part: WorkbenchResult) => void) {
  const offsets: number[] = [];
  const read = async (offset: number): Promise<WorkbenchResult> => {
    offsets.push(offset);
    const end = Math.min(offset + FILE_PART_BYTES, data.length);
    const part: WorkbenchResult = {
      kind: "file-part",
      path: "blob.bin",
      size: data.length,
      version: VERSION,
      data: Buffer.from(data.subarray(offset, end)).toString("base64"),
      next: end < data.length ? end : null,
    };
    change?.(part);
    return part;
  };
  return { read, offsets };
}

it("a file's parts are read in order and assembled into its exact bytes", async () => {
  const data = bytes(FILE_PART_BYTES * 2 + 11);
  const { read, offsets } = served(data);
  const blob = await readFileParts(read);
  expect(offsets).toEqual([0, FILE_PART_BYTES, FILE_PART_BYTES * 2]);
  expect(blob.type).toBe("application/octet-stream");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data);
  // An empty file is one empty part.
  const empty = await readFileParts(served(new Uint8Array()).read);
  expect(empty.size).toBe(0);
});

it("a file that changed between parts is refused as stale, never saved as a mixture", async () => {
  const data = bytes(FILE_PART_BYTES + 1);
  let calls = 0;
  await expect(
    readFileParts(
      served(data, (part) => {
        if (part.kind === "file-part" && calls++) part.version = "b".repeat(32);
      }).read,
    ),
  ).rejects.toThrow("stale");
  calls = 0;
  await expect(
    readFileParts(
      served(data, (part) => {
        if (part.kind === "file-part" && calls++) part.size += 1;
      }).read,
    ),
  ).rejects.toThrow("stale");
});

it("a part that does not continue the one before it, or is another reply, is refused", async () => {
  const data = bytes(FILE_PART_BYTES + 9);
  const broken = (change: (part: WorkbenchResult) => void) =>
    expect(readFileParts(served(data, change).read)).rejects.toThrow("invalid");
  // A short part that claims more follows.
  await broken((part) => {
    if (part.kind === "file-part" && part.next !== null)
      part.data = part.data.slice(0, 8);
  });
  // A last part that does not reach the stated size.
  await broken((part) => {
    if (part.kind === "file-part" && part.next === null) part.data = "";
  });
  // A next offset that skips bytes.
  await broken((part) => {
    if (part.kind === "file-part" && part.next !== null)
      part.next += FILE_PART_BYTES;
  });
  await expect(
    readFileParts(async () => ({
      kind: "file",
      path: "blob.bin",
      text: "",
      limited: false,
    })),
  ).rejects.toThrow("invalid");
  // A refusal the reader throws ends the download with that refusal.
  await expect(
    readFileParts(async () => {
      throw new Error("oversize");
    }),
  ).rejects.toThrow("oversize");
});

it("a saved name is one Windows accepts, and a copied path is the entry's own on the service host", () => {
  expect(windowsFileName('a<b>:"c"|d?.txt')).toBe("a_b___c__d_.txt");
  expect(windowsFileName("trailing. . ")).toBe("trailing");
  expect(windowsFileName("...")).toBe("_");
  expect(windowsFileName("CON.txt")).toBe("_CON.txt");
  expect(windowsFileName("notes.md")).toBe("notes.md");
  expect(hostPath("/home/u/project", "src/a.ts")).toBe(
    "/home/u/project/src/a.ts",
  );
  expect(hostPath("/home/u/project/", "a.ts")).toBe("/home/u/project/a.ts");
  expect(hostPath("/", "etc")).toBe("/etc");
  expect(hostPath("C:\\work\\project", "src/a.ts")).toBe(
    "C:\\work\\project\\src\\a.ts",
  );
});
