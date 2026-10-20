import { useEffect, useRef, useState } from "react";
import type { CommandObservation } from "../../client/actions";
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
    <section className="receipt" aria-label="Command receipt">
      <h3>Command receipt</h3>
      <code>{value.commandId}</code>
      {value.error && <p role="alert">{value.error}</p>}
      {receipt && (
        <dl>
          <dt>Admission</dt>
          <dd>{receipt.admission}</dd>
          <dt>Execution</dt>
          <dd>{receipt.execution ?? "not settled"}</dd>
          <dt>Publication</dt>
          <dd>{receipt.publication}</dd>
          <dt>Run</dt>
          <dd>{receipt.runId ?? "metadata action"}</dd>
        </dl>
      )}
      {value.lookup && value.lookup.status !== "found" && (
        <p>
          {value.lookup.status}. This observation does not authorize replay.
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
        Observe exact receipt
      </button>
    </section>
  );
}
