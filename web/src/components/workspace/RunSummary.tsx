import type { RunProjection } from "../../types";
import { Coverage } from "../history/Coverage";
export function RunSummary({
  run,
  historical = false,
}: {
  run: RunProjection;
  historical?: boolean;
}) {
  return (
    <article className="run-summary">
      <h3>
        {run.assignmentId ?? run.admission.kind} ·{" "}
        {historical ? "historical projection" : "owner projection"}
      </h3>
      <p>
        <code>{run.childRunId ?? run.runId}</code>
      </p>
      <dl>
        <dt>Lifecycle</dt>
        <dd>{run.lifecycle}</dd>
        <dt>Execution</dt>
        <dd>{run.outcome ?? "unsettled"}</dd>
        <dt>Wait/block reason</dt>
        <dd>{run.reason ?? "none reported"}</dd>
        <dt>Summary publication</dt>
        <dd>{run.publication}</dd>
      </dl>
      <Coverage value={run.coverage} />
      <details>
        <summary>
          Native / recording / parent settlement facts (independent of human
          review)
        </summary>
        <pre>
          {run.settlement
            ? JSON.stringify(run.settlement, null, 2)
            : "No settlement recorded"}
        </pre>
      </details>
    </article>
  );
}
