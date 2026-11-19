import { useEffect, useRef, useState } from "react";
import { FiChevronUp } from "react-icons/fi";
import { LIMITS } from "../../../../src/service-contract.ts";
import { refusedAccess } from "../../client/observation-read";
import { type MessageKey, useT } from "../../i18n/locale";
import { ConnectionStatus } from "../../layout/StatusItem";

const statements = {
  folder: "Choose a working folder",
  connecting: "Connecting…",
  updating: "Updating state…",
  chat: "Chat ready",
  task: "Task up to date",
  stopped: "Execution stopped",
  "not-started": "Execution not started",
  independent: "Browsing only",
} as const satisfies Record<string, MessageKey>;

export function accessRevoked(error?: string) {
  return (
    refusedAccess(error) ||
    error === "Access revoked; explicit token re-entry required."
  );
}

/** This disclosure occupies the same footer slot throughout a handoff. It
 * observes no service and supplies no authority to callers. */
export function WorkspaceConnection({
  phase,
  entryError,
  projectStatus,
  projectError,
  viewerError,
  historyError,
  readErrors = [],
  prepareOnly,
  retained,
  latency,
  onRefresh,
}: {
  phase: keyof typeof statements;
  entryError?: string;
  projectStatus?: string;
  projectError?: string;
  viewerError?: string;
  historyError?: string;
  readErrors?: readonly (readonly [MessageKey, string | undefined])[];
  prepareOnly?: boolean;
  retained: boolean;
  latency: number | null;
  onRefresh(): void;
}) {
  const { t, tx } = useT();
  const diagnostic = (reason: string) => {
    const text =
      reason === "socket-timeout"
        ? t("No recent update from the task connection")
        : reason === "socket-closed"
          ? t("The task connection closed")
          : tx(reason);
    // Preserve the wire code beside a translated cause for support reports.
    return text !== reason && /^[a-z][a-z-]*$/.test(reason)
      ? `${text} (${reason})`
      : text;
  };
  const pending = phase === "updating" || phase === "connecting";
  // Keep a diagnosed problem during retry, until a positive observation
  // supersedes it. App keys this display lifetime to the selected view.
  const failure = useRef<{
    entryError?: string;
    projectError?: string;
    viewerError?: string;
    historyError?: string;
  }>(undefined);
  if (entryError || projectError || viewerError || historyError)
    failure.current = { entryError, projectError, viewerError, historyError };
  else if (!pending) failure.current = undefined;
  const cause = failure.current;
  const revoked =
    accessRevoked(cause?.entryError) ||
    accessRevoked(cause?.projectError) ||
    accessRevoked(cause?.viewerError);
  // Even repeated quiet reconnects without an error frame cannot stay an
  // initial spinner indefinitely. This changes only the words, not retries.
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!pending) {
      setOverdue(false);
      return;
    }
    const timer = setTimeout(() => setOverdue(true), LIMITS.staleMs);
    return () => clearTimeout(timer);
  }, [pending]);
  const unavailable =
    !!cause || readErrors.some(([, code]) => code) || (pending && overdue);
  const label = t(
    revoked
      ? "Sign-in required"
      : unavailable
        ? retained
          ? "Last known state"
          : "Latest state unavailable."
        : statements[phase],
  );
  const dot = unavailable
    ? "error"
    : pending
      ? "busy"
      : phase === "task" || phase === "chat"
        ? "ok"
        : "";
  return (
    <details
      className="workspace-connection"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
    >
      <summary aria-label={t("Connection status: {state}", { state: label })}>
        <ConnectionStatus
          dot={dot}
          tip={t("Connection freshness is not execution outcome.")}
          latency={dot === "ok" || dot === "" ? latency : null}
        >
          {label}
        </ConnectionStatus>
        <FiChevronUp aria-hidden="true" />
      </summary>
      <div className="connection-details">
        <strong>{t("Observation status")}</strong>
        {projectStatus && (
          <p>
            {t("Execution service: {status}", { status: tx(projectStatus) })}
          </p>
        )}
        {phase === "independent" && (
          <p>
            {t(
              "This owner is running independently. Browsing history does not connect it to this workbench.",
            )}
          </p>
        )}
        {(phase === "stopped" || phase === "not-started") && (
          <p>{t("Ready to prepare execution")}</p>
        )}
        {unavailable && (
          <p>{t("Started work may still be running. No message is resent.")}</p>
        )}
        {cause?.entryError && (
          <p>
            {t("Workbench observation: {code}.", {
              code: diagnostic(cause.entryError),
            })}
          </p>
        )}
        {cause?.projectError && (
          <p>
            {t("Project observation: {code}.", {
              code: diagnostic(cause.projectError),
            })}
          </p>
        )}
        {cause?.historyError && (
          <p>
            {t("Recorded history unavailable: {reason}.", {
              reason: diagnostic(cause.historyError),
            })}
          </p>
        )}
        {prepareOnly && (
          <p>
            {t(
              "Conversation context is unavailable. Send can prepare execution, but cannot submit this draft until the context is observed.",
            )}
          </p>
        )}
        {readErrors.map(
          ([label, code]) =>
            code && <p key={label}>{t(label, { code: diagnostic(code) })}</p>,
        )}
        {cause?.viewerError && (
          <p>
            {t("Viewer observation: {code}.", {
              code: diagnostic(cause.viewerError),
            })}
          </p>
        )}
        {(cause?.viewerError === "stale" ||
          cause?.projectError === "stale") && (
          <p>
            {t(
              "Context changed. Read the current state before confirming a plan.",
            )}
          </p>
        )}
        {pending && !cause && (
          <p>{t("Waiting for current state from this connection.")}</p>
        )}
        {revoked ? (
          <button type="button" onClick={() => window.location.reload()}>
            {t("Sign in again")}
          </button>
        ) : (
          <button type="button" onClick={onRefresh}>
            {t("Observe current state")}
          </button>
        )}
      </div>
    </details>
  );
}
