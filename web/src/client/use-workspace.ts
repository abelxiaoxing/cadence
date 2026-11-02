/* Adapted use-chat revision/resync family; MIT (c) 2026 xing-shuyin.
 * A single observation lifecycle, shared projection reducer, no command replay. */
import { useEffect, useMemo, useState } from "react";
import type { Scope } from "../types";
import type { BrowserClient } from "./browser";
import { type ViewerState, WorkspaceObserver } from "./observer";
export function useWorkspace(
  api: BrowserClient,
  scope: Scope | null,
  enabled: boolean,
  epoch?: string | null,
) {
  const observer = useMemo(() => new WorkspaceObserver(api), [api]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ViewerState>({
    actions: false,
    transportStatus: "closed",
    attachmentVersion: 0,
  });
  const kind = scope?.kind,
    id = scope?.id;
  useEffect(() => {
    // A positively observed replacement owner gets a fresh attachment, not a
    // replay. Keep the observer's serialized detach/acquire lifetime intact.
    void epoch;
    void revision;
    setState({
      actions: false,
      transportStatus: "closed",
      attachmentVersion: 0,
    });
    if (!enabled) return;
    return observer.observe(kind && id ? { kind, id } : null, setState);
  }, [observer, kind, id, enabled, epoch, revision]);
  return {
    ...state,
    refresh: (capabilities = false) => observer.refresh(capabilities),
    whenReady: (epoch: string, signal: AbortSignal, minimumVersion?: number) =>
      observer.whenReady(epoch, signal, minimumVersion),
    reconnect: () => {
      const version = observer.nextObservation();
      setRevision((v) => v + 1);
      return version;
    },
  };
}
