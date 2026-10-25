import { useState } from "react";
import { usePage } from "../../history/use-page";
import { useT } from "../../i18n/locale";
import type {
  GraphReadRequest,
  ListRequest,
  Scope,
  ServiceClient,
} from "../../types";
import { RunSummary } from "../workspace/RunSummary";
import { GraphPane } from "./GraphPane";
import { PageControls } from "./PageControls";
export function RunBrowser({
  client,
  seed,
  onScope,
}: {
  client: ServiceClient;
  seed: ListRequest;
  onScope: (s: Scope) => void;
}) {
  const { t } = useT();
  const pager = usePage(client, { ...seed, reader: "runs" }),
    page = pager.page;
  const [graph, setGraph] = useState<GraphReadRequest>();
  return (
    <section>
      <PageControls pager={pager} />
      {page &&
        !("kind" in page) &&
        page.records.map((r) =>
          r.kind === "run" ? (
            <article key={r.projection.childRunId ?? r.projection.runId}>
              <RunSummary run={r.projection} historical />
              <button
                type="button"
                onClick={() =>
                  onScope({
                    kind: r.projection.childRunId ? "child" : "run",
                    id: r.projection.childRunId ?? r.projection.runId,
                  })
                }
              >
                {t("Open retained episode/child details")}
              </button>
              {r.projection.admission.graph && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      page.request.scope.kind !== "workspace" &&
                      page.request.snapshotSeq !== null &&
                      r.projection.admission.graph
                    )
                      setGraph({
                        storeId: page.request.storeId,
                        scope: page.request.scope,
                        snapshotSeq: page.request.snapshotSeq,
                        graph: r.projection.admission.graph,
                      });
                  }}
                >
                  {t("Inspect admitted graph and plan")}
                </button>
              )}
            </article>
          ) : null,
        )}
      {graph && (
        <GraphPane key={graph.graph.recordId} client={client} seed={graph} />
      )}
    </section>
  );
}
