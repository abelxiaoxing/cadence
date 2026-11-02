/** Readiness is separate from conversation/history identity. This observation
 * never opens a folder, allocates an owner attachment or sends a message. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeProjectObservation,
  type ProjectObservation,
} from "../../../src/service/contracts/gateway.ts";
import { errorCode, readJson } from "./service";
export function useProjectObservation(
  id?: string,
  selectedEpoch?: string | null,
) {
  const [revision, setRevision] = useState(0);
  const serial = useRef(0);
  const [state, setState] = useState<{
    id?: string;
    value?: ProjectObservation;
    error?: string;
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
        if (current()) setState({ id, value: decodeProjectObservation(value) });
      } catch (error) {
        if (current())
          setState((previous) => ({
            id,
            value: previous.id === id ? previous.value : undefined,
            error: error instanceof Error ? error.message : "unavailable",
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
    setRevision((v) => v + 1);
  }, []);
  // Only an authenticated explicit Send preparation supplies this readiness.
  // Retire older reads synchronously so none can overwrite its new epoch.
  const prepared = (epoch: string) => {
    refresh();
    setState((previous) => ({
      id,
      value: {
        kind: "project-observation",
        status: "running",
        epoch,
        workspaceId:
          previous.id === id ? (previous.value?.workspaceId ?? null) : null,
      },
    }));
  };
  return { ...(state.id === id ? state : {}), refresh, prepared };
}
