/** Composer model control: the current owner model on the button, a searchable
 * list grouped by provider and a separate thinking level in an anchored panel.
 * One click is one explicit choice; a saved preference is only displayed here,
 * and Send alone installs it. Nothing here probes a provider or starts work. */
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiCheck, FiChevronDown, FiCpu, FiSearch } from "react-icons/fi";
import {
  decodeModelSelector,
  thinkingLevels,
} from "../../../../src/service-contract.ts";
import { type MessageKey, useT } from "../../i18n/locale";
import type {
  ModelCandidate,
  ModelCatalog,
  ModelSelector,
  ServiceClient,
} from "../../types";

type Level = ModelSelector["thinking"];
const LEVEL_LABELS: Record<Level, MessageKey> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};
const MODEL_ERRORS: Record<string, MessageKey> = {
  conflict:
    "A reply or workflow is still running in this project. Switch models after it finishes.",
  stale: "The model list changed and was read again. Choose once more.",
  "auth-unavailable":
    "This model's credentials are unavailable. Check auth.json or the provider's API key.",
  "unsupported-context": "This model or thinking level is not supported.",
  uncertain:
    "The choice was not confirmed. The list was read again; check the current model before choosing again.",
};

const same = (a: ModelSelector, b: ModelSelector) =>
  a.provider === b.provider &&
  a.model === b.model &&
  a.api === b.api &&
  a.thinking === b.thinking;
const sameModel = (entry: ModelCandidate, model: ModelSelector | null) =>
  !!model &&
  entry.provider === model.provider &&
  entry.model === model.model &&
  entry.api === model.api;
/** The offered level closest to the wanted one (the lower one on a tie). */
export function nearestLevel(entry: ModelCandidate, wanted: Level): Level {
  const offered = entry.thinking
    .filter((t) => t.selectable)
    .map((t) => t.level);
  if (offered.includes(wanted)) return wanted;
  const at = (level: Level) => thinkingLevels.indexOf(level);
  return offered.reduce((best, level) =>
    Math.abs(at(level) - at(wanted)) < Math.abs(at(best) - at(wanted))
      ? level
      : best,
  );
}
/** Short button text for a selection. */
export function useModelLabel() {
  const { t } = useT();
  return useCallback(
    (model: ModelSelector) =>
      `${model.model} · ${t(LEVEL_LABELS[model.thinking])}`,
    [t],
  );
}

export function ModelPicker({
  client,
  enabled,
  locked,
  refresh,
  open,
  onOpenChange,
  onChanged,
  onChosen,
  onObserved,
  awaitingSend = false,
}: {
  client: Pick<ServiceClient, "models" | "chooseModel">;
  /** A compatible, current owner; otherwise nothing is chosen here. */
  enabled: boolean;
  /** This conversation's reply is live; the owner refuses a change now. */
  locked: boolean;
  /** Any change re-reads the catalog (a choice restored by Send). Opening
   * the panel always re-reads; nothing else polls the model sources. */
  refresh: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** An installed choice changed the owner configuration. */
  onChanged(): void;
  /** The panel closed on an installed choice. */
  onChosen?(choice: ModelSelector): void;
  onObserved?(catalog: ModelCatalog): void;
  /** A Send is waiting for this choice and continues after it. */
  awaitingSend?: boolean;
}) {
  const { t } = useT();
  const label = useModelLabel();
  const observed = useRef(onObserved);
  observed.current = onObserved;
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [catalogError, setCatalogError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [reads, setReads] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const reread = useCallback(() => setReads((n) => n + 1), []);
  useEffect(() => {
    void refresh;
    void reads;
    const abort = new AbortController();
    void client
      .models(abort.signal)
      .then((reply) => {
        if (abort.signal.aborted) return;
        if (reply.kind === "ok") {
          setCatalog(reply.value);
          observed.current?.(reply.value);
          setCatalogError("");
        } else setCatalogError(reply.error.code);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCatalogError("unavailable");
      });
    return () => abort.abort();
  }, [client, refresh, reads]);
  // Opening always shows a fresh list (another client may have chosen).
  useEffect(() => {
    if (open) reread();
  }, [open, reread]);
  const close = useCallback(
    (focus = true) => {
      onOpenChange(false);
      setQuery("");
      if (focus) trigger.current?.focus({ preventScroll: true });
    },
    [onOpenChange],
  );
  useEffect(() => {
    if (!open) return;
    setError("");
    search.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close]);
  const selected = catalog?.selected ?? null;
  const current: ModelSelector | null = selected ?? catalog?.remembered ?? null;
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, ModelCandidate[]>();
    for (const entry of catalog?.entries ?? []) {
      if (
        needle &&
        !`${entry.provider}/${entry.model}`.toLowerCase().includes(needle)
      )
        continue;
      map.set(entry.provider, [...(map.get(entry.provider) ?? []), entry]);
    }
    return [...map];
  }, [catalog, query]);
  const currentEntry = catalog?.entries.find((entry) =>
    sameModel(entry, current),
  );
  const selectionEnabled = enabled && !catalogError;
  const choose = async (entry: ModelCandidate, level: Level) => {
    if (!selectionEnabled || !catalog || !entry.api || pending || locked)
      return;
    const choice = decodeModelSelector({
      provider: entry.provider,
      model: entry.model,
      api: entry.api,
      thinking: level,
    });
    if (selected && same(selected, choice)) {
      close();
      onChosen?.(choice);
      return;
    }
    setPending(true);
    setError("");
    try {
      const reply = await client.chooseModel({
        expected: catalog.version,
        choice,
      });
      if (reply.kind === "error") {
        setError(reply.error.code);
        reread();
        return;
      }
      const next = {
        ...catalog,
        version: reply.value.version,
        selected: reply.value.selected,
      };
      setCatalog(next);
      observed.current?.(next);
      onChanged();
      close();
      onChosen?.(choice);
    } catch {
      setError("uncertain");
      reread();
    } finally {
      setPending(false);
    }
  };
  const options = () =>
    [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        "button[role=option]:not(:disabled)",
      ) ?? []),
    ] as HTMLButtonElement[];
  const onListKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) search.current?.focus();
    else all[Math.min(next, all.length - 1)]?.focus();
  };
  const unavailable = !enabled || (!catalog && !!catalogError);
  const buttonText = !catalog
    ? catalogError
      ? t("Model unavailable")
      : t("Model")
    : current
      ? label(current)
      : t("Choose a model");
  return (
    <div className="model-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`model-trigger${current && !selected ? " remembered" : ""}${catalog && !current ? " empty" : ""}`}
        aria-label={t("Model: {model}", { model: buttonText })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          locked
            ? t("Switch models after the current reply finishes.")
            : current && !selected
              ? t("Last used model; it is used again when you send.")
              : current
                ? `${current.provider}/${current.model} · ${current.api}`
                : undefined
        }
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <FiCpu aria-hidden="true" />
        <span className="model-trigger-text">{buttonText}</span>
        <FiChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div
          className="model-popover"
          role="dialog"
          aria-label={t("Choose a model")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          {awaitingSend && (
            <p className="model-popover-lead">
              {t("Choose a model; your message is sent right after.")}
            </p>
          )}
          <label className="model-search">
            <FiSearch aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label={t("Search models")}
              placeholder={t("Search models…")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  options()[0]?.focus();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  options()[0]?.click();
                }
              }}
            />
          </label>
          <div
            className="model-list"
            role="listbox"
            aria-label={t("Models")}
            ref={list}
            onKeyDown={onListKey}
          >
            {!catalog && !catalogError && (
              <p className="model-empty">{t("Reading models…")}</p>
            )}
            {groups.map(([provider, entries]) => (
              <fieldset key={provider} className="model-group">
                <legend className="model-group-label">{provider}</legend>
                {entries.map((entry) => {
                  const usable = entry.eligibility === "candidate";
                  const isCurrent = sameModel(entry, current);
                  return (
                    <button
                      key={`${entry.provider}/${entry.model}`}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      className="model-option"
                      disabled={
                        !selectionEnabled || !usable || pending || locked
                      }
                      title={`${entry.provider}/${entry.model}${entry.api ? ` · ${entry.api}` : ""}`}
                      onClick={() =>
                        void choose(
                          entry,
                          nearestLevel(entry, current?.thinking ?? "medium"),
                        )
                      }
                    >
                      <span className="model-option-name">{entry.model}</span>
                      {!usable && (
                        <span className="model-option-note">
                          {entry.eligibility === "auth-unavailable"
                            ? t("Credentials unavailable")
                            : t("Not supported")}
                        </span>
                      )}
                      {isCurrent && !selected && (
                        <span className="model-option-note">
                          {t("Used when you send")}
                        </span>
                      )}
                      {isCurrent && (
                        <FiCheck
                          className="model-option-check"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </fieldset>
            ))}
            {catalog?.status === "complete" && groups.length === 0 && (
              <p className="model-empty">
                {query.trim()
                  ? t("No matching models.")
                  : t(
                      "No models are configured. Add a provider to Pi's models.json or auth.json, then restart the service.",
                    )}
              </p>
            )}
          </div>
          {currentEntry && currentEntry.thinking.length > 1 && (
            <div className="model-thinking">
              <span className="model-thinking-label">{t("Thinking")}</span>
              {currentEntry.thinking.map((level) => (
                <button
                  key={level.level}
                  type="button"
                  aria-label={t("Thinking level: {level}", {
                    level: t(LEVEL_LABELS[level.level]),
                  })}
                  aria-pressed={current?.thinking === level.level}
                  disabled={
                    !selectionEnabled || !level.selectable || pending || locked
                  }
                  onClick={() => void choose(currentEntry, level.level)}
                >
                  {t(LEVEL_LABELS[level.level])}
                </button>
              ))}
            </div>
          )}
          <div className="model-popover-notes">
            {!enabled && (
              <p role="status">
                {t(
                  "Model selection is unavailable until the current conversation and execution state are observed.",
                )}
              </p>
            )}
            {locked && (
              <p>{t("Switch models after the current reply finishes.")}</p>
            )}
            {catalog?.status === "capacity" && (
              <p role="alert">
                {t(
                  "Catalog capacity exceeded; no partial model list is selectable.",
                )}
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
                {t("The model list could not be read ({code}).", {
                  code: catalogError,
                })}{" "}
                <button type="button" className="link" onClick={reread}>
                  {t("Read again")}
                </button>
              </p>
            )}
            {error && (
              <p role="alert">
                {MODEL_ERRORS[error]
                  ? t(MODEL_ERRORS[error])
                  : t("The model was not changed ({code}).", {
                      code: error,
                    })}
              </p>
            )}
            {!unavailable && (
              <p className="model-popover-scope">
                {pending
                  ? t("Switching model…")
                  : t(
                      "This model is used for future messages in this conversation. Work already started keeps its original model.",
                    )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
