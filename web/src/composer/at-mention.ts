/* Adapted from pi-web-ui web/src/at-mention.ts @ b627452c (`matchAtToken` and
 * its boundary rule); MIT (c) 2026 xing-shuyin.
 * Cadence: the popup completes a path one folder at a time from the existing
 * bounded `files` listing, and inserts the same `@path` text as the Files
 * pane's reference action: a path, never file contents. No page, canvas, skill
 * or plugin providers. */
import type { FileEntry } from "../../../src/service/contracts/workbench.ts";

export interface AtToken {
  /** Where the `@` is. */
  start: number;
  /** What follows it, up to the caret. */
  query: string;
}

function isAtBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  if (ch === "@") return false;
  if (/[A-Za-z0-9_]/.test(ch)) return false;
  return true;
}

/** The `@token` the caret is at the end of: an `@` that starts a word, with no
 * whitespace or second `@` after it. An address such as `a@b` is not one. */
export function matchAtToken(text: string, cursor: number): AtToken | null {
  const src = typeof text === "string" ? text : "";
  const cur = Math.max(
    0,
    Math.min(
      typeof cursor === "number" && Number.isFinite(cursor)
        ? Math.floor(cursor)
        : 0,
      src.length,
    ),
  );
  const before = src.slice(0, cur);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (!isAtBoundary(at > 0 ? before[at - 1] : undefined)) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query)) return null;
  return { start: at, query };
}

/** A token's folder (the listing to read) and the name typed so far in it. */
export function mentionQuery(query: string): { folder: string; name: string } {
  const cut = Math.max(query.lastIndexOf("/"), query.lastIndexOf("\\"));
  return cut < 0
    ? { folder: "", name: query }
    : {
        folder: query.slice(0, cut).replace(/[\\/]+$/, ""),
        name: query.slice(cut + 1),
      };
}

/** Whether a folder can be asked for at all: the read's path is bounded and
 * holds no NUL or unpaired surrogate. Anything else is simply not completed. */
export const mentionReadable = (folder: string): boolean =>
  folder.length <= 1024 && !/[\0\uD800-\uDFFF]/u.test(folder);

export const MENTION_ROWS = 50;
/** The listed entries a typed name narrows to: those starting with it, then
 * those containing it, each in listed order, case ignored. */
export function mentionEntries(
  entries: readonly FileEntry[],
  name: string,
  limit = MENTION_ROWS,
): FileEntry[] {
  const needle = name.toLowerCase();
  if (!needle) return entries.slice(0, limit);
  const starts: FileEntry[] = [];
  const contains: FileEntry[] = [];
  for (const entry of entries) {
    const at = entry.name.toLowerCase().indexOf(needle);
    if (at === 0) starts.push(entry);
    else if (at > 0) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The draft with the token replaced by an entry's path. A file ends the
 * reference with a space; a folder keeps the caret after its separator, so the
 * popup lists what is inside. */
export function applyMention(
  text: string,
  token: AtToken,
  cursor: number,
  entry: Pick<FileEntry, "path" | "directory">,
): { text: string; cursor: number } {
  const separator = entry.path.includes("\\") ? "\\" : "/";
  const inserted = `@${entry.path}${entry.directory ? separator : " "}`;
  const rest = text.slice(cursor);
  return {
    text:
      text.slice(0, token.start) +
      inserted +
      (entry.directory ? rest : rest.replace(/^ /, "")),
    cursor: token.start + inserted.length,
  };
}
