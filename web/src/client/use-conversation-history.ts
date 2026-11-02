import { useCallback, useEffect, useState } from "react";
import type {
  ChatCursor,
  WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { useWorkbench } from "./use-workbench";

type Page = Extract<WorkbenchResult, { kind: "conversations" }>;
/** The project's Pi sessions, most recently written first, in pages. */
export function useConversationHistory(
  client: ServiceClient,
  enabled: boolean,
) {
  const [after, setAfter] = useState<ChatCursor | null>(null);
  const [back, setBack] = useState<(ChatCursor | null)[]>([]);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<{
    key: string;
    boundary: string;
    page: Page;
  }>();
  const boundary = JSON.stringify(after);
  const key = JSON.stringify([after, revision]);
  const request = useWorkbench(
    client,
    enabled ? { kind: "conversations", after } : null,
  );
  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
    request.refresh();
  }, [request.refresh]);
  useEffect(() => {
    if (request.loading || request.error || !request.value) return;
    if (request.value.kind === "conversations")
      setSaved({ key, boundary, page: request.value });
  }, [request.value, request.error, request.loading, key, boundary]);
  const loading =
    enabled && !request.error && (request.loading || saved?.key !== key);
  useEffect(() => {
    if (!enabled || after !== null || loading) return;
    const timer = setTimeout(refresh, 2000);
    return () => clearTimeout(timer);
  }, [enabled, after, loading, refresh]);
  return {
    value: saved?.boundary === boundary ? saved.page : undefined,
    error: request.error,
    loading,
    refresh,
    canPrevious: back.length > 0,
    first: () => {
      setAfter(null);
      setBack([]);
      refresh();
    },
    previous: () => {
      if (loading || !back.length) return;
      setAfter(back.at(-1) ?? null);
      setBack((rows) => rows.slice(0, -1));
    },
    next: () => {
      if (loading || !saved?.page.next) return;
      setBack((rows) => [...rows, after]);
      setAfter(saved.page.next);
    },
  };
}
