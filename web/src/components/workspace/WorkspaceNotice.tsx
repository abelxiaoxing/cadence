import { useT } from "../../i18n/locale";

/** One observation warning, independent of local operation errors. Reading state
 * never prepares execution, retries a message or renews plan approval. */
export function WorkspaceNotice({
  error,
  observationError,
  projectObservationError,
  unavailable = false,
  onRefresh,
}: {
  error?: string;
  observationError?: string;
  projectObservationError?: string;
  unavailable?: boolean;
  onRefresh?(): void;
}) {
  const { t } = useT();
  const warning = unavailable || observationError || projectObservationError;
  if (!error && !warning) return null;
  return (
    <>
      {error && (
        <p className="banner-notice" role="alert">
          {error}
        </p>
      )}
      {warning && (
        <section
          className="workspace-notice"
          aria-label={t("Observation status")}
        >
          <div className="workspace-notice-summary">
            <p role="status">
              <strong>{t("Latest state unavailable.")}</strong>{" "}
              {t("Started work may still be running. No message is resent.")}
            </p>
            {onRefresh && (
              <button type="button" onClick={onRefresh}>
                {t("Observe current state")}
              </button>
            )}
          </div>
          {(observationError || projectObservationError) && (
            <details>
              <summary>{t("Diagnostic details")}</summary>
              {projectObservationError && (
                <p>
                  {t("Project observation: {code}.", {
                    code: projectObservationError,
                  })}
                </p>
              )}
              {observationError && (
                <p>
                  {t("Viewer observation: {code}.", { code: observationError })}
                </p>
              )}
              {(observationError === "stale" ||
                projectObservationError === "stale") && (
                <p>
                  {t(
                    "Context changed. Read the current state before confirming a plan.",
                  )}
                </p>
              )}
            </details>
          )}
        </section>
      )}
    </>
  );
}
