/** Recorded investigations: which project files an answer cites, whether they
 * still read the same, and how a repeated question is recognized. Reads only;
 * the owner keeps the records in its private state. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { workflowBoundary } from "./contracts/workflow.ts";
import { safeWorkflowFile } from "./workflow-git.ts";

export const INVESTIGATIONS = {
  /** Cited files one record keeps a digest of. */
  cited: 32,
  /** Path-like words of an answer that are looked at. */
  examined: 256,
  /** A larger file is not treated as a citation. */
  fileBytes: 2 * 1024 * 1024,
  /** A recorded answer is given again for the same question only this long. */
  reuseMs: 14 * 24 * 60 * 60 * 1000,
} as const;
export interface CitedFile {
  path: string;
  digest: string;
}
/** The digest of an ordinary project file, or null when the path is not one
 * (absent, unsafe, protected, a directory, or larger than `fileBytes`). */
function fileDigest(root: string, path: string): string | null {
  try {
    if (!workflowBoundary(path)) return null;
    const file = safeWorkflowFile(root, path);
    const st = statSync(file);
    if (!st.isFile() || st.size > INVESTIGATIONS.fileBytes) return null;
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}
/** The project files an answer names, each with the digest it had: what the
 * answer's truth depends on. Words are tried as paths relative to `root`; a
 * trailing `:line` or `#anchor` is not part of the path. */
export function citedFiles(root: string, answer: string): CitedFile[] {
  const cited: CitedFile[] = [];
  const seen = new Set<string>();
  for (const word of answer.split(/[\s`'"()[\]<>,;*|]+/u)) {
    if (seen.size >= INVESTIGATIONS.examined) break;
    const path = word
      .replace(/[:#].*$/u, "")
      .replace(/^\.\//u, "")
      .replace(/[.]+$/u, "");
    if (!/[/.]/u.test(path) || path.length > 512 || seen.has(path)) continue;
    seen.add(path);
    const digest = fileDigest(root, path);
    if (digest === null) continue;
    cited.push({ path, digest });
    if (cited.length >= INVESTIGATIONS.cited) break;
  }
  return cited;
}
/** The cited files that no longer read as recorded (changed or gone). */
export function changedFiles(
  root: string,
  files: readonly CitedFile[],
): string[] {
  return files
    .filter((file) => fileDigest(root, file.path) !== file.digest)
    .map((file) => file.path);
}
/** The same question about the same directories, whatever its spacing. */
export function questionKey(
  question: string,
  roots: readonly string[] | undefined,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        question.trim().replace(/\s+/gu, " "),
        [...(roots ?? [])].sort(),
      ]),
    )
    .digest("hex");
}
