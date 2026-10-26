import { useT } from "../../i18n/locale";
import type { CaptureCoverage } from "../../types";
export function Coverage({
  value,
  compact = false,
}: {
  value: CaptureCoverage;
  compact?: boolean;
}) {
  const { t, tx } = useT();
  if (
    compact &&
    value.observed === "complete" &&
    value.source === "complete" &&
    !value.redacted &&
    value.omissions.length === 0
  )
    return (
      <details className="coverage-details">
        <summary>{t("Recording details")}</summary>
        <Coverage value={value} />
      </details>
    );
  return (
    <p
      className={`coverage${
        value.observed === "complete" &&
        value.source === "complete" &&
        !value.redacted &&
        value.omissions.length === 0
          ? ""
          : " partial"
      }`}
    >
      {t("Recording: {observed}; source: {source};", {
        observed: tx(value.observed),
        source: tx(value.source),
      })}{" "}
      {value.redacted ? t("redacted") : t("no reported redaction")}
      {value.omissions.length > 0 &&
        t("; omitted: {omissions}", {
          omissions: value.omissions.map(tx).join(", "),
        })}
      {t(
        ". Not a guarantee of complete original source or universal secret detection.",
      )}
    </p>
  );
}
