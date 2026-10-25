import { useT } from "../../i18n/locale";
import type { RunProjection } from "../../types";
import { Coverage } from "../history/Coverage";
export function RunSummary({
  run,
  historical = false,
}: {
  run: RunProjection;
  historical?: boolean;
}) {
  const { t, tx } = useT();
  return (
    <article className="run-summary">
      <h3>
        {run.assignmentId ?? run.admission.kind} ·{" "}
        {historical ? t("historical projection") : t("owner projection")}
      </h3>
      <p>
        <code>{run.childRunId ?? run.runId}</code>
      </p>
      <dl>
        <dt>{t("Lifecycle")}</dt>
        <dd>{tx(run.lifecycle)}</dd>
        <dt>{t("Execution")}</dt>
        <dd>{run.outcome ? tx(run.outcome) : t("unsettled")}</dd>
        <dt>{t("Wait/block reason")}</dt>
        <dd>{run.reason ? tx(run.reason) : t("none reported")}</dd>
        <dt>{t("Summary publication")}</dt>
        <dd>{tx(run.publication)}</dd>
      </dl>
      <Coverage value={run.coverage} />
      <details>
        <summary>
          {t(
            "Native / recording / parent settlement facts (independent of human review)",
          )}
        </summary>
        <pre>
          {run.settlement
            ? JSON.stringify(run.settlement, null, 2)
            : t("No settlement recorded")}
        </pre>
      </details>
    </article>
  );
}
