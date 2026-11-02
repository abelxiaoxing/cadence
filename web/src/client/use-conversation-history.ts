import { useState } from "react";
import type {
  ChatCursor,
  WorkbenchResult,
} from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { useWorkbench } from "./use-workbench";

type Page = Extract<WorkbenchResult, { kind: "conversations" }>;
/**
 * The project's Pi sessions, most recently written first, in pages.
 * The first page follows sessions the terminal or a Send writes by re-reading
 * quietly: a list already shown stays in place until its next read replaces
 * it, so only a page with nothing to show yet reports `loading`.
 */
export function useConversationHistory(
  client: ServiceClient,
  enabled: boolean,
) {
  const [after, setAfter] = useState<ChatCursor | null>(null);
  const [back, setBack] = useState<(ChatCursor | null)[]>([]);
  const request = useWorkbench(
    client,
    enabled ? { kind: "conversations", after } : null,
    after === null ? 2000 : 0,
  );
  const page: Page | undefined =
    request.value?.kind === "conversations" ? request.value : undefined;
  return {
    value: page,
    error: request.error,
    loading: enabled && !page && !request.error,
    refresh: request.refresh,
    canPrevious: back.length > 0,
    first: () => {
      setAfter(null);
      setBack([]);
    },
    previous: () => {
      if (!back.length) return;
      setAfter(back.at(-1) ?? null);
      setBack((rows) => rows.slice(0, -1));
    },
    next: () => {
      if (!page?.next) return;
      setBack((rows) => [...rows, after]);
      setAfter(page.next);
    },
  };
}
