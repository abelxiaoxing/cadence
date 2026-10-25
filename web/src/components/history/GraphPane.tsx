import { useEffect, useState } from "react";
import { canonicalJson } from "../../../../src/service-contract.ts";
import { contentCursor } from "../../history/readers";
import { useT } from "../../i18n/locale";
import type {
  GraphReadRequest,
  GraphReadResult,
  ServiceClient,
} from "../../types";
import { Markdown } from "../rich/Markdown";
import { Coverage } from "./Coverage";
import { DetailPane } from "./DetailPane";
export function GraphPane({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: GraphReadRequest;
}) {
  return (
    <SelectedGraph key={canonicalJson(seed)} client={client} seed={seed} />
  );
}
function SelectedGraph({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: GraphReadRequest;
}) {
  const { t, tx } = useT();
  const [request, setRequest] = useState(seed),
    [page, setPage] = useState<GraphReadResult>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setBusy(true);
    void client
      .graph(request, controller.signal)
      .then((reply) => {
        if (!current) return;
        setBusy(false);
        if (reply.kind === "error") setError(reply.error.code);
        else {
          setPage(reply.value);
          setError(undefined);
        }
      })
      .catch(() => {
        if (current) {
          setError("Read unavailable.");
          setBusy(false);
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, request]);
  return (
    <section>
      <h3>{t("Immutable admitted graph")}</h3>
      {error && (
        <p role="alert">{t("Graph refused: {error}", { error: tx(error) })}</p>
      )}
      {busy && <p>{t("Reading graph…")}</p>}
      {page && "kind" in page && <Coverage value={page.coverage} />}
      {page &&
        ("kind" in page ? (
          <>
            <p>{t("Graph validation in progress; not an empty graph.")}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRequest(page.next)}
            >
              {t("Continue graph validation")}
            </button>
          </>
        ) : (
          <>
            <DetailPane
              client={client}
              cursor={contentCursor(
                page.request.storeId,
                page.request.scope,
                page.request.snapshotSeq,
                page.graph.plan,
              )}
            />
            {page.graph.assignments.map((a) => (
              <article key={a.id}>
                <h4>
                  {a.id} / {a.purpose}
                </h4>
                <Markdown text={a.instructions} />
                <p>{t("Expected: {output}", { output: a.expectedOutput })}</p>
                <pre>
                  {JSON.stringify(
                    {
                      model: a.model,
                      role: a.role,
                      dependencies: a.dependencies,
                    },
                    null,
                    2,
                  )}
                </pre>
              </article>
            ))}
          </>
        ))}
    </section>
  );
}
