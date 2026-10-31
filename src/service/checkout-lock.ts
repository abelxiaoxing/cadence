/** Existing checkout lock identity and original filesystem semantics, without task CRUD. */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { object, validId } from "../data-shapes.ts";
import {
  absent,
  contains,
  defaultStateHome,
  parseRecord,
  privateRootFor,
  privateWorkspace,
  readBounded,
  retryWindowsFileOperation,
  safeDirectory,
} from "../workspace.ts";
export interface CheckoutLock {
  schema: "cadence-assistant-lock/1";
  token: string;
  pid: number;
  host: string;
  runId: string;
  root: string;
}
export class CheckoutStore {
  readonly root: string;
  readonly privateRoot: string;
  constructor(root: string, stateHome = defaultStateHome()) {
    this.root = realpathSync(root);
    if (privateWorkspace(this.root, stateHome))
      throw new Error("Private state cannot be a workspace");
    this.privateRoot = privateRootFor(this.root, stateHome);
    if (contains(this.root, this.privateRoot))
      throw new Error("Private state home must be outside the working copy");
  }
  get lockPath(): string {
    return join(this.privateRoot, "checkout.lock");
  }
  private inspectPrivate(): void {
    const namespace = dirname(this.privateRoot);
    for (const path of [namespace, this.privateRoot]) {
      if (!safeDirectory(path)) continue;
      const st = lstatSync(path);
      if (
        process.platform !== "win32" &&
        ((st.mode & 0o077) !== 0 ||
          (process.getuid && st.uid !== process.getuid()))
      )
        throw new Error("Private state permissions refused");
    }
  }
  protected inspectPrivateFile(path: string, max: number): void {
    this.inspectPrivate();
    if (!safeDirectory(this.privateRoot)) return;
    try {
      const st = lstatSync(path);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.nlink !== 1 ||
        st.size > max ||
        (process.platform !== "win32" &&
          ((st.mode & 0o077) !== 0 ||
            (process.getuid && st.uid !== process.getuid())))
      )
        throw new Error("Unsafe private state file");
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
  inspectLock(): CheckoutLock | undefined {
    this.inspectPrivateFile(this.lockPath, 8192);
    const data = readBounded(this.lockPath, 8192);
    if (!data) return undefined;
    const lock: unknown = parseRecord(data);
    if (
      !object(lock) ||
      lock.schema !== "cadence-assistant-lock/1" ||
      lock.root !== this.root ||
      typeof lock.token !== "string" ||
      !validId(lock.token) ||
      typeof lock.runId !== "string" ||
      !validId(lock.runId) ||
      typeof lock.host !== "string" ||
      !Number.isInteger(lock.pid) ||
      Number(lock.pid) < 1
    )
      throw new Error("Unknown or corrupt coordination lock");
    return lock as unknown as CheckoutLock;
  }
  acquire(): CheckoutLock {
    this.inspectPrivate();
    safeDirectory(this.privateRoot, true);
    const lock: CheckoutLock = {
      schema: "cadence-assistant-lock/1",
      token: randomUUID(),
      runId: randomUUID(),
      pid: process.pid,
      host: hostname(),
      root: this.root,
    };
    let fd: number;
    try {
      fd = retryWindowsFileOperation(() =>
        openSync(this.lockPath, "wx", 0o600),
      );
    } catch {
      throw new Error(
        "Checkout busy or unresolved lock; inspect and explicitly recover only a dead owner",
      );
    }
    try {
      writeFileSync(fd, JSON.stringify(lock));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return lock;
  }
  assertOwner(lock: CheckoutLock): void {
    if (JSON.stringify(this.inspectLock()) !== JSON.stringify(lock))
      throw new Error("Coordination lock changed");
  }
  release(lock: CheckoutLock): void {
    if (lock.pid !== process.pid || lock.host !== hostname())
      throw new Error("Only the owning process may release a lock");
    this.assertOwner(lock);
    retryWindowsFileOperation(
      () => unlinkSync(this.lockPath),
      () => this.assertOwner(lock),
    );
  }
}
