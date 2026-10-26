import { useEffect, useState } from "react";
import { decodeModelSelector } from "../../../../src/service-contract.ts";
import { useT } from "../../i18n/locale";
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
  const { t, tx } = useT();
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [selected, setSelected] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .models(abort.signal)
      .then((reply) => {
        if (abort.signal.aborted) return;
        if (reply.kind === "ok") setCatalog(reply.value);
        else setCatalogError(reply.error.code);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCatalogError("unavailable");
      });
    return () => abort.abort();
  }, [client]);
  return (
    <ActionDialog title={t("Choose owner model")} onClose={onClose}>
      <p>
        {t(
          "Explicit owner-wide choice, only while quiescent. This does not resolve credentials, probe a provider, save a plan or Start work.",
        )}
      </p>
      <p>
        {t("Current: {model}", {
          model: catalog?.selected
            ? `${catalog.selected.provider}/${catalog.selected.model} · ${catalog.selected.thinking}`
            : t("No model selected"),
        })}
      </p>
      <label>
        {t("Exact model / API / thinking")}
        <select
          value={selected}
          disabled={!catalog}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{t("Select explicitly")}</option>
          {catalog?.entries.flatMap((entry) =>
            entry.thinking
              .filter((t) => t.selectable)
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
        <p>
          {t("Catalog capacity exceeded; no partial model list is selectable.")}
        </p>
      )}
      {!!catalog?.withheld && (
        <p role="alert">
          {t(
            catalog.withheld === 1
              ? "{count} model withheld: its provider or model ID contains a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; restart the service after editing models.json."
              : "{count} models withheld: their provider or model IDs contain a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; restart the service after editing models.json.",
            { count: catalog.withheld },
          )}
        </p>
      )}
      {catalogError && (
        <p role="alert">
          {t(
            "Model catalog unavailable ({code}); no model is selectable. No automatic retry.",
            { code: tx(catalogError) },
          )}
        </p>
      )}
      {error && (
        <p role="alert">
          {t("{error}. No automatic replacement or retry.", {
            error: tx(error),
          })}
        </p>
      )}
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
        {t("Confirm owner model choice")}
      </button>
    </ActionDialog>
  );
}
