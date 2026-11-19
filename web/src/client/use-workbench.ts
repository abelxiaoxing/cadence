import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeWorkbenchRead,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { refusedAccess } from "./observation-read";
import type { ObservationAccess } from "./observer";

/** Readonly polling only; never replays a command after loss, navigation or reconnect. */
export function useWorkbench(
  client: Pick<ServiceClient, "workbenchRead">,
  request: WorkbenchRead | null,
  interval = 0,
  access?: ObservationAccess,
  attachmentVersion = 0,
) {
  const key = JSON.stringify(request);
  const attachment = useRef(attachmentVersion);
  attachment.current = attachmentVersion;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attachmentVersion: number;
    revision: number;
    value?: WorkbenchResult;
    error?: string;
  }>({ key, revision: -1, attachmentVersion });
  useEffect(() => {
    if (key === "null" || access?.signal.aborted) return;
    void revision; // Explicit readonly refresh, never a command replay.
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      abort.abort();
      clearTimeout(timer);
    };
    const unsubscribe = access?.subscribe(stop);
    const load = async () => {
      const reply = await client.workbenchRead(
        decodeWorkbenchRead(JSON.parse(key)),
        abort.signal,
      );
      if (abort.signal.aborted || attachment.current !== attachmentVersion)
        return;
      if (reply.kind === "error" && access && refusedAccess(reply.error.code)) {
        access.refuse("viewer", reply.error.code);
        return;
      }
      setState((previous) =>
        reply.kind === "ok"
          ? { key, revision, attachmentVersion, value: reply.value }
          : {
              key,
              revision,
              attachmentVersion,
              value:
                previous.key === key &&
                previous.attachmentVersion === attachmentVersion
                  ? previous.value
                  : undefined,
              error: reply.error.code,
            },
      );
      if (interval) timer = setTimeout(() => void load(), interval);
    };
    void load();
    return () => {
      unsubscribe?.();
      stop();
    };
  }, [client, key, revision, interval, access, attachmentVersion]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const sameAttachment =
    !access?.signal.aborted &&
    state.key === key &&
    state.attachmentVersion === attachmentVersion;
  return {
    ...(sameAttachment ? state : {}),
    // Retained display data is not a settled initial/explicit observation.
    loading: key !== "null" && (!sameAttachment || state.revision !== revision),
    refresh,
  };
}
export function cadenceInput(
  value: string,
  selected: "chat" | "cadence",
): { mode: "chat" | "cadence"; text: string } {
  // Only the slash command: a bare "cadence ..." sentence would otherwise turn
  // on persistent Cadence mode for the whole conversation.
  const prefix = /^\/cadence(?:\s+|$)/.exec(value.trimStart());
  return prefix
    ? { mode: "cadence", text: value.trimStart().slice(prefix[0].length) }
    : { mode: selected, text: value };
}
