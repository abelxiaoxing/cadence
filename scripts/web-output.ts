// Build-only publication. Never used by the readonly runtime asset loader.
import { cpSync, lstatSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadWebAssets } from "../src/service-assets.ts";
import { safeDirectory } from "../src/task-store.ts";

export function publishedWebIdentity(target: string): string | null {
  if (!safeDirectory(dirname(target)))
    throw new Error("web-parent-unavailable");
  try {
    lstatSync(target); // dangling links are present and must refuse, not be overwritten
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
  return loadWebAssets(target).identity;
}
export function publishWebOutput(
  source: string,
  target: string,
  backup: string,
  expected: string | null,
): void {
  const identity = loadWebAssets(source).identity;
  // Copy/validate fully in private staging before touching the published tree.
  const candidate = join(dirname(backup), "publish-candidate");
  cpSync(source, candidate, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  if (
    loadWebAssets(candidate).identity !== identity ||
    publishedWebIdentity(target) !== expected
  )
    throw new Error("web-publication-changed");
  if (expected !== null) renameSync(target, backup);
  try {
    renameSync(candidate, target);
  } catch (error) {
    // Only restore our exact prior tree; no cleanup/reset of a newly appeared target.
    if (expected !== null) {
      try {
        lstatSync(target);
      } catch (missing) {
        if (
          missing &&
          typeof missing === "object" &&
          "code" in missing &&
          missing.code === "ENOENT"
        )
          renameSync(backup, target);
      }
    }
    throw error;
  }
}
