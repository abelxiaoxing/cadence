import { useT } from "../../i18n/locale";
import type { CaptureCoverage } from "../../types";
export function Coverage({ value }: { value: CaptureCoverage }) {
  const { t, tx } = useT();
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
