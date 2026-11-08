import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelCatalog, ServiceClient } from "../types";

/** Observed execution facts, not startup authority or a model selection. */
export type ModelAvailability =
  | { status: "ready"; epoch: string; attachmentVersion: number }
  | {
      status:
        | "stopped"
        | "not-started"
        | "preparing"
        | "connecting"
        | "unavailable"
        | "incompatible";
    };

export interface ModelCatalogRead {
  catalog?: ModelCatalog;
  error?: string;
  loading: boolean;
  /** A captured read/choice may only report back into this same lifetime. */
  isCurrent(): boolean;
  reread(): void;
  /** Install only a confirmed choice in the still-current catalog lifetime. */
  accept(catalog: ModelCatalog): boolean;
}

/** One scoped readonly catalog. No owner preparation, preference restoration,
 * model choice, polling or Send. Inactive states never call the client. */
export function useModelCatalog(
  client: Pick<ServiceClient, "models">,
  availability: ModelAvailability,
  refresh: string,
): ModelCatalogRead {
  const epoch = availability.status === "ready" ? availability.epoch : null;
  const attachment =
    availability.status === "ready" ? availability.attachmentVersion : null;
  const [revision, setRevision] = useState(0);
  const nextRevision = useRef(0);
  const scope = useMemo(
    () => ({ client, epoch, attachment, refresh, revision }),
    [client, epoch, attachment, refresh, revision],
  );
  const latest = useRef(scope);
  latest.current = scope;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () =>
      alive.current &&
      scope.epoch !== null &&
      latest.current === scope &&
      nextRevision.current === scope.revision,
    [scope],
  );
  const [state, setState] = useState<{
    scope: typeof scope;
    catalog?: ModelCatalog;
    error?: string;
  }>();
  useEffect(() => {
    if (scope.epoch === null) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && isCurrent();
    void client
      .models(abort.signal)
      .then((reply) => {
        if (!current()) return;
        if (reply.kind === "error")
          setState({ scope, error: reply.error.code });
        else if (reply.value.version.epoch !== scope.epoch)
          setState({ scope, error: "stale" });
        else setState({ scope, catalog: reply.value });
      })
      .catch(() => {
        if (current()) setState({ scope, error: "unavailable" });
      });
    return () => abort.abort();
  }, [client, scope, isCurrent]);
  const value = state?.scope === scope && isCurrent() ? state : undefined;
  return {
    catalog: value?.catalog,
    error: value?.error,
    loading: epoch !== null && !value,
    isCurrent,
    reread() {
      if (!isCurrent()) return;
      // Invalidate synchronously, even before React renders the refresh.
      setRevision(++nextRevision.current);
    },
    accept(catalog) {
      if (!isCurrent() || catalog.version.epoch !== scope.epoch) return false;
      setState({ scope, catalog });
      return true;
    },
  };
}
