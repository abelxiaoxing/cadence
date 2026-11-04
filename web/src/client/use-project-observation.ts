/** Readiness is separate from conversation/history identity. This observation
 * never opens a folder, allocates an owner attachment or sends a message. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeProjectObservation,
  type ProjectObservation,
} from "../../../src/service/contracts/gateway.ts";
import { errorCode, readJson } from "./service";

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
  value?: ProjectObservation,
  error?: string,
) {
  if (!value || value.status === "unavailable")
    return { value: previous ?? value, error: error ?? "unavailable" };
  return { value, error: undefined };
}
export function useProjectObservation(
  id?: string,
  selectedEpoch?: string | null,
) {
  const [revision, setRevision] = useState(0);
  const nextRevision = useRef(0);
  const serial = useRef(0);
  const [state, setState] = useState<{
    id?: string;
    value?: ProjectObservation;
    error?: string;
    revision?: number;
    selectedEpoch?: string | null;
  }>({});
  useEffect(() => {
    void revision;
    void selectedEpoch;
    if (!id) return;
    const version = ++serial.current;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && serial.current === version;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!current()) return;
      try {
        const response = await fetch(`/workbench/v1/projects/${id}`, {
          credentials: "same-origin",
          redirect: "error",
          cache: "no-store",
          signal: abort.signal,
        });
        const value = await readJson(response);
        if (!response.ok) throw new Error(errorCode(value));
        const observed = decodeProjectObservation(value);
        if (current())
          setState((previous) => ({
            id,
            revision,
            selectedEpoch,
            ...projectObservationResult(
              previous.id === id ? previous.value : undefined,
              observed,
            ),
          }));
      } catch (error) {
        if (current())
          setState((previous) => ({
            id,
            revision,
            selectedEpoch,
            ...projectObservationResult(
              previous.id === id ? previous.value : undefined,
              undefined,
              error instanceof Error ? error.message : "unavailable",
            ),
          }));
      }
      if (current()) timer = setTimeout(() => void load(), 5000);
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [id, revision, selectedEpoch]);
  const refresh = useCallback(() => {
    ++serial.current;
    const revision = ++nextRevision.current;
    setRevision(revision);
    return revision;
  }, []);
  // Only an authenticated explicit Send preparation supplies this readiness.
  // Retire older reads synchronously so none can overwrite its new epoch.
  // The parent adopts this confirmed epoch, not the callback's old selection.
  const prepared = (epoch: string) => {
    const revision = refresh();
    setState((previous) => ({
      id,
      revision,
      selectedEpoch: epoch,
      value: {
        kind: "project-observation",
        status: "running",
        epoch,
        workspaceId:
          previous.id === id ? (previous.value?.workspaceId ?? null) : null,
      },
    }));
  };
  const selected = state.id === id ? state : {};
  return {
    ...selected,
    readiness: projectReadiness(
      selected.value,
      selected.error,
      selected.revision === revision &&
        selected.selectedEpoch === selectedEpoch,
    ),
    refresh,
    prepared,
  };
}
