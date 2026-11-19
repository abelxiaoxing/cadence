import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowRun } from "../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../types";

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
    typeof empty & { scope: typeof records }
  >();
  const refresh = useRef<() => void>(undefined);
  const key = JSON.stringify([...new Set(ids)]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      setObservation({
        scope: records,
        runs,
        error,
        unreadable,
        incomplete: listed.some((id) => !byId.has(id)),
      });
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
      } else if ([...runs.values()].some((run) => LIVE.includes(run.status)))
        timer = setTimeout(() => void poll(), 1000);
      else if (missed.size)
        timer = setTimeout(() => void poll(), UNREAD_RETRY_MS);
    };
    refresh.current = poll;
    void poll();
    return () => {
      refresh.current = undefined;
      abort.abort();
      clearTimeout(timer);
    };
  }, [key, records]);
  return {
    ...(observation?.scope === records ? observation : empty),
    refresh: () => refresh.current?.(),
  };
}
