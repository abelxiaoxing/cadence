/** Immutable placement, not a sandbox or permission to create a workspace.
 * The owner supplies paths; tools never discover a different cwd or create Git trees. */
import { isAbsolute, relative, resolve, sep } from "node:path";

export function withinRoot(root, path) {
  const part = relative(root, path);
  return (
    part === "" ||
    (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`))
  );
}
const absolute = (value) => {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))
    throw new Error("Invalid execution directory");
  return resolve(value);
};

export function bindWorkerWorkspace(cwd, roots = [cwd]) {
  cwd = absolute(cwd);
  if (!Array.isArray(roots) || !roots.length || roots.length > 8)
    throw new Error("Invalid investigation roots");
  return Object.freeze({
    cwd,
    roots: Object.freeze(
      roots.map((root) => {
        if (
          typeof root !== "string" ||
          !root ||
          root.length > 4096 ||
          root.includes("\0")
        )
          throw new Error("Invalid investigation root");
        return resolve(cwd, root);
      }),
    ),
  });
}

/** Preserve a pinned conversation's relative cwd in an owner-selected tree.
 * Filesystem validation/empty-directory preparation remain with the owner. */
export function executionDirectory(execution, tree) {
  const origin = absolute(execution.checkoutRoot);
  const cwd = absolute(execution.cwd);
  tree = absolute(tree);
  if (!withinRoot(origin, cwd))
    throw new Error("Execution cwd escaped its checkout");
  return resolve(tree, relative(origin, cwd));
}
