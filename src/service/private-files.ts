import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readBounded, safeDirectory } from "../task-store.ts";
import { ContractError, parseWireJson } from "./contracts/core.ts";

export const METADATA_BYTES = 16 * 1024;
export const REGISTRY_BYTES = 1024 * 1024;
export const REGISTRY_ENTRIES = 128;
export function refused(): never {
  throw new ContractError("corrupt-selected");
}
export function hash(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function privateMode(st: Stats): void {
  if (
    process.platform !== "win32" &&
    ((st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid()))
  )
    refused();
}
function same(a: Stats, b: Stats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.ctimeMs === b.ctimeMs &&
    a.mtimeMs === b.mtimeMs &&
    a.mode === b.mode &&
    a.uid === b.uid &&
    a.nlink === b.nlink
  );
}
function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
/** Strengthens the existing helpers only inside the owned private namespace.
 * Ambient ancestors retain TaskStore's canonicalization policy. No directory CAS
 * or hostile-same-user guarantee; failed temporaries are deliberately preserved.
 */
export class PrivateFiles {
  constructor(readonly namespace: string) {}
  directory(path: string, create = false): boolean {
    const tail = relative(this.namespace, path);
    if (isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`))
      refused();
    if (!create) {
      const namespace = resolve(this.namespace);
      let inside = false;
      return safeDirectory(path, false, (at, st) => {
        // Exact segment boundary, not a textual prefix. One synchronous walk
        // checks every ambient ancestor and each existing private ancestor,
        // including an unsafe parent before a missing child. Nothing is cached.
        if (at === namespace) inside = true;
        if (inside) privateMode(st);
      });
    }
    let at = this.namespace;
    for (const part of ["", ...tail.split(sep).filter(Boolean)]) {
      if (part) at = join(at, part);
      if (!safeDirectory(at, create)) return false;
      privateMode(lstatSync(at));
    }
    return true;
  }
  read(path: string, maximum = METADATA_BYTES): FileSnapshot | undefined {
    if (!this.directory(dirname(path))) return undefined;
    let before: Stats;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (missing(error)) return undefined;
      return refused();
    }
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      refused();
    privateMode(before);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      if (!same(before, opened)) refused();
      // Reuse the bounded no-follow reader; surround its read with descriptor and
      // selected-path identity checks rather than weakening legacy behavior.
      // The caller's independent maximum was already checked above. Bound the
      // inner allocation to this exact selected size (+1 growth sentinel); keep
      // its full ancestor/open checks and our final descriptor/path checks.
      const bytes = readBounded(path, opened.size);
      if (
        !bytes ||
        bytes.length !== opened.size ||
        !same(opened, fstatSync(fd)) ||
        !same(opened, lstatSync(path))
      )
        refused();
      return { bytes, identity: hash(bytes), stamp: stamp(opened) };
    } finally {
      closeSync(fd);
    }
  }
  assert(
    path: string,
    expected: FileSnapshot | undefined,
    maximum = METADATA_BYTES,
  ): void {
    const current = this.read(path, maximum);
    if (
      current?.identity !== expected?.identity ||
      current?.stamp !== expected?.stamp
    )
      throw new ContractError("conflict");
  }
  create(path: string, bytes: string, maximum = METADATA_BYTES): FileSnapshot {
    if (Buffer.byteLength(bytes) > maximum) throw new ContractError("oversize");
    this.directory(dirname(path), true);
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.syncDirectory(dirname(path));
    const result = this.read(path, maximum);
    if (!result || result.identity !== hash(bytes)) refused();
    return result;
  }
  replace(
    path: string,
    expected: FileSnapshot,
    bytes: string,
    maximum = METADATA_BYTES,
  ): FileSnapshot {
    this.assert(path, expected, maximum);
    const temporary = join(dirname(path), `pending-${randomUUID()}.json`);
    this.create(temporary, bytes, maximum);
    this.assert(path, expected, maximum);
    renameSync(temporary, path);
    this.syncDirectory(dirname(path));
    const result = this.read(path, maximum);
    if (!result || result.identity !== hash(bytes)) refused();
    return result;
  }
  remove(path: string, expected: FileSnapshot, maximum = METADATA_BYTES): void {
    this.assert(path, expected, maximum);
    unlinkSync(path);
    this.syncDirectory(dirname(path));
  }
  private syncDirectory(path: string): void {
    // POSIX available-host durability attempt. Windows ACL/directory durability
    // requires its own qualification; file flush is still mandatory there.
    if (process.platform === "win32") return;
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
export interface FileSnapshot {
  bytes: Buffer;
  identity: string;
  stamp: string;
}
function stamp(st: Stats): string {
  return [
    st.dev,
    st.ino,
    st.size,
    st.mode,
    st.uid,
    st.nlink,
    st.ctimeMs,
    st.mtimeMs,
  ].join(":");
}
export function json(
  snapshot: FileSnapshot,
  maximum = METADATA_BYTES,
): unknown {
  try {
    return parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes),
      maximum,
    );
  } catch {
    return refused();
  }
}
export function encoded(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
