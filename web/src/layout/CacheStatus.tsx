/* Adapted from pi-web-ui web/src/components/BarItem.tsx @ 29bd28df: the
 * statusbar's cache-hit item. MIT (c) 2026 xing-shuyin.
 * Cadence: one observation the open conversation already holds; no layout
 * editing, context menu or custom label. */
import { FiDatabase } from "react-icons/fi";
import type { ChatCache } from "../../../src/service/contracts/workbench.ts";
import { cacheMetrics } from "../client/cache-usage";
import { formatTokens } from "../client/context-usage";
import { useT } from "../i18n/locale";

/** The share of the open session's input tokens read from the provider's
 * prompt cache; a dash while its usage records state none. */
export function CacheStatus({ cache }: { cache?: ChatCache }) {
  const { t } = useT();
  const metrics = cache ? cacheMetrics(cache) : undefined;
  const known = metrics && metrics.totalInput > 0 ? metrics : undefined;
  const rate = known ? `${(known.hitRate * 100).toFixed(1)}%` : "—";
  const tone = !known
    ? ""
    : known.hitRate >= 0.7
      ? " ok"
      : known.hitRate >= 0.4
        ? " mid"
        : " warn";
  const tip = known
    ? `${t(
        "Cache hit: {rate} · read {read} · write {write} · miss {miss} (of {input} input tokens)",
        {
          rate,
          read: formatTokens(known.read),
          write: formatTokens(known.write),
          miss: formatTokens(known.miss),
          input: formatTokens(known.totalInput),
        },
      )} ${t("Summed over every usage record of this session, on every branch.")}`
    : t("Cache hit: this session's usage records state no input tokens yet.");
  return (
    <span
      className={`status-item status-cache${known ? "" : " is-zero"}`}
      title={tip}
    >
      <span className="bar-item-icon" aria-hidden="true">
        <FiDatabase />
      </span>
      <span className="bar-item-text">
        <span className="visually-hidden">{t("Cache hit")} </span>
        <b className={`cache-pct${tone}`}>{rate}</b>
      </span>
    </span>
  );
}
