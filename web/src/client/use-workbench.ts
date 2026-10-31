import { useCallback, useEffect, useState } from "react";
import {
  decodeWorkbenchRead,
  type WorkbenchRead,
  type WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
/** Readonly polling only; never replays a command after loss, navigation or reconnect. */
export function useWorkbench(
  client: Pick<ServiceClient, "workbenchRead">,
  request: WorkbenchRead | null,
  interval = 0,
) {
  const key = JSON.stringify(request);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    revision: number;
    value?: WorkbenchResult;
    error?: string;
  }>({ key, revision: -1 });
  useEffect(() => {
    if (key === "null") return;
    void revision; // Explicit readonly refresh, never a command replay.
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const reply = await client.workbenchRead(
        decodeWorkbenchRead(JSON.parse(key)),
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setState((previous) =>
        reply.kind === "ok"
          ? { key, revision, value: reply.value }
          : {
              key,
              revision,
              value: previous.key === key ? previous.value : undefined,
              error: reply.error.code,
            },
      );
      if (interval) timer = setTimeout(() => void load(), interval);
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key, revision, interval]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return {
    ...(state.key === key ? state : {}),
    // Retained display data is not a settled initial/explicit observation.
    loading:
      key !== "null" && (state.key !== key || state.revision !== revision),
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
