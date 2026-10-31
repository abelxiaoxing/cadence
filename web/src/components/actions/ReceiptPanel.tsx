import { useEffect, useRef, useState } from "react";
import type { CommandObservation } from "../../client/receipts";
import { useT } from "../../i18n/locale";
import type { ServiceClient } from "../../types";
export function ReceiptPanel({
  client,
  value,
  onChange,
}: {
  client: ServiceClient;
  value: CommandObservation;
  onChange: (r: CommandObservation) => void;
}) {
  const { t, tx } = useT();
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const receipt =
    value.receipt ??
    (value.lookup?.status === "found" ? value.lookup.receipt : undefined);
  return (
    <section className="receipt" aria-label={t("Command receipt")}>
      <h3>{t("Command receipt")}</h3>
      <code>{value.commandId}</code>
      {value.error && <p role="alert">{tx(value.error)}</p>}
      {receipt && (
        <dl>
          <dt>{t("Admission")}</dt>
          <dd>{tx(receipt.admission)}</dd>
          <dt>{t("Execution")}</dt>
          <dd>
            {receipt.execution ? tx(receipt.execution) : t("not settled")}
          </dd>
          <dt>{t("Publication")}</dt>
          <dd>{tx(receipt.publication)}</dd>
          <dt>{t("Run")}</dt>
          <dd>{receipt.runId ?? t("metadata action")}</dd>
        </dl>
      )}
      {value.lookup && value.lookup.status !== "found" && (
        <p>
          {t("{status}. This observation does not authorize replay.", {
            status: tx(value.lookup.status),
          })}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          pending.current = new AbortController();
          void client
            .receipt(value.commandId, pending.current.signal)
            .then((lookup) => {
              if (!alive.current) return;
              onChange({ commandId: value.commandId, lookup });
              setBusy(false);
            });
        }}
      >
        {t("Observe exact receipt")}
      </button>
    </section>
  );
}
