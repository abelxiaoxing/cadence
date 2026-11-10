/* Adapted from pi-web-ui web/src/components/ContextUsage.tsx @ b627452c: the
 * statusbar's context item and its meter with a text alternative.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: one observation the open conversation already holds. No floating
 * panel, per-category breakdown, soft cap, estimate or polling of its own. */
import { FiPieChart } from "react-icons/fi";
import {
  type ContextUsage,
  contextPercent,
  formatTokens,
} from "../client/context-usage";
import { useT } from "../i18n/locale";

/** The open conversation's context size: tokens used, and the window and
 * percentage when the model's catalog entry states a window. */
export function ContextStatus({ usage }: { usage: ContextUsage }) {
  const { t } = useT();
  const { tokens, window } = usage;
  const percent =
    tokens !== null && window ? contextPercent(tokens, window) : null;
  const text =
    tokens === null
      ? t("Context unknown after compaction")
      : window && percent !== null
        ? t("Context {used} / {window} · {percent}%", {
            used: formatTokens(tokens),
            window: formatTokens(window),
            percent,
          })
        : t("Context {used} tokens", { used: formatTokens(tokens) });
  const tip = [
    t(
      "Context size as of the last completed model response ({model}). Messages after that response are not counted.",
      { model: `${usage.provider}/${usage.model}` },
    ),
    tokens === null
      ? t(
          "A compaction followed that response, so the size is unknown until the next one.",
        )
      : !window
        ? t(
            "The model list states no context window for this model, so no percentage is shown.",
          )
        : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={`status-item status-ctx${percent !== null && percent >= 90 ? " warn" : ""}`}
      title={tip}
    >
      <span className="bar-item-icon" aria-hidden="true">
        <FiPieChart />
      </span>
      <span className="bar-item-text">{text}</span>
      {tokens !== null && window && (
        // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn with the theme tokens
        <span
          className="ctx-meter"
          role="meter"
          aria-label={t("Context window in use")}
          aria-valuemin={0}
          aria-valuemax={window}
          aria-valuenow={Math.min(tokens, window)}
          aria-valuetext={text}
        >
          <span style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
        </span>
      )}
    </span>
  );
}
