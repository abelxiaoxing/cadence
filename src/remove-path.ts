import { lstatSync, readdirSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";

/** Remove owned paths without following directory links. Node 24.13's Windows
 * rmSync uses narrow std::filesystem paths and can silently miss Unicode names.
 * The libuv-backed unlink/rmdir APIs preserve the original UTF-16 path. */
export function removePathSync(
  target: string,
  options: { recursive?: boolean; force?: boolean } = {},
): void {
  if (process.platform !== "win32") {
    rmSync(target, options);
    return;
  }
  let stat: import("node:fs").Stats;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if (options.force && (error as NodeJS.ErrnoException).code === "ENOENT")
      return;
    throw error;
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    if (!options.recursive)
      throw Object.assign(new Error("Path is a directory"), {
        code: "ERR_FS_EISDIR",
      });
    for (const name of readdirSync(target))
      removePathSync(path.join(target, name), options);
    rmdirSync(target);
  } else unlinkSync(target);
}
