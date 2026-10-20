import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from "node:fs";
import { dirname } from "node:path";
import { ContractError } from "../service-contract.ts";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";

function bad(): never {
  throw new ContractError("corrupt-selected");
}
const stamp = (s: Stats) =>
  [s.dev, s.ino, s.size, s.mode, s.uid, s.nlink, s.ctimeMs, s.mtimeMs].join(
    ":",
  );
/** One descriptor/path/permission guard, shared by payload reads and quota stat.
 * This is supported-writer hygiene, not hostile same-user filesystem CAS. */
function selected<T>(
  files: HistoryFiles,
  path: string,
  read: (fd: number, size: number, stamp: string) => T,
): T {
  if (!files.files.directory(dirname(path))) bad();
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.nlink !== 1 ||
    (process.platform !== "win32" &&
      (before.mode & 0o077 ||
        (process.getuid && before.uid !== process.getuid())))
  )
    bad();
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (stamp(fstatSync(fd)) !== stamp(before)) bad();
    const result = read(fd, before.size, stamp(before));
    if (
      stamp(fstatSync(fd)) !== stamp(before) ||
      stamp(lstatSync(path)) !== stamp(before)
    )
      bad();
    return result;
  } finally {
    closeSync(fd);
  }
}
/** Revalidate a previously read immutable file without re-decoding its payload.
 * Uses the SAME incarnation tuple as PrivateFiles, with descriptor/path guards.
 * Key-consuming reads still read and compare actual bytes within their budget. */
export function assertIncarnation(
  files: HistoryFiles,
  path: string,
  expected: string,
): void {
  selected(files, path, (_fd, _size, current) => {
    if (current !== expected) bad();
  });
}
export function incarnation(
  files: HistoryFiles,
  path: string,
  maximum: number,
): { size: number; stamp: string } {
  return selected(files, path, (_fd, size, stamp) => {
    if (size > maximum) bad();
    return { size, stamp };
  });
}
/** An appendable selected prefix may be reused only after actual byte reproof.
 * Replacements/metadata changes and sealed predecessors never use this seam. */
export function reproveAppend(
  files: HistoryFiles,
  path: string,
  expected: string,
  length: number,
  sha256: string,
  budget: HistoryReadBudget,
): string {
  const current = incarnation(files, path, Number.MAX_SAFE_INTEGER),
    a = expected.split(":"),
    b = current.stamp.split(":");
  if (current.stamp === expected) return expected;
  if (
    b.slice(0, 2).join(":") !== a.slice(0, 2).join(":") ||
    b.slice(3, 6).join(":") !== a.slice(3, 6).join(":") ||
    Number(b[2]) <= Number(a[2])
  )
    bad();
  const bytes = readRange(files, path, 0, length, budget);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) bad();
  assertIncarnation(files, path, current.stamp);
  return current.stamp;
}
/** No payload read or allocation in quota inventory. Original ledger/artifact
 * validation remains separate; stat never supplies committed-content evidence. */
export function statSize(
  files: HistoryFiles,
  path: string,
  maximum: number,
): number {
  return selected(files, path, (_fd, size) => {
    if (size > maximum) bad();
    return size;
  });
}
/** Admit byte/time IO before allocating or reading the selected native payload. */
export function readRange(
  files: HistoryFiles,
  path: string,
  offset: number,
  length: number,
  budget: HistoryReadBudget,
): Buffer {
  budget.reserve(0);
  return selected(files, path, (fd, size) => {
    if (offset < 0 || length < 0 || offset + length > size) bad();
    budget.reserve(length);
    const out = Buffer.alloc(length);
    let n = 0;
    while (n < length) {
      budget.reserve(0);
      const got = readSync(fd, out, n, length - n, offset + n);
      if (!got) bad();
      n += got;
    }
    return out;
  });
}
