/* Adapted from pi-web-ui web/src/components/BarItem.tsx (`host:ctx`: the ring
 * and the used / window figures) @ 29bd28df and ContextUsage.tsx @ b627452c.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: one observation the open conversation already holds. No floating
 * panel, per-category breakdown, soft cap, estimate or polling of its own. */
import {
  type ContextUsage,
  contextPercent,
  formatTokens,
} from "../client/context-usage";
import { useT } from "../i18n/locale";

/** The ring's circumference at radius 5. */
const RING = 31.42;

/** The open conversation's context size: tokens used, and the window and a
 * ring filled to the share in use when the model's catalog entry states a
 * window. A dash while the head read states no size or a compaction left it
 * unknown. */
export function ContextStatus({ usage }: { usage?: ContextUsage }) {
  const { t } = useT();
  const tokens = usage?.tokens ?? null,
    window = usage?.window ?? null;
  const percent =
    tokens !== null && window ? contextPercent(tokens, window) : null;
  const text = !usage
    ? t("Context size not observed yet")
    : tokens === null
      ? t("Context unknown after compaction")
      : window && percent !== null
        ? t("Context {used} / {window} · {percent}%", {
            used: formatTokens(tokens),
            window: formatTokens(window),
            percent,
          })
        : t("Context {used} tokens", { used: formatTokens(tokens) });
  const tip = !usage
    ? t(
        "No completed model response is within reach of this branch's end, so no context size is stated.",
      )
    : [
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
  const tone =
    percent === null
      ? ""
      : percent >= 80
        ? " warn"
        : percent >= 50
          ? " mid"
          : " ok";
  const ring = (
    <svg
      className={`ctx-ring${tone}`}
      viewBox="0 0 14 14"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <circle className="ctx-ring-bg" cx="7" cy="7" r="5" />
      {percent !== null && percent > 0 && (
        <circle
          className="ctx-ring-fill"
          cx="7"
          cy="7"
          r="5"
          strokeDasharray={RING}
          strokeDashoffset={
            +(RING * (1 - Math.min(percent, 100) / 100)).toFixed(2)
          }
        />
      )}
    </svg>
  );
  return (
    <span
      className={`status-item status-ctx${tokens === null ? " is-zero" : ""}`}
      title={`${text}. ${tip}`}
    >
      {tokens !== null && window ? (
        // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as the theme's ring
        <span
          className="ctx-meter"
          role="meter"
          aria-label={t("Context window in use")}
          aria-valuemin={0}
          aria-valuemax={window}
          aria-valuenow={Math.min(tokens, window)}
          aria-valuetext={text}
        >
          {ring}
        </span>
      ) : (
        ring
      )}
      <span className="bar-item-text">
        {tokens === null ? (
          <>
            <span className="visually-hidden">{text} </span>
            <span aria-hidden="true">—</span>
          </>
        ) : (
          <>
            <span className="ctx-val">{formatTokens(tokens)}</span>
            {window && (
              <>
                <span className="status-sep">/</span>
                <span className="ctx-max">{formatTokens(window)}</span>
              </>
            )}
          </>
        )}
      </span>
    </span>
  );
}
