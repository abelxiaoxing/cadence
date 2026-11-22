/** Readiness is separate from conversation/history identity. This observation
 * never opens a folder, allocates an owner attachment or sends a message. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeProjectObservation,
  type ProjectObservation,
} from "../../../src/service/contracts/gateway.ts";
import {
  decodeProjectAssociation,
  PROJECT_ASSOCIATION_HEADER,
} from "../../../src/service/contracts/workbench.ts";
import {
  observationRead,
  observationRetryMs,
  refusedAccess,
} from "./observation-read";
import type { ObservationAccess } from "./observer";
import { onPageVisible, pageHidden } from "./visibility";

interface ProjectRead {
  value: ProjectObservation;
  association: ReturnType<typeof decodeProjectAssociation>;
}

export function projectReadiness(
  value?: ProjectObservation,
  error?: string,
  fresh = true,
) {
  if (!value || value.status === "unavailable") return "unknown";
  if (error || !fresh) return "stale";
  return value.status;
}
/** A failed observation keeps history identity, not a claim of live readiness. */
export function projectObservationResult(
  previous: ProjectObservation | undefined,
  read?: ProjectRead,
  error?: string,
) {
  if (!read || read.value.status === "unavailable")
    return {
      value: previous ?? read?.value,
      association: "unknown" as const,
      error: error ?? "unavailable",
    };
  return { ...read, error: undefined };
}
export function useProjectObservation(
  id: string | undefined,
  selectedEpoch: string | null | undefined,
  access: ObservationAccess,
) {
  const [revision, setRevision] = useState(0);
  const nextRevision = useRef(0);
  const serial = useRef(0);
  const [state, setState] = useState<{
    id?: string;
    value?: ProjectObservation;
    serialized?: string;
    association?: ProjectRead["association"];
    error?: string;
    revision?: number;
    selectedEpoch?: string | null;
  }>({});
  useEffect(() => {
    if (!id || access.signal.aborted) return;
    const version = ++serial.current;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && serial.current === version;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    const stop = () => {
      abort.abort();
      paused = false;
      clearTimeout(timer);
    };
    const unsubscribe = access.subscribe(stop);
    const finish = (read?: ProjectRead, error?: string) => {
      if (!current()) return;
      if (error && refusedAccess(error)) {
        access.refuse("project", error);
        return;
      }
      setState((previous) => {
        const result = projectObservationResult(
          previous.id === id ? previous.value : undefined,
          read,
          error,
        );
        const serialized =
          result.value === undefined ? undefined : JSON.stringify(result.value);
        if (
          previous.id === id &&
          previous.revision === revision &&
          previous.selectedEpoch === selectedEpoch &&
          previous.association === result.association &&
          previous.error === result.error &&
          previous.serialized === serialized
        )
          return previous;
        return {
          id,
          revision,
          selectedEpoch,
          serialized,
          ...result,
        };
      });
      if (pageHidden()) paused = true;
      else timer = setTimeout(() => void load(), observationRetryMs);
    };
    const load = async () => {
      if (!current()) return;
      try {
        finish(
          await observationRead(
            `/workbench/v1/projects/${id}`,
            abort.signal,
            (value, response) => ({
              value: decodeProjectObservation(value),
              association: decodeProjectAssociation(
                response.headers.get(PROJECT_ASSOCIATION_HEADER),
              ),
            }),
          ),
        );
      } catch (error) {
        finish(
          undefined,
          error instanceof Error ? error.message : "unavailable",
        );
      }
    };
    const unsubscribeVisible = onPageVisible(() => {
      if (!paused || !current()) return;
      paused = false;
      void load();
    });
    void load();
    return () => {
      unsubscribeVisible();
      unsubscribe();
      stop();
    };
  }, [id, revision, selectedEpoch, access]);
  const refresh = useCallback(() => {
    if (access.signal.aborted) return nextRevision.current;
    ++serial.current;
    const revision = ++nextRevision.current;
    setRevision(revision);
    return revision;
  }, [access]);
  // Only authenticated explicit execution preparation supplies this readiness.
  // Retire older reads synchronously so none can overwrite its new epoch.
  // The parent adopts this confirmed epoch, not the callback's old selection.
  const prepared = (epoch: string) => {
    access.check();
    const revision = refresh();
    setState((previous) => ({
      id,
      revision,
      selectedEpoch: epoch,
      association: "associated",
      value: {
        kind: "project-observation",
        status: "running",
        epoch,
        workspaceId:
          previous.id === id ? (previous.value?.workspaceId ?? null) : null,
      },
    }));
  };
  const selected = access.refusal
    ? {
        error:
          access.refusal.source === "project" ? access.refusal.code : undefined,
      }
    : state.id === id
      ? state
      : {};
  const fresh =
    selected.revision === revision && selected.selectedEpoch === selectedEpoch;
  return {
    ...selected,
    association: fresh ? (selected.association ?? "unknown") : "unknown",
    readiness: projectReadiness(selected.value, selected.error, fresh),
    refresh,
    prepared,
  };
}
