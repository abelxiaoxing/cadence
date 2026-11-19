/* Adapted use-chat revision/resync family; MIT (c) 2026 xing-shuyin.
 * A single observation lifecycle, shared projection reducer, no command replay. */
import { useEffect, useMemo, useState } from "react";
import type { Scope } from "../types";
import type { BrowserClient } from "./browser";
import {
  type ObservationAccess,
  type ViewerState,
  WorkspaceObserver,
} from "./observer";

const closed: ViewerState = {
  actions: false,
  attached: false,
  transportStatus: "closed",
  attachmentVersion: 0,
};
export function useWorkspace(
  api: BrowserClient,
  scope: Scope | null,
  enabled: boolean,
  epoch: string | null,
  access: ObservationAccess,
) {
  const observer = useMemo(
    () => new WorkspaceObserver(api, access),
    [api, access],
  );
  const [revision, setRevision] = useState(0);
  const kind = scope?.kind,
    id = scope?.id;
  const selection = useMemo(
    () => ({ kind, id, enabled, epoch, revision, observer }),
    [kind, id, enabled, epoch, revision, observer],
  );
  const [seen, setSeen] = useState<{
    selection: typeof selection;
    value: ViewerState;
  }>();
  useEffect(() => {
    const { enabled, kind, id, observer } = selection;
    if (!enabled) return;
    return observer.observe(kind && id ? { kind, id } : null, (value) =>
      setSeen({ selection, value }),
    );
  }, [selection]);
  return {
    ...(seen?.selection === selection && !access.signal.aborted
      ? seen.value
      : closed),
    refresh: () => observer.refresh(),
    whenReady: (epoch: string, signal: AbortSignal, expectedVersion?: number) =>
      observer.whenReady(epoch, signal, expectedVersion),
    reconnect: () => {
      access.check();
      const version = observer.nextObservation();
      setRevision((v) => v + 1);
      return version;
    },
  };
}
