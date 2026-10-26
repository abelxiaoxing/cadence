import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/locale";
import type {
  Action,
  CheckObligations,
  ListRequest,
  ServiceClient,
} from "../../types";
import { ObservationPanel } from "./ObservationPanel";
export function CheckPanel({
  client,
  taskId,
  seed,
  canAct,
  onAction,
  onObligations,
}: {
  client: ServiceClient;
  taskId: string;
  seed: ListRequest;
  canAct: boolean;
  onAction: (a: Action) => void;
  onObligations: (c: CheckObligations) => void;
}) {
  const { t, tx } = useT();
  const [checks, setChecks] = useState<CheckObligations>(),
    [error, setError] = useState<string>(),
    [reload, setReload] = useState(0);
  const observedRequest = useRef(reload);
  observedRequest.current = reload;
  useEffect(() => {
    const ticket = reload;
    const controller = new AbortController();
    let current = true;
    setChecks(undefined);
    void client
      .checkObligations(taskId, controller.signal)
      .then((reply) => {
        if (!current || observedRequest.current !== ticket) return;
        if (reply.kind === "error") setError(reply.error.code);
        else {
          setError(undefined);
          setChecks(reply.value);
          onObligations(reply.value);
        }
      })
      .catch(() => {
        if (current) setError("Obligations unavailable.");
      });
    return () => {
      controller.abort();
      current = false;
    };
  }, [client, taskId, reload, onObligations]);
  return (
    <section>
      <h3>{t("Current configured obligations")}</h3>
      <button type="button" onClick={() => setReload((n) => n + 1)}>
        {t("Observe obligations")}
      </button>
      {error && (
        <p role="alert">
          {t("Obligations unavailable: {error}", { error: tx(error) })}
        </p>
      )}
      {checks?.definitions.length === 0 && (
        <p>
          {t("No configured obligations. This is not passing check coverage.")}
        </p>
      )}
      {checks?.definitions.map((d) => (
        <article key={d.selection.name}>
          <h4>
            {d.selection.name}: {tx(d.status)}
          </h4>
          <pre>{d.selection.command}</pre>
          <p>
            {t(
              "Timeout {timeout} ms. Native outcome and freshness remain separate.",
              { timeout: d.selection.timeoutMs },
            )}
          </p>
          <button
            type="button"
            disabled={!canAct}
            onClick={() =>
              onAction({ kind: "check", taskId, check: d.selection })
            }
          >
            {t("Preview exact configured check")}
          </button>
        </article>
      ))}
      <p>
        {t(
          "Browser checks are configured selections only. Native-local manual commands are not a browser shell endpoint.",
        )}
      </p>
      <ObservationPanel client={client} seed={{ ...seed, reader: "checks" }} />
    </section>
  );
}
