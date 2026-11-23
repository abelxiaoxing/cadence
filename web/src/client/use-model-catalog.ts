import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelPreview } from "../../../src/service/contracts/models.ts";
import type { ModelCatalog, ServiceClient } from "../types";
import type { PreviewModels } from "./model-preview";

/** Observed execution facts, not startup authority or a model selection. */
export type ModelAvailability =
  | { status: "ready"; epoch: string; attachmentVersion: number }
  | {
      status:
        | "stopped"
        | "not-started"
        | "preparing"
        | "connecting"
        | "unavailable";
    };

export interface CatalogClient {
  models(
    signal: AbortSignal,
    reload: boolean,
  ): ReturnType<ServiceClient["models"]>;
}

export interface ModelCatalogRead {
  catalog?: ModelCatalog;
  preview?: ModelPreview;
  error?: string;
  loading: boolean;
  /** A captured read/choice may only report back into this same lifetime. */
  isCurrent(): boolean;
  reread(reload?: boolean, options?: { background?: boolean }): void;
  /** Install only a confirmed choice in the still-current catalog lifetime. */
  accept(catalog: ModelCatalog): boolean;
}

/** One scoped readonly catalog. No owner preparation, preference restoration,
 * model choice, polling or Send. Without execution, an optional independent
 * preview reader supplies only descriptors, never a synthetic owner version. */
export function useModelCatalog(
  client: CatalogClient | null,
  availability: ModelAvailability,
  refresh: string,
  previewModels?: PreviewModels,
): ModelCatalogRead {
  const epoch = availability.status === "ready" ? availability.epoch : null;
  const attachment =
    availability.status === "ready" ? availability.attachmentVersion : null;
  const preview =
    epoch === null &&
    availability.status !== "preparing" &&
    availability.status !== "connecting"
      ? previewModels
      : undefined;
  const [revision, setRevision] = useState(0);
  const nextRevision = useRef(0);
  const lifetime = useMemo(
    () => ({ client, epoch, attachment, refresh, preview }),
    [client, epoch, attachment, refresh, preview],
  );
  const reloadFor = useRef<typeof lifetime | null>(null);
  const scope = useMemo(
    () => ({ ...lifetime, revision, reload: reloadFor.current === lifetime }),
    [lifetime, revision],
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
      (scope.epoch !== null || !!scope.preview) &&
      latest.current === scope &&
      nextRevision.current === scope.revision,
    [scope],
  );
  const [state, setState] = useState<{
    scope: typeof scope;
    catalog?: ModelCatalog;
    preview?: ModelPreview;
    serialized?: string;
    error?: string;
  }>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const bgAbort = useRef<AbortController | null>(null);
  const acceptGeneration = useRef(0);
  useEffect(() => {
    bgAbort.current?.abort();
    bgAbort.current = null;
    if (scope.epoch === null && !scope.preview) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && isCurrent();
    if (scope.preview) {
      void scope
        .preview(abort.signal)
        .then((preview) => {
          if (current())
            setState({ scope, preview, serialized: JSON.stringify(preview) });
        })
        .catch((error: unknown) => {
          if (current())
            setState({
              scope,
              error: error instanceof Error ? error.message : "unavailable",
            });
        });
      return () => {
        abort.abort();
        bgAbort.current?.abort();
        bgAbort.current = null;
      };
    }
    if (!client) return () => abort.abort();
    void client
      .models(abort.signal, scope.reload)
      .then((reply) => {
        if (!current()) return;
        if (reply.kind === "error")
          setState({ scope, error: reply.error.code });
        else if (reply.value.version.epoch !== scope.epoch)
          setState({ scope, error: "stale" });
        else
          setState({
            scope,
            catalog: reply.value,
            serialized: JSON.stringify(reply.value),
          });
      })
      .catch(() => {
        if (current()) setState({ scope, error: "unavailable" });
      });
    return () => {
      abort.abort();
      bgAbort.current?.abort();
      bgAbort.current = null;
    };
  }, [client, scope, isCurrent]);
  const value = state?.scope === scope && isCurrent() ? state : undefined;
  return {
    catalog: value?.catalog,
    preview: value?.preview,
    error: value?.error,
    loading: (epoch !== null || !!preview) && !value,
    isCurrent,
    reread(reload = false, options?: { background?: boolean }) {
      if (!isCurrent()) return;
      const confirmed =
        stateRef.current?.scope === scope &&
        !stateRef.current.error &&
        (!!stateRef.current.catalog || !!stateRef.current.preview);
      if (options?.background && confirmed) {
        // Stale-while-revalidate inside the same confirmed lifetime: keep the
        // rendered list interactive without blanking or layout collapse, and
        // update seamlessly only if the catalog changed or failed.
        bgAbort.current?.abort();
        const abort = new AbortController();
        bgAbort.current = abort;
        const capturedScope = scope;
        const token = acceptGeneration.current;
        const stillValid = () =>
          !abort.signal.aborted &&
          alive.current &&
          latest.current === capturedScope &&
          nextRevision.current === capturedScope.revision &&
          acceptGeneration.current === token;
        const finish = () => {
          if (bgAbort.current === abort) bgAbort.current = null;
        };
        if (capturedScope.preview) {
          void capturedScope
            .preview(abort.signal)
            .then((nextPreview) => {
              finish();
              if (!stillValid()) return;
              const serialized = JSON.stringify(nextPreview);
              if (stateRef.current?.serialized === serialized) return;
              setState({
                scope: capturedScope,
                preview: nextPreview,
                serialized,
              });
            })
            .catch((error: unknown) => {
              finish();
              if (!stillValid()) return;
              setState({
                scope: capturedScope,
                error: error instanceof Error ? error.message : "unavailable",
              });
            });
          return;
        }
        if (!capturedScope.client) return;
        void capturedScope.client
          .models(abort.signal, reload)
          .then((reply) => {
            finish();
            if (!stillValid()) return;
            if (reply.kind === "error")
              setState({ scope: capturedScope, error: reply.error.code });
            else if (reply.value.version.epoch !== capturedScope.epoch)
              setState({ scope: capturedScope, error: "stale" });
            else {
              const serialized = JSON.stringify(reply.value);
              if (stateRef.current?.serialized === serialized) return;
              setState({
                scope: capturedScope,
                catalog: reply.value,
                serialized,
              });
            }
          })
          .catch(() => {
            finish();
            if (stillValid())
              setState({ scope: capturedScope, error: "unavailable" });
          });
        return;
      }
      bgAbort.current?.abort();
      bgAbort.current = null;
      reloadFor.current = reload ? lifetime : null;
      // Invalidate synchronously, even before React renders the refresh.
      setRevision(++nextRevision.current);
    },
    accept(catalog) {
      if (!isCurrent() || catalog.version.epoch !== scope.epoch) return false;
      bgAbort.current?.abort();
      bgAbort.current = null;
      ++acceptGeneration.current;
      setState({ scope, catalog, serialized: JSON.stringify(catalog) });
      return true;
    },
  };
}
