/** Recorded history does not need a viewer session. Retain only
 * pagination identity, never the workspace's controls, live roster or models. */
import { useEffect, useMemo, useRef, useState } from "react";
import { ServiceClient } from "../../../src/service-client.ts";
import { HttpServiceTransport } from "../../../src/service-http-client.ts";
import type { WorkspaceBootstrap } from "../types";
import { observationRetryMs, refusedAccess } from "./observation-read";
import type { ObservationAccess } from "./observer";

type TaskHistoryWorkspace = Pick<
  WorkspaceBootstrap,
  "workspaceId" | "storeId" | "epoch" | "committedSeq"
>;

export interface RetainedTaskHistory {
  workspace: TaskHistoryWorkspace;
  client: ServiceClient;
}

const readTimeoutMs = 10000;

export function useRetainedTaskWorkspace(
  project: string | undefined,
  task: string | null,
  workspaceId: string | null | undefined,
  epoch: string | null | undefined,
  access: ObservationAccess,
) {
  const [revision, setRevision] = useState(0);
  const retire = useRef<() => void>(undefined);
  const selection = useMemo(
    () => ({ project, task, workspaceId, epoch, access, revision }),
    [project, task, workspaceId, epoch, access, revision],
  );
  const latest = useRef(selection);
  latest.current = selection;
  const [read, setRead] = useState<{
    selection: typeof selection;
    history?: RetainedTaskHistory;
    error?: string;
  }>();
  useEffect(() => {
    const { project, workspaceId, epoch, access } = selection;
    if (!project || !workspaceId || !epoch || access.signal.aborted) return;
    let retired = false;
    const currentSelection = () =>
      !retired && !access.signal.aborted && latest.current === selection;
    // Separate from the viewer transport: even a proof-only continuation that
    // requires a POST cannot borrow a retiring attachment/CSRF. Page readers
    // keep their own bounded request, cancellation and reply correlation.
    const client = new ServiceClient(
      new HttpServiceTransport({
        origin: window.location.origin,
        project,
        retainedHistory: true,
        requestTimeoutMs: readTimeoutMs,
        fetch: async (url, init) => {
          if (!currentSelection()) throw new Error("stale");
          const response = await fetch(url, init);
          if (!currentSelection() || init?.signal?.aborted) {
            void response.body?.cancel().catch(() => {});
            throw new Error("stale");
          }
          if (response.status === 401 || response.status === 403)
            access.refuse(
              "project",
              response.status === 401 ? "unauthenticated" : "forbidden",
            );
          return response;
        },
      }),
    );
    let attempt: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const controller = new AbortController();
      attempt = controller;
      const current = () => currentSelection() && !controller.signal.aborted;
      const failed = (error: string) => {
        if (!current()) return;
        controller.abort();
        clearTimeout(timer);
        if (refusedAccess(error)) {
          access.refuse("project", error);
          return;
        }
        setRead({ selection, error });
        timer = setTimeout(load, observationRetryMs);
      };
      // Retire the wait too, even if an already-delivered response body does
      // not settle on abort. Only one attempt can publish or schedule a retry.
      timer = setTimeout(() => failed("timeout"), readTimeoutMs);
      void client
        .workspace(controller.signal)
        .then((reply) => {
          if (!current()) return;
          if (reply.kind === "error") return failed(reply.error.code);
          const value = reply.value; // ServiceClient already decoded the bounded workspace reply.
          if (value.workspaceId !== workspaceId || value.epoch !== epoch)
            return failed(
              "History workspace does not match the selected owner",
            );
          clearTimeout(timer);
          setRead({
            selection,
            history: {
              client,
              workspace: {
                workspaceId,
                epoch,
                storeId: value.storeId,
                committedSeq: value.committedSeq,
              },
            },
          });
        })
        .catch(() => failed("unavailable"));
    };
    const stop = () => {
      retired = true;
      clearTimeout(timer);
      attempt.abort();
    };
    retire.current = stop;
    const unsubscribe = access.subscribe(stop);
    load();
    return () => {
      retire.current = undefined;
      unsubscribe();
      stop();
    };
  }, [selection]);
  const refresh = () => {
    if (!project || access.signal.aborted || latest.current !== selection)
      return;
    retire.current?.();
    setRevision((n) => n + 1);
  };
  if (!project || access.signal.aborted) return { refresh };
  if (!epoch || !workspaceId)
    return { error: "History identity not confirmed", refresh };
  return { ...(read?.selection === selection ? read : {}), refresh };
}
