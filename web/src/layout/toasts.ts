/* Adapted from pi-web-ui web/src/notice-policy.ts @ b627452c: tiered durations
 * and the deduplicating, capped queue. MIT (c) 2026 xing-shuyin.
 * Cadence: an imperative browser-local store for transient local results. No
 * server notices, suppression patterns or plugin actions; an error stays until
 * dismissed, and nothing here sends, retries or records anything. */

export type ToastLevel = "info" | "warning" | "error";
export interface Toast {
  id: number;
  level: ToastLevel;
  text: string;
  /** A source's toasts replace one another and can be withdrawn together. */
  key?: string;
}

export const MAX_VISIBLE_TOASTS = 3;

/** How long a toast stays, or null: an error is never dismissed by a timer. */
export function toastDurationMs(level: ToastLevel): number | null {
  switch (level) {
    case "error":
      return null;
    case "warning":
      return 4200;
    default:
      return 2400;
  }
}

const same = (a: Toast, b: Toast) =>
  (a.key !== undefined && a.key === b.key) ||
  (a.level === b.level && a.text.trim() === b.text.trim());

/** The queue after `incoming`: it replaces its own repeat or its source's
 * earlier toast, and always shows. Past the cap the oldest non-error goes
 * first, then the oldest error. */
export function enqueueToast<T extends Toast>(
  current: readonly T[],
  incoming: T,
  maxVisible: number = MAX_VISIBLE_TOASTS,
): T[] {
  const next = [...current.filter((toast) => !same(toast, incoming)), incoming];
  while (next.length > maxVisible) {
    const older = next.slice(0, -1);
    const index = older.findIndex((toast) => toast.level !== "error");
    next.splice(Math.max(index, 0), 1);
  }
  return next;
}

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
function publish(next: readonly Toast[]) {
  if (next.length === toasts.length && next.every((t, i) => t === toasts[i]))
    return;
  toasts = next;
  for (const listener of listeners) listener();
}

/** Show a transient local result. The text is already in the reader's
 * language; `key` names the source whose earlier toast this one replaces. */
export function notify(level: ToastLevel, text: string, key?: string): number {
  const id = nextId++;
  publish(enqueueToast(toasts, { id, level, text, ...(key ? { key } : {}) }));
  return id;
}
export function dismissToast(id: number): void {
  publish(toasts.filter((toast) => toast.id !== id));
}
/** Withdraw a source's toasts, for example once its next attempt begins. */
export function dismissToasts(key: string): void {
  publish(toasts.filter((toast) => toast.key !== key));
}
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const currentToasts = (): readonly Toast[] => toasts;
