/* Adapted from pi-web-ui web/src/prompt-history.ts @ b627452c; MIT (c) 2026
 * xing-shuyin. Kept: the normalised, deduplicated, bounded list and the
 * quota-halving write. Cadence: the list lives in sessionStorage, like the
 * drafts, so recalled prompts end with the tab, and is kept per checkout; no
 * settings, character limit or clear action. `stepHistory` is the composer's
 * Up/Down walk as a pure step. */

export const PROMPT_HISTORY_MAX = 100;
const key = (scope: string) => `cadence:prompt-history:${scope}`;

export function normalizeHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    out.push(t);
  }
  return out;
}

export function appendHistory(
  history: string[],
  text: string,
  max: number = PROMPT_HISTORY_MAX,
): string[] {
  const t = text.trim();
  if (!t) return history;
  if (history.length > 0 && history[history.length - 1] === t) return history;
  const next = [...history, t];
  if (next.length > max) return next.slice(next.length - max);
  return next;
}

export function loadPromptHistory(scope: string): string[] {
  try {
    const raw = sessionStorage.getItem(key(scope));
    if (!raw) return [];
    return normalizeHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persist(scope: string, history: string[]): void {
  let cur: string[] | null = history;
  while (cur) {
    try {
      sessionStorage.setItem(key(scope), JSON.stringify(cur));
      return;
    } catch (e) {
      const quota =
        e instanceof DOMException &&
        (e.name === "QuotaExceededError" || e.code === 22);
      if (!quota || cur.length <= 1) return;
      cur = cur.slice(Math.ceil(cur.length / 2));
    }
  }
}

/** Remembers a message the owner accepted; the same text twice in a row is
 * kept once. */
export function pushPromptHistory(scope: string, text: string): void {
  const cur = loadPromptHistory(scope);
  const next = appendHistory(cur, text);
  if (next !== cur) persist(scope, next);
}

/** Where the composer is in the list: -1 while its own draft is shown, which
 * `draft` keeps for the way back. */
export interface HistoryCursor {
  index: number;
  draft: string;
}
export const HISTORY_IDLE: HistoryCursor = { index: -1, draft: "" };

/** One Up (`older`) or Down (`newer`) step: the text to show and the new
 * cursor, or null when there is nowhere to go. Up from the draft keeps it;
 * Down past the newest entry brings it back. */
export function stepHistory(
  history: readonly string[],
  cursor: HistoryCursor,
  direction: "older" | "newer",
  current: string,
): { cursor: HistoryCursor; text: string } | null {
  if (direction === "older") {
    if (!history.length || cursor.index === 0) return null;
    const index =
      cursor.index === -1
        ? history.length - 1
        : Math.min(cursor.index, history.length) - 1;
    return {
      cursor: { index, draft: cursor.index === -1 ? current : cursor.draft },
      text: history[index],
    };
  }
  if (cursor.index === -1) return null;
  const index = cursor.index + 1;
  return index < history.length
    ? { cursor: { index, draft: cursor.draft }, text: history[index] }
    : { cursor: HISTORY_IDLE, text: cursor.draft };
}
