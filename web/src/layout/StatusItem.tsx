/* Adapted from pi-web-ui components/BarItem.tsx bottom-bar items (connection,
 * message count, working timer) and FooterBar.tsx. MIT (c) 2026 xing-shuyin.
 * Presentation only: every value is an observation its caller already holds.
 * No layout editing, plugin slots, token/cost statistics or host metrics. */
import { type ReactNode, useEffect, useState } from "react";

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
