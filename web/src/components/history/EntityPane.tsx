import { useEffect, useState } from "react";
import { canonicalJson } from "../../../../src/service-contract.ts";
import type {
  EntityReadRequest,
  EntityReadResult,
  ServiceClient,
} from "../../types";
import { Coverage } from "./Coverage";
export function EntityPane({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: EntityReadRequest;
}) {
  return (
    <SelectedEntity key={canonicalJson(seed)} client={client} seed={seed} />
  );
}
function SelectedEntity({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: EntityReadRequest;
}) {
  const [request, setRequest] = useState(seed),
    [page, setPage] = useState<EntityReadResult>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setBusy(true);
    const read =
      request.kind === "message"
        ? client.message(request, controller.signal)
        : request.kind === "tool"
          ? client.tool(request, controller.signal)
          : client.task(request, controller.signal);
    void read
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
    <section aria-label="Exact entity metadata">
      {busy && <p>Reading exact entity version…</p>}
      {error && <p role="alert">Entity refused: {error}</p>}
      {page && "kind" in page && <Coverage value={page.coverage} />}
      {page &&
        ("kind" in page ? (
          <>
            <p>Entity validation in progress, not missing.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRequest(page.next)}
            >
              Continue exact entity validation
            </button>
          </>
        ) : (
          <details>
            <summary>Exact stored owner and associations</summary>
            <pre>{JSON.stringify(page.record, null, 2)}</pre>
          </details>
        ))}
    </section>
  );
}
