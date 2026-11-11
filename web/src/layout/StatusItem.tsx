/* Adapted from pi-web-ui components/BarItem.tsx bottom-bar items (connection
 * with its latency, message count, working timer) and FooterBar.tsx.
 * MIT (c) 2026 xing-shuyin.
 * Presentation only: every value is an observation its caller already holds.
 * No layout editing, plugin slots, cost statistics or host metrics; the open
 * conversation's context size and cache hit are their own items
 * (`ContextStatus.tsx`, `CacheStatus.tsx`). */
import { type ReactNode, useEffect, useState } from "react";
import { useT } from "../i18n/locale";

export function StatusItem({
  icon,
  dot,
  tone,
  tip,
  role,
  children,
}: {
  icon?: ReactNode;
  /** A state dot instead of an icon: `ok`, `busy`, `error` or plain. */
  dot?: string;
  tone?: "faint" | "warn";
  tip?: string;
  role?: "status";
  children: ReactNode;
}) {
  return (
    <span
      className={`status-item${tone ? ` ${tone}` : ""}`}
      title={tip}
      role={role}
    >
      {dot !== undefined && (
        <span className={`status-dot ${dot}`} aria-hidden="true" />
      )}
      {icon && (
        <span className="bar-item-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="bar-item-text">{children}</span>
    </span>
  );
}

/** The connection item: its state dot and statement, then the round trip to
 * the service in milliseconds when recent requests have shown one. */
export function ConnectionStatus({
  dot,
  tip,
  latency,
  children,
}: {
  dot: string;
  tip: string;
  /** Whole milliseconds, or null while none is known or the state is not one
   * a round trip describes. */
  latency: number | null;
  children: ReactNode;
}) {
  const { t } = useT();
  const title =
    latency === null
      ? tip
      : `${t("Network latency: {ms}ms (the fastest request to the service in the last minute, from sending to the first byte of its reply).", { ms: latency })} ${tip}`;
  return (
    <span className="status-item status-conn" title={title}>
      <span className={`status-dot ${dot}`} aria-hidden="true" />
      {/* Only the statement is announced when it changes, not every new
          latency figure beside it. */}
      <span className="bar-item-text" role="status">
        {children}
      </span>
      {latency !== null && (
        <span
          className={`status-latency ${latency < 100 ? "ok" : latency < 300 ? "mid" : "warn"}`}
        >
          {latency}ms
        </span>
      )}
    </span>
  );
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return seconds < 3600
    ? `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
    : `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** A live reply: a spinner, its label and the time since the turn began.
 * `since` is the turn's recorded start (epoch ms); 0 shows no duration. */
export function WorkingStatus({
  since,
  label,
}: {
  since: number;
  label: string;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  const elapsed = since ? formatElapsed(now - since) : "";
  return (
    <span
      className="status-item working"
      title={elapsed ? `${label} · ${elapsed}` : label}
    >
      <span className="working-spin" aria-hidden="true" />
      <span className="bar-item-text">{label}</span>
      {elapsed && <span className="bar-item-duration">{elapsed}</span>}
    </span>
  );
}
