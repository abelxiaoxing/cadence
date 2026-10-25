import { useEffect, useState } from "react";
import { Template, useT } from "../../i18n/locale";
import type { CurrentChanges, ServiceClient } from "../../types";
import { ArtifactPreview } from "./ArtifactPreview";
export function CurrentChangesPanel({
  client,
  storeId,
  taskId,
}: {
  client: ServiceClient;
  storeId: string;
  taskId: string;
}) {
  const { t, tx } = useT();
  const [value, setValue] = useState<CurrentChanges>();
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (revision < 0) return;
    const abort = new AbortController();
    setValue(undefined);
    setError("");
    void client
      .currentChanges({ storeId, taskId }, abort.signal)
      .then((reply) => {
        if (abort.signal.aborted) return;
        if (reply.kind === "ok") setValue(reply.value);
        else setError(reply.error.code);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Current observation unavailable");
      });
    return () => abort.abort();
  }, [client, storeId, taskId, revision]);
  return (
    <section aria-label={t("Current checkout changes")}>
      <h3>{t("Current checkout changes (not a captured historical diff)")}</h3>
      <button type="button" onClick={() => refresh((n) => n + 1)}>
        {t("Observe current changes")}
      </button>
      {error && <p role="alert">{tx(error)}</p>}
      {value && (
        <>
          <p>
            <Template
              text={t(
                "Fingerprint {identity} · {coverage} · includes pre-existing dirt; not attribution.",
              )}
              slots={{
                identity: <code>{value.observation.identity}</code>,
                coverage: value.observation.complete
                  ? t("complete within bounded scope")
                  : t("incomplete coverage"),
              }}
            />
          </p>
          <pre>{JSON.stringify(value.coverage)}</pre>
          <ArtifactPreview text={value.text} />
        </>
      )}
    </section>
  );
}
