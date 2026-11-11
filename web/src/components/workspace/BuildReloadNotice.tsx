import { useT } from "../../i18n/locale";

/** An old loaded page cannot safely mutate a replaced gateway. Reloading is
 * always explicit: unsent images and other memory-only state must not be lost
 * automatically, and no message or preparation is replayed. */
export function BuildReloadNotice() {
  const { t } = useT();
  return (
    <section className="workspace-notice" aria-label={t("WebUI compatibility")}>
      <div className="workspace-notice-summary">
        <p role="status">
          <strong>{t("Reload the updated Cadence WebUI.")}</strong>{" "}
          {t(
            "This page is no longer compatible with the service. Reload before sending or changing folders; text drafts stay in this tab, but unsent images do not.",
          )}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          {t("Reload WebUI")}
        </button>
      </div>
    </section>
  );
}
