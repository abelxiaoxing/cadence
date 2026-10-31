import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { retryWindowsFileOperation, safeDirectory } from "../workspace.ts";

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
/** Owner-only mode for state Cadence creates. External sources it only reads
 * (Pi's agent directory and files) keep whatever mode the user's umask gave
 * them, such as 0755/0775 from Pi itself; ownership is still required. */
function privateMode(st: Stats, ownerOnly = true): void {
  if (
    process.platform !== "win32" &&
    ((ownerOnly && (st.mode & 0o077) !== 0) ||
      (process.getuid && st.uid !== process.getuid()))
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
// Advances once per job, at its first microtask checkpoint. Nothing queued
// retains a scope, so a dropped read budget is collected as usual.
let job = 0,
  advancing = false;
function currentJob(): number {
  if (!advancing) {
    advancing = true;
    queueMicrotask(() => {
      job++;
      advancing = false;
    });
  }
  return job;
}
/** Directories that ONE synchronous operation already walked. Reuse re-observes
 * the directory itself, no-follow, with the walked dev/ino and private mode: an
 * ancestor substituted for other content resolves elsewhere and walks again. It
 * goes stale at the next microtask checkpoint, so an await or a later call
 * always walks; an ancestor's mode change inside one operation is seen by the
 * next. Absence, refusal and any changed identity fall back to the full walk.
 */
export class DirectoryWalks {
  private readonly job = currentJob();
  private readonly walked = new Map<string, { dev: number; ino: number }>();
  private open(): boolean {
    if (this.job === job) return true;
    this.walked.clear();
    return false;
  }
  remember(path: string, st: Stats): void {
    if (this.open()) this.walked.set(path, { dev: st.dev, ino: st.ino });
  }
  reuse(path: string, ownerOnly = true): boolean {
    const walked = this.open() ? this.walked.get(path) : undefined;
    if (!walked) return false;
    let st: Stats;
    try {
      st = lstatSync(path);
    } catch (error) {
      if (!missing(error)) throw error;
      this.walked.delete(path);
      return false;
    }
    if (
      !st.isDirectory() ||
      st.isSymbolicLink() ||
      st.dev !== walked.dev ||
      st.ino !== walked.ino
    ) {
      this.walked.delete(path);
      return false;
    }
    privateMode(st, ownerOnly);
    return true;
  }
}
/** Strengthens the existing helpers only inside the owned private namespace.
 * Ambient ancestors retain TaskStore's canonicalization policy. No directory CAS
 * or hostile-same-user guarantee; failed temporaries are deliberately preserved.
 */
export class PrivateFiles {
  /** `ownerOnly: false` for an external namespace such as Pi's agent directory. */
  constructor(
    readonly namespace: string,
    readonly ownerOnly = true,
  ) {}
  directory(path: string, create = false, walks?: DirectoryWalks): boolean {
    const tail = relative(this.namespace, path);
    if (isAbsolute(tail) || tail === ".." || tail.startsWith(`..${sep}`))
      refused();
    if (!create) {
      const full = resolve(path);
      if (walks?.reuse(full, this.ownerOnly)) return true;
      const namespace = resolve(this.namespace);
      let inside = false,
        last: Stats | undefined;
      const found = safeDirectory(path, false, (at, st) => {
        // Exact segment boundary, not a textual prefix. One synchronous walk
        // checks every ambient ancestor and each existing private ancestor,
        // including an unsafe parent before a missing child. Only the caller's
        // DirectoryWalks keeps the result, for that same synchronous operation.
        if (at === namespace) inside = true;
        if (inside) privateMode(st, this.ownerOnly);
        last = st;
      });
      if (found && last) walks?.remember(full, last);
      return found;
    }
    // Walk the namespace and its ambient ancestors once, then check each
    // private segment exactly once, creating a missing one privately.
    if (!safeDirectory(this.namespace, true)) return false;
    privateMode(lstatSync(this.namespace), this.ownerOnly);
    let at = this.namespace;
    for (const part of tail.split(sep).filter(Boolean)) {
      at = join(at, part);
      let st: Stats;
      try {
        st = lstatSync(at);
      } catch (error) {
        if (!missing(error)) throw error;
        try {
          mkdirSync(at, { mode: 0o700 });
        } catch (mkdirError) {
          if (
            !(
              mkdirError instanceof Error &&
              "code" in mkdirError &&
              mkdirError.code === "EEXIST"
            )
          )
            throw mkdirError;
        }
        st = lstatSync(at);
      }
      if (!st.isDirectory() || st.isSymbolicLink())
        throw new Error("Unsafe directory");
      privateMode(st, this.ownerOnly);
    }
    return true;
  }
  read(
    path: string,
    maximum = METADATA_BYTES,
    walks?: DirectoryWalks,
  ): FileSnapshot | undefined {
    if (!this.directory(dirname(path), false, walks)) return undefined;
    let before: Stats;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (missing(error)) return undefined;
      return refused();
    }
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      refused();
    privateMode(before, this.ownerOnly);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      if (!same(before, opened)) refused();
      // Read this already opened, no-follow, identity-checked descriptor: its
      // parents were walked just above, so a second walk and open add nothing.
      // Bound the read to the selected size (+1 growth sentinel) and keep the
      // final descriptor/path identity checks.
      const buffer = Buffer.alloc(opened.size + 1);
      let size = 0;
      while (size < buffer.length) {
        const n = readSync(fd, buffer, size, buffer.length - size, null);
        if (!n) break;
        size += n;
      }
      const bytes = buffer.subarray(0, size);
      if (
        size !== opened.size ||
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
    walks?: DirectoryWalks,
  ): void {
    const current = this.read(path, maximum, walks);
    if (
      current?.identity !== expected?.identity ||
      current?.stamp !== expected?.stamp
    )
      throw new ContractError("conflict");
  }
  create(path: string, bytes: string, maximum = METADATA_BYTES): FileSnapshot {
    if (Buffer.byteLength(bytes) > maximum) throw new ContractError("oversize");
    this.directory(dirname(path), true);
    const fd = retryWindowsFileOperation(() => openSync(path, "wx", 0o600));
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
    retryWindowsFileOperation(
      () => renameSync(temporary, path),
      () => this.assert(path, expected, maximum),
    );
    this.syncDirectory(dirname(path));
    const result = this.read(path, maximum);
    if (!result || result.identity !== hash(bytes)) refused();
    return result;
  }
  remove(path: string, expected: FileSnapshot, maximum = METADATA_BYTES): void {
    this.assert(path, expected, maximum);
    retryWindowsFileOperation(
      () => unlinkSync(path),
      () => this.assert(path, expected, maximum),
    );
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
