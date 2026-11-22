import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeWorkbenchRead,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { publicError } from "../../../src/service-contract.ts";
import { observationRetryMs, refusedAccess } from "./observation-read";
import type { ObservationAccess } from "./observer";

/** Readonly polling only; never replays a command after loss, navigation or reconnect. */
export function useWorkbench(
  client: Pick<ServiceClient, "workbenchRead">,
  request: WorkbenchRead | null,
  interval = 0,
  access?: ObservationAccess,
  attachmentVersion = 0,
  allocation?: AbortSignal,
) {
  const key = JSON.stringify(request);
  const scope = useMemo(
    () => ({ client, key, attachmentVersion, access, allocation }),
    [client, key, attachmentVersion, access, allocation],
  );
  const latest = useRef(scope);
  latest.current = scope;
  // Adjusting a positive poll cadence (e.g. idle backoff) applies to the next
  // timer without aborting an in-flight read; toggling polling on/off still
  // runs a fresh pass so a settling stream gets its final read.
  const cadence = useRef(interval);
  cadence.current = interval;
  const polling = interval > 0;
  const [revision, setRevision] = useState(0);
  const next = useRef(0);
  const retire = useRef<() => void>(undefined);
  const [state, setState] = useState<{
    scope: typeof scope;
    revision: number;
    value?: WorkbenchResult;
    error?: string;
  }>();
  useEffect(() => {
    if (key === "null" || access?.signal.aborted || allocation?.aborted) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      abort.abort();
      clearTimeout(timer);
    };
    retire.current = stop;
    const unsubscribe = access?.subscribe(stop);
    allocation?.addEventListener("abort", stop);
    const load = async () => {
      const reply = await client
        .workbenchRead(decodeWorkbenchRead(JSON.parse(key)), abort.signal)
        .catch(() => ({
          kind: "error" as const,
          error: publicError("unavailable"),
        }));
      if (
        abort.signal.aborted ||
        latest.current !== scope ||
        next.current !== revision
      )
        return;
      if (reply.kind === "error" && access && refusedAccess(reply.error.code)) {
        access.refuse("viewer", reply.error.code);
        return;
      }
      setState((previous) =>
        reply.kind === "ok"
          ? { scope, revision, value: reply.value }
          : {
              scope,
              revision,
              value: previous?.scope === scope ? previous.value : undefined,
              error: reply.error.code,
            },
      );
      const delay = polling
        ? cadence.current
        : access && reply.kind === "error"
          ? observationRetryMs
          : 0;
      if (delay) timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => {
      allocation?.removeEventListener("abort", stop);
      unsubscribe?.();
      stop();
    };
  }, [client, key, revision, polling, access, scope, allocation]);
  const refresh = useCallback(() => {
    if (latest.current !== scope || access?.signal.aborted) return;
    retire.current?.();
    setRevision(++next.current);
  }, [scope, access]);
  const sameAttachment =
    !access?.signal.aborted && !allocation?.aborted && state?.scope === scope;
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
