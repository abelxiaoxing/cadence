/** Composer model control: the current owner model on the button, a provider-
 * grouped list with inline expandable thinking levels in an anchored panel.
 * One click on a model without extra thinking levels or on a thinking chip is
 * one explicit choice; a saved preference is only displayed here, and Send
 * alone installs it. Nothing here probes a provider or starts work. */
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiCheck, FiChevronDown, FiCpu } from "react-icons/fi";
import {
  decodeModelSelector,
  thinkingLevels,
} from "../../../../src/service-contract.ts";
import type {
  ModelAvailability,
  ModelCatalogRead,
} from "../../client/use-model-catalog";
import { type MessageKey, useT } from "../../i18n/locale";
import type { ModelCandidate, ModelSelector, ServiceClient } from "../../types";

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
  stale: "The model list changed. Read the current list before choosing again.",
  "auth-unavailable":
    "This model's credentials are unavailable. Check auth.json or the provider's API key.",
  "unsupported-context": "This model or thinking level is not supported.",
  uncertain:
    "The choice was not confirmed. Read the current model before choosing again.",
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
const entryKey = (entry: ModelCandidate) =>
  `${entry.provider}/${entry.model}/${entry.api ?? ""}`;
const hasThinkingChoices = (entry: ModelCandidate) => entry.thinking.length > 1;

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
  availability,
  read,
  lastModel,
  draftModel,
  pendingModel,
  onPreviewChoice,
  locked,
  lockReason,
  open,
  onOpenChange,
  onChanged,
  onChosen,
  awaitingSend = false,
}: {
  client?: Pick<ServiceClient, "chooseModel">;
  availability: ModelAvailability;
  read: ModelCatalogRead;
  /** Retained conversation preference only; never a verified/installed choice. */
  lastModel?: ModelSelector | null;
  /** Local intent, not an installed owner selection. */
  draftModel?: ModelSelector | null;
  /** Purely visual placeholder from the same owner during a brief initial switch; never selectable or authoritative. */
  pendingModel?: ModelSelector | null;
  onPreviewChoice?(choice: ModelSelector): void;
  /** This conversation's reply is live; the owner refuses a change now. */
  locked: boolean;
  lockReason?: string;
  open: boolean;
  onOpenChange(open: boolean, reason?: "chosen"): void;
  /** An installed choice changed the owner configuration. */
  onChanged(): void;
  /** The panel closed on an installed choice. */
  onChosen?(choice: ModelSelector): void;
  /** A Send is waiting for this choice and continues after it. */
  awaitingSend?: boolean;
}) {
  const { t } = useT();
  const label = useModelLabel();
  const ready = availability.status === "ready";
  const preview = read.preview;
  const browsable =
    ready || !!preview || (read.loading && availability.status !== "preparing");
  const epoch = ready ? availability.epoch : null;
  const attachment = ready ? availability.attachmentVersion : null;
  const { error: catalogError, loading, reread } = read;
  const liveCatalog = ready ? read.catalog : undefined;
  const catalog = liveCatalog ?? preview;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const changeOpen = useRef(onOpenChange);
  changeOpen.current = onOpenChange;
  // A refusal from an earlier owner/context is not a failure of this one.
  useEffect(() => {
    void client;
    void epoch;
    void attachment;
    setError("");
    setExpandedKey(null);
  }, [client, epoch, attachment]);
  const close = useCallback((focus = true, reason?: "chosen") => {
    if (reason) changeOpen.current(false, reason);
    else changeOpen.current(false);
    setExpandedKey(null);
    setError("");
    if (focus) trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) {
      setExpandedKey(null);
      return;
    }
    const mobileSheet =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(
        "(max-width: 900px), ((pointer: coarse) and (hover: none))",
      ).matches;
    if (!mobileSheet) popover.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close]);
  const selected = liveCatalog?.selected ?? null;
  const current: ModelSelector | null =
    draftModel ??
    selected ??
    (preview ? lastModel : null) ??
    catalog?.remembered ??
    null;
  const groups = useMemo(() => {
    const map = new Map<string, ModelCandidate[]>();
    for (const entry of catalog?.entries ?? []) {
      map.set(entry.provider, [...(map.get(entry.provider) ?? []), entry]);
    }
    return [...map];
  }, [catalog]);
  const currentEntry = catalog?.entries.find((entry) =>
    sameModel(entry, current),
  );
  const activeExpandedKey =
    expandedKey &&
    catalog?.entries.some(
      (entry) => entryKey(entry) === expandedKey && hasThinkingChoices(entry),
    )
      ? expandedKey
      : currentEntry && hasThinkingChoices(currentEntry)
        ? entryKey(currentEntry)
        : null;
  const selectionEnabled =
    (ready || !!preview) &&
    !!catalog &&
    !loading &&
    !catalogError &&
    read.isCurrent();
  const choose = async (entry: ModelCandidate, level: Level) => {
    if (
      !selectionEnabled ||
      !read.isCurrent() ||
      !catalog ||
      !entry.api ||
      pending ||
      locked
    )
      return;
    const choice = decodeModelSelector({
      provider: entry.provider,
      model: entry.model,
      api: entry.api,
      thinking: level,
    });
    if (preview && onPreviewChoice) {
      onPreviewChoice(choice);
      close(true, "chosen");
      return;
    }
    if (!liveCatalog || !client) return;
    if (selected && same(selected, choice)) {
      close(true, "chosen");
      onChosen?.(choice);
      return;
    }
    setPending(true);
    setError("");
    try {
      const reply = await client.chooseModel({
        expected: liveCatalog.version,
        choice,
      });
      if (!read.isCurrent()) return;
      if (reply.kind === "error") {
        setError(reply.error.code);
        reread();
        return;
      }
      const next = {
        ...liveCatalog,
        version: reply.value.version,
        selected: reply.value.selected,
      };
      if (!read.accept(next)) return;
      onChanged();
      close(true, "chosen");
      onChosen?.(choice);
    } catch {
      if (read.isCurrent()) {
        setError("uncertain");
        reread();
      }
    } finally {
      setPending(false);
    }
  };
  const onOptionClick = (entry: ModelCandidate, isExpanded: boolean) => {
    const key = entryKey(entry);
    if (hasThinkingChoices(entry) && !isExpanded) {
      if (
        !selectionEnabled ||
        entry.eligibility !== "candidate" ||
        pending ||
        locked
      )
        return;
      setExpandedKey(key);
      return;
    }
    void choose(entry, nearestLevel(entry, current?.thinking ?? "medium"));
  };
  const options = () =>
    [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        "button[role=option]:not(:disabled)",
      ) ?? []),
    ] as HTMLButtonElement[];
  const onPopoverKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (!browsable) return;
    const active = document.activeElement as HTMLElement | null;
    const thinkingRow = active?.closest(".model-thinking");
    if (
      thinkingRow &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const pills = [
        ...thinkingRow.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ];
      const at = pills.indexOf(active as HTMLButtonElement);
      if (at < 0) return;
      const next = at + (event.key === "ArrowRight" ? 1 : -1);
      pills[Math.max(0, Math.min(next, pills.length - 1))]?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const all = options();
    if (!all.length) return;
    event.preventDefault();
    const anchor = thinkingRow
      ? (active
          ?.closest(".model-item")
          ?.querySelector<HTMLButtonElement>("button[role=option]") ?? null)
      : (active as HTMLButtonElement | null);
    const at = anchor ? all.indexOf(anchor) : -1;
    if (at < 0) {
      (event.key === "ArrowDown" ? all[0] : all[all.length - 1])?.focus();
      return;
    }
    const next = at + (event.key === "ArrowDown" ? 1 : -1);
    all[Math.max(0, Math.min(next, all.length - 1))]?.focus();
  };
  const deferred =
    availability.status === "stopped" || availability.status === "not-started";
  const history = !catalog ? lastModel : null;
  const statusText =
    read.preview ||
    (read.loading && onPreviewChoice) ||
    (catalogError && onPreviewChoice)
      ? loading
        ? t("Reading models…")
        : catalogError
          ? t("Model list unavailable")
          : t("Choose a model")
      : deferred
        ? t("Choose a model")
        : availability.status === "preparing"
          ? t("Preparing execution…")
          : availability.status === "connecting"
            ? t("Checking execution state…")
            : availability.status === "unavailable"
              ? t("Execution state unavailable")
              : loading
                ? t("Reading models…")
                : catalogError
                  ? t("Model list unavailable")
                  : t("Choose a model");
  const visualPlaceholder =
    !current &&
    !history &&
    !catalog &&
    !catalogError &&
    pendingModel &&
    (loading || availability.status === "connecting")
      ? pendingModel
      : null;
  const shown = current ?? history ?? visualPlaceholder;
  const buttonText = current
    ? label(current)
    : history
      ? t("Last used: {model}", { model: label(history) })
      : visualPlaceholder
        ? label(visualPlaceholder)
        : statusText;
  const hasReadError = (ready || !!onPreviewChoice) && !!catalogError;
  const hasNotes =
    locked ||
    catalog?.status === "capacity" ||
    !!catalog?.withheld ||
    hasReadError ||
    !!error ||
    pending;
  return (
    <div className="model-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`model-trigger${(current && !selected) || history || visualPlaceholder ? " remembered" : ""}${catalog && !current ? " empty" : ""}`}
        aria-label={t("Model: {model}", { model: buttonText })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          locked
            ? (lockReason ??
              t("Switch models after the current reply finishes."))
            : draftModel
              ? t("Choose now; the model is verified when you send.")
              : history
                ? t("Last used model; availability is checked when you send.")
                : current && !selected
                  ? t("Last used model; it is used again when you send.")
                  : current
                    ? `${current.provider}/${current.model} · ${current.api}`
                    : statusText
        }
        onClick={() => {
          if (open) close();
          else {
            setError("");
            onOpenChange(true);
          }
        }}
      >
        <FiCpu aria-hidden="true" />
        <span className="model-trigger-text">
          {current?.model ??
            (history
              ? t("Last used: {model}", { model: history.model })
              : (visualPlaceholder?.model ?? statusText))}
        </span>
        <span className="model-trigger-level" title={t("Thinking")}>
          {t("Thinking")} · {shown ? t(LEVEL_LABELS[shown.thinking]) : "—"}
        </span>
        <FiChevronDown aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("Close")}
            className="model-popover-backdrop"
            onClick={() => close(false)}
          />
          <div
            ref={popover}
            tabIndex={-1}
            className="model-popover"
            role="dialog"
            aria-label={t("Choose a model")}
            onKeyDown={onPopoverKey}
          >
            {awaitingSend && (
              <p className="model-popover-lead accent">
                {t("Choose a model; your message is sent right after.")}
              </p>
            )}
            {!browsable && !catalogError && (
              <p className="model-popover-lead" role="status">
                {availability.status === "preparing"
                  ? t(
                      "Execution is being prepared for your Send. Models will load when it is ready.",
                    )
                  : t(
                      "Model selection is unavailable until the current conversation and execution state are observed.",
                    )}
              </p>
            )}
            {history && (
              <p className="model-popover-lead">
                {t("Last used: {model}", { model: label(history) })}
                <br />
                {t("Last used model; availability is checked when you send.")}
              </p>
            )}
            {browsable && (
              <div
                className="model-list"
                role="listbox"
                aria-label={t("Models")}
                ref={list}
              >
                {loading && (
                  <p className="model-empty" role="status">
                    {t("Reading models…")}
                  </p>
                )}
                {groups.map(([provider, entries]) => (
                  <fieldset key={provider} className="model-group">
                    <legend className="model-group-label">{provider}</legend>
                    {entries.map((entry) => {
                      const key = entryKey(entry);
                      const usable = entry.eligibility === "candidate";
                      const isCurrent = sameModel(entry, current);
                      const canThink = hasThinkingChoices(entry);
                      const isExpanded = canThink && activeExpandedKey === key;
                      return (
                        <div
                          key={key}
                          className={`model-item${isCurrent ? " current" : ""}${isExpanded ? " expanded" : ""}`}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={isCurrent}
                            className="model-option"
                            disabled={
                              !selectionEnabled || !usable || pending || locked
                            }
                            title={`${entry.provider}/${entry.model}${entry.api ? ` · ${entry.api}` : ""}`}
                            onClick={() => onOptionClick(entry, isExpanded)}
                          >
                            <span className="model-option-name">
                              {entry.model}
                            </span>
                            {!usable && (
                              <span className="model-option-note">
                                {entry.eligibility === "auth-unavailable"
                                  ? t("Credentials unavailable")
                                  : t("Not supported")}
                              </span>
                            )}
                            {isCurrent ? (
                              <FiCheck
                                className="model-option-check"
                                aria-hidden="true"
                              />
                            ) : (
                              usable &&
                              canThink && (
                                <FiChevronDown
                                  className={`model-option-chevron${isExpanded ? " open" : ""}`}
                                  aria-hidden="true"
                                />
                              )
                            )}
                          </button>
                          {isExpanded && (
                            <fieldset
                              className="model-thinking"
                              aria-label={t("Thinking")}
                            >
                              <span
                                className="model-thinking-label"
                                aria-hidden="true"
                              >
                                {t("Thinking")}
                              </span>
                              {entry.thinking.map((level) => (
                                <button
                                  key={level.level}
                                  type="button"
                                  aria-label={t("Thinking level: {level}", {
                                    level: t(LEVEL_LABELS[level.level]),
                                  })}
                                  aria-pressed={
                                    isCurrent &&
                                    current?.thinking === level.level
                                  }
                                  disabled={
                                    !selectionEnabled ||
                                    !usable ||
                                    !level.selectable ||
                                    pending ||
                                    locked
                                  }
                                  onClick={() =>
                                    void choose(entry, level.level)
                                  }
                                >
                                  {t(LEVEL_LABELS[level.level])}
                                </button>
                              ))}
                            </fieldset>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                ))}
                {catalog?.status === "complete" && groups.length === 0 && (
                  <p className="model-empty">
                    {t(
                      "No models are configured. Add a provider to Pi's models.json or auth.json, then reopen the model picker.",
                    )}
                  </p>
                )}
              </div>
            )}
            {hasNotes && (
              <div className="model-popover-notes">
                {locked && (
                  <p>
                    {lockReason ??
                      t("Switch models after the current reply finishes.")}
                  </p>
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
                        ? "{count} model withheld: its provider or model ID contains a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; reopen the picker after editing models.json."
                        : "{count} models withheld: their provider or model IDs contain a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; reopen the picker after editing models.json.",
                      { count: catalog.withheld },
                    )}
                  </p>
                )}
                {hasReadError && (
                  <p role="alert">
                    {t("The model list could not be read ({code}).", {
                      code: catalogError,
                    })}{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => reread(true)}
                    >
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
                {pending && <p role="status">{t("Switching model…")}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
