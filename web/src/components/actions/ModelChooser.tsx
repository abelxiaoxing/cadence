import { useEffect, useState } from "react";
import { decodeModelSelector } from "../../../../src/service-contract.ts";
import type { ModelCatalog, ServiceClient } from "../../types";
import { ActionDialog } from "./ActionDialog";
export function ModelChooser({
  client,
  compatible,
  onClose,
  onChanged,
}: {
  client: ServiceClient;
  compatible: boolean;
  onClose(): void;
  onChanged(): void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .models(abort.signal)
      .then((reply) => {
        if (abort.signal.aborted) return;
        if (reply.kind === "ok") setCatalog(reply.value);
        else setError(reply.error.code);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Model catalog unavailable.");
      });
    return () => abort.abort();
  }, [client]);
  return (
    <ActionDialog title="Choose owner model" onClose={onClose}>
      <p>
        Explicit owner-wide choice, only while quiescent. This does not resolve
        credentials, probe a provider, save a plan or Start work.
      </p>
      <p>
        Current:{" "}
        {catalog?.selected
          ? `${catalog.selected.provider}/${catalog.selected.model} · ${catalog.selected.thinking}`
          : "No model selected"}
      </p>
      <label>
        Exact model / API / thinking
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Select explicitly</option>
          {catalog?.entries.flatMap((entry) =>
            entry.thinking
              .filter((t) => t.selectable && t.level !== "max")
              .map((t) => {
                const value = JSON.stringify({
                  provider: entry.provider,
                  model: entry.model,
                  api: entry.api,
                  thinking: t.level,
                });
                return (
                  <option key={value} value={value}>
                    {entry.provider}/{entry.model} · {entry.api} · {t.level}
                  </option>
                );
              }),
          )}
        </select>
      </label>
      {catalog?.status === "capacity" && (
        <p>Catalog capacity exceeded; no partial model list is selectable.</p>
      )}
      {error && <p role="alert">{error}. No automatic replacement or retry.</p>}
      <button
        type="button"
        disabled={!compatible || !catalog || !selected || pending}
        onClick={() => {
          if (!catalog) return;
          setPending(true);
          void client
            .chooseModel({
              expected: catalog.version,
              choice: decodeModelSelector(JSON.parse(selected)),
            })
            .then((reply) => {
              if (reply.kind === "error") setError(reply.error.code);
              else {
                onChanged();
                onClose();
              }
            })
            .catch(() =>
              setError(
                "Choice response unconfirmed; observe catalog before another explicit choice.",
              ),
            )
            .finally(() => setPending(false));
        }}
      >
        Confirm owner model choice
      </button>
    </ActionDialog>
  );
}
