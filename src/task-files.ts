/** Bounded no-follow reads shared by publication, snapshots and context import. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "./directory-sync.ts";
import { observeSafePath } from "./safe-path.ts";
import { TASK_LIMITS, taskError, taskFail } from "./task-records.ts";

function readFileChecked(
  root: string,
  relative: string,
  maximum: number,
  recoveryPeer?: string,
): Uint8Array | null {
  const linksSafe = (stat: ReturnType<typeof fstatSync>): boolean => {
    if (stat.nlink === 1) return true;
    if (
      stat.nlink !== 2 ||
      !recoveryPeer ||
      observeSafePath(root, recoveryPeer).kind !== "file"
    )
      return false;
    const peer = lstatSync(path.join(root, recoveryPeer));
    return (
      peer.isFile() &&
      peer.nlink === 2 &&
      peer.dev === stat.dev &&
      peer.ino === stat.ino
    );
  };
  const observation = observeSafePath(root, relative);
  if (observation.kind === "absent") return null;
  if (observation.kind !== "file") taskFail("task-path-unsafe");
  const file = path.join(root, relative);
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || !linksSafe(before) || before.size > maximum)
      taskFail("task-path-unsafe");
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    for (;;) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!n) break;
      offset += n;
      if (offset === buffer.length) taskFail("task-conflict");
    }
    const after = fstatSync(fd),
      current = lstatSync(file, { throwIfNoEntry: false });
    if (
      !current ||
      !linksSafe(after) ||
      !linksSafe(current) ||
      current.isSymbolicLink() ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      before.size !== offset ||
      after.size !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      observeSafePath(root, relative).kind !== "file"
    )
      taskFail("task-conflict");
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}
function ensureParentsChecked(root: string, relative: string): void {
  const parts = relative.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");
    const observation = observeSafePath(root, parent);
    if (observation.kind === "absent") {
      mkdirSync(path.join(root, parent), { mode: 0o700 });
      syncDirectory(path.dirname(path.join(root, parent)));
    } else if (observation.kind !== "directory") taskFail("task-path-unsafe");
  }
}

export function readTaskFile(
  root: string,
  relative: string,
  maximum: number = TASK_LIMITS.artifactBytes,
  // Publisher-only exact operation sibling; import/review never allow links.
  recoveryPeer?: string,
): Uint8Array | null {
  try {
    return readFileChecked(root, relative, maximum, recoveryPeer);
  } catch (error) {
    return taskError(error, "task-io-failed");
  }
}
export function ensureTaskParents(root: string, relative: string): void {
  try {
    ensureParentsChecked(root, relative);
  } catch (error) {
    taskError(error, "task-io-failed");
  }
}
