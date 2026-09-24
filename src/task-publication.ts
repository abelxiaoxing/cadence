import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "./directory-sync.ts";
import { observeSafePath } from "./safe-path.ts";
import { ensureTaskParents, readTaskFile } from "./task-files.ts";
import {
  parsePortableTask,
  TASK_LIMITS,
  taskError,
  taskFail,
  taskHash,
  taskPublicationPath,
} from "./task-records.ts";
import type { TaskPublication, TaskReview, TaskStore } from "./task-store.ts";

const equal = (a: Uint8Array | null, b: Uint8Array | null): boolean =>
  a === null || b === null ? a === b : Buffer.from(a).equals(b);
export type PublicationBoundary =
  | "intent"
  | "before-claim"
  | "claimed"
  | "written"
  | "delivered";
/** Explicit foreground publication only. Hooks inject crash/edit faults in tests;
 * they are never model callbacks. The store owns the lifetime checkout fence. */
export class TaskPublisher {
  readonly store: TaskStore;
  readonly boundary?: (
    point: PublicationBoundary,
    operation: TaskPublication,
  ) => void;
  constructor(
    store: TaskStore,
    boundary?: (point: PublicationBoundary, operation: TaskPublication) => void,
  ) {
    this.store = store;
    this.boundary = boundary;
  }
  prepare(
    id: string,
    relative: string,
    expected: Uint8Array | null,
    desired: Uint8Array,
    operationId?: string,
  ): TaskPublication {
    taskPublicationPath(id, relative);
    if (relative.endsWith("/task.json")) {
      const record = parsePortableTask(desired);
      if (record.id !== id) taskFail("task-record-invalid");
    } else {
      if (desired.byteLength > TASK_LIMITS.artifactBytes)
        taskFail("task-record-invalid");
      try {
        if (
          new TextDecoder("utf-8", { fatal: true })
            .decode(desired)
            .includes("\0")
        )
          taskFail("task-record-invalid");
      } catch {
        taskFail("task-record-invalid");
      }
    }
    // No repository creation happens before the committed intent.
    const op = this.store.intent(id, relative, expected, desired, operationId);
    this.boundary?.("intent", op);
    return op;
  }
  reconcile(operationId: string): TaskPublication {
    try {
      return this.#reconcile(operationId);
    } catch (error) {
      return taskError(error, "task-io-failed");
    }
  }
  #reconcile(operationId: string): TaskPublication {
    const op = this.store.publication(operationId);
    if (op.state === "delivered") return op;
    const root = this.store.consumerRoot,
      target = path.join(root, op.path);
    const claimRelative = `${op.path}.${op.operationId}.task-claim`,
      claim = path.join(root, claimRelative);
    const conflict = (): TaskPublication => {
      this.store.settle(operationId, "conflict");
      return this.store.publication(operationId);
    };
    ensureTaskParents(root, op.path);
    const installRelative = `${op.path}.${op.operationId}.task-install`;
    const install = path.join(root, installRelative);
    // A restored claim is intentionally still named. Both link identities derive
    // from the committed operation; accept exactly the paired inode, never a
    // random apply temp or an unrelated third link.
    const targetStat = lstatSync(target, { throwIfNoEntry: false });
    const claimStat = lstatSync(claim, { throwIfNoEntry: false });
    const restored =
      !!targetStat &&
      !!claimStat &&
      targetStat.dev === claimStat.dev &&
      targetStat.ino === claimStat.ino;
    const readTarget = () =>
      readTaskFile(
        root,
        op.path,
        TASK_LIMITS.artifactBytes,
        restored ? claimRelative : installRelative,
      );
    const readClaim = () =>
      readTaskFile(root, claimRelative, TASK_LIMITS.artifactBytes, op.path);
    const readInstall = () =>
      readTaskFile(root, installRelative, TASK_LIMITS.artifactBytes, op.path);
    let current = readTarget();
    let claimed = readClaim();
    const staged = readInstall();
    if (staged !== null && !equal(staged, op.desired)) return conflict();
    const finishInstall = (): boolean => {
      if (!equal(readTarget(), op.desired)) return false;
      if (readInstall() !== null) {
        const a = lstatSync(target),
          b = lstatSync(install);
        if (
          a.dev !== b.dev ||
          a.ino !== b.ino ||
          !equal(readInstall(), op.desired)
        )
          return false;
        // Only the desired-byte install alias is removed. The original editor
        // inode is never unlinked by this protocol, even after delivery.
        unlinkSync(install);
        syncDirectory(path.dirname(target));
      }
      return true;
    };
    // An interrupted rename may have removed the target. Only the exact expected
    // bytes are recoverable automatically; unknown claims remain recovery material.
    if (
      claimed !== null &&
      (op.expected === null || !equal(claimed, op.expected))
    )
      return conflict();
    if (equal(current, op.desired)) {
      if (!finishInstall()) return conflict();
      this.store.settle(operationId, "delivered");
      this.boundary?.("delivered", op);
      return this.store.publication(operationId);
    }
    const restore = (): void => {
      if (
        observeSafePath(root, path.posix.dirname(op.path)).kind !== "directory"
      )
        taskFail("task-path-unsafe");
      try {
        linkSync(claim, target);
        // Do not unlink the claim: it names a possibly still-open editor inode.
        syncDirectory(path.dirname(target));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    };
    if (claimed === null) {
      if (!equal(current, op.expected)) return conflict();
      this.boundary?.("before-claim", op);
      // Recheck path safety after any asynchronous/external boundary. Never
      // rename desired bytes onto a target: move the old file out, validate it,
      // then install through an exclusive hard link (same discipline as apply).
      if (
        observeSafePath(root, op.path).kind !==
          (op.expected === null ? "absent" : "file") ||
        lstatSync(claim, { throwIfNoEntry: false })
      )
        return conflict();
      if (op.expected !== null) {
        renameSync(target, claim);
        syncDirectory(path.dirname(target));
        claimed = readTaskFile(root, claimRelative);
        if (!equal(claimed, op.expected)) {
          // Preserve an edit that raced the initial observation. Restoration is
          // exclusive too; a competing new target and the claim both survive.
          restore();
          return conflict();
        }
      }
    } else if (current !== null) return conflict();
    this.boundary?.("claimed", op);
    // Revalidate the claim: an editor retaining the renamed inode must not have
    // its latest bytes removed as though they were ours.
    if (
      op.expected !== null &&
      !equal(readTaskFile(root, claimRelative), op.expected)
    ) {
      if (readTaskFile(root, op.path) === null) restore();
      return conflict();
    }
    if (observeSafePath(root, path.posix.dirname(op.path)).kind !== "directory")
      taskFail("task-path-unsafe");
    if (staged === null) {
      const fd = openSync(install, "wx", 0o600);
      try {
        writeFileSync(fd, op.desired);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      syncDirectory(path.dirname(target));
    }
    if (!equal(readInstall(), op.desired)) return conflict();
    try {
      linkSync(install, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return conflict();
      throw error;
    }
    syncDirectory(path.dirname(target));
    if (!finishInstall()) return conflict();
    this.boundary?.("written", op);
    current = readTarget();
    if (!equal(current, op.desired)) return conflict();
    // This check can report drift, not exclude a later retained-fd save. Keep
    // the original inode at its deterministic claim path even after delivery.
    // G1 has no automatic cleanup policy for this recovery material.
    if (op.expected !== null && !equal(readClaim(), op.expected))
      return conflict();
    this.store.settle(operationId, "delivered");
    this.boundary?.("delivered", op);
    return this.store.publication(operationId);
  }
  freezeReview(id: string): TaskReview {
    const record = this.store.get(id),
      supplied = new Map<string, Uint8Array>();
    const artifacts = record.artifacts.filter((a) =>
      ["brief", "requirements", "design", "plan"].includes(a.role),
    );
    if (
      artifacts.reduce((sum, a) => sum + a.bytes, 0) > TASK_LIMITS.artifactBytes
    )
      taskFail("task-review-stale");
    let remaining = TASK_LIMITS.artifactBytes;
    for (const a of artifacts) {
      const content = readTaskFile(
        this.store.consumerRoot,
        `.cadence/tasks/${id}/${a.path}`,
        Math.min(a.bytes, remaining),
      );
      if (!content) taskFail("task-review-stale");
      remaining -= content.byteLength;
      supplied.set(a.path, content);
    }
    return this.store.freezeReview(id, supplied);
  }
  reviewCurrent(id: string, revision: number): boolean {
    const review = this.store.review(id, revision);
    return review.artifacts.every((a) => {
      const bytes = readTaskFile(
        this.store.consumerRoot,
        `.cadence/tasks/${id}/${a.path}`,
      );
      return (
        bytes !== null &&
        bytes.byteLength === a.bytes &&
        taskHash(bytes) === a.sha256
      );
    });
  }
}
