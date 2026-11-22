import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowRun } from "../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../types";
import { onPageVisible, pageHidden } from "./visibility";

const LIVE = ["queued", "running"];
/** Reads in flight at once, newest first. Unobserved attempts retry less often. */
const READS = 4;
const UNREAD_RETRY_MS = 10000;
type RecordView = { run: WorkflowRun; error?: string };
const empty = {
  runs: new Map<string, WorkflowRun>(),
  unreadable: new Set<string>(),
  incomplete: true,
  error: undefined as string | undefined,
};

/** Session entries are discovery hints (including in forks), not attribution.
 * A null cache entry means the run was read and does not belong to this session.
 * Keep known live observations across ID-list changes, never across scopes. */
export function useWorkflowRuns(
  client: Pick<ServiceClient, "workbenchRead">,
  conversationId: string,
  ids: readonly string[],
) {
  const records = useMemo(
    () => ({
      client,
      conversationId,
      byId: new Map<string, RecordView | null>(),
    }),
    [client, conversationId],
  );
  const [observation, setObservation] = useState<
    typeof empty & { scope: typeof records; signature?: string }
  >();
  const refreshRef = useRef<() => void>(undefined);
  const key = JSON.stringify([...new Set(ids)]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    const listed = JSON.parse(key) as string[];
    const wanted = new Set(listed);
    const { byId } = records;
    for (const id of byId.keys()) if (!wanted.has(id)) byId.delete(id);
    const missed = new Map<string, number>();
    const publish = () => {
      let error: string | undefined;
      const runs = new Map<string, WorkflowRun>();
      // Neither a refused attempt nor a copied ID stalls older history pages.
      const unreadable = new Set(missed.keys());
      for (const id of listed) {
        const record = byId.get(id);
        if (record) {
          runs.set(id, record.run);
          error ??= record.error;
        } else if (record === null) unreadable.add(id);
      }
      const incomplete = listed.some((id) => !byId.has(id));
      const signature = JSON.stringify([
        error ?? null,
        incomplete,
        [...unreadable],
        [...runs],
      ]);
      setObservation((previous) =>
        previous?.scope === records && previous.signature === signature
          ? previous
          : {
              scope: records,
              runs,
              error,
              unreadable,
              incomplete,
              signature,
            },
      );
      return runs;
    };
    const read = async (id: string) => {
      const reply = await records.client.workbenchRead(
        { kind: "workflow", id },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      const run =
        reply.kind === "ok" &&
        reply.value.kind === "workflow" &&
        reply.value.response.type === "run"
          ? reply.value.response.run
          : null;
      if (run?.id === id) {
        byId.set(
          id,
          run.execution?.version.conversation?.id === records.conversationId
            ? { run }
            : null,
        );
        missed.delete(id);
      } else {
        const record = byId.get(id);
        if (record)
          record.error =
            reply.kind === "error" ? reply.error.code : "unavailable";
        else missed.set(id, Date.now());
      }
    };
    let reading = false;
    let requested = false;
    const poll = async () => {
      clearTimeout(timer);
      paused = false;
      if (reading) {
        requested = true;
        return;
      }
      reading = true;
      const now = Date.now();
      const due = listed
        .filter((id) => {
          const previous = byId.get(id);
          return previous === undefined
            ? now - (missed.get(id) ?? -Infinity) >= UNREAD_RETRY_MS
            : previous !== null && LIVE.includes(previous.run.status);
        })
        .reverse();
      for (let i = 0; i < due.length; i += READS) {
        await Promise.all(due.slice(i, i + READS).map(read));
        if (abort.signal.aborted) return;
        if (i + READS < due.length) publish();
      }
      const runs = publish();
      reading = false;
      if (requested) {
        requested = false;
        void poll();
      } else {
        const delay = [...runs.values()].some((run) =>
          LIVE.includes(run.status),
        )
          ? 1000
          : missed.size
            ? UNREAD_RETRY_MS
            : 0;
        if (delay) {
          if (pageHidden()) paused = true;
          else timer = setTimeout(() => void poll(), delay);
        }
      }
    };
    const unsubscribeVisible = onPageVisible(() => {
      if (!paused || abort.signal.aborted) return;
      paused = false;
      void poll();
    });
    refreshRef.current = poll;
    void poll();
    return () => {
      unsubscribeVisible();
      refreshRef.current = undefined;
      abort.abort();
      paused = false;
      clearTimeout(timer);
    };
  }, [key, records]);
  const refresh = useCallback(() => refreshRef.current?.(), []);
  const current = observation?.scope === records ? observation : empty;
  return useMemo(
    () => ({
      runs: current.runs,
      unreadable: current.unreadable,
      incomplete: current.incomplete,
      error: current.error,
      refresh,
    }),
    [current, refresh],
  );
}
