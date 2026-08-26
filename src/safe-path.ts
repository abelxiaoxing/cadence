import { lstatSync } from "node:fs";
import path from "node:path";

import { isValidRelativePath } from "./contracts.ts";

export type SafePathObservation =
  | { kind: "file" }
  | { kind: "directory" }
  | { kind: "absent" }
  | {
      kind: "unsafe";
      reason:
        | "invalid-path"
        | "root-unavailable"
        | "path-unavailable"
        | "symlink"
        | "parent-not-directory"
        | "special-file";
    };

export function observeSafePath(
  root: string,
  relative: string,
): SafePathObservation {
  if (!isValidRelativePath(relative)) {
    return { kind: "unsafe", reason: "invalid-path" };
  }
  try {
    const resolvedRoot = path.resolve(root);
    const rootStat = lstatSync(resolvedRoot, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
      return { kind: "unsafe", reason: "root-unavailable" };
    }
    if (relative === ".") return { kind: "directory" };

    let current = resolvedRoot;
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      if (!current.startsWith(`${resolvedRoot}${path.sep}`)) {
        return { kind: "unsafe", reason: "invalid-path" };
      }
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (!stat) return { kind: "absent" };
      if (stat.isSymbolicLink()) {
        return { kind: "unsafe", reason: "symlink" };
      }
      if (index < parts.length - 1) {
        if (!stat.isDirectory()) {
          return { kind: "unsafe", reason: "parent-not-directory" };
        }
        continue;
      }
      if (stat.isFile()) return { kind: "file" };
      if (stat.isDirectory()) return { kind: "directory" };
      return { kind: "unsafe", reason: "special-file" };
    }
  } catch {
    return { kind: "unsafe", reason: "path-unavailable" };
  }
  return { kind: "unsafe", reason: "invalid-path" };
}

export function isSafeRegularFile(root: string, relative: string): boolean {
  return observeSafePath(root, relative).kind === "file";
}
