import { useEffect, useMemo, useRef, useState } from "react";
import type { ServiceClient } from "../../../src/service-client.ts";
import {
  ConversationReader,
  type ConversationView,
} from "./conversation-reader";

/** One conversation's observed turns. Pausing (`enabled` false) keeps what
 * is shown; nothing is cleared while the owner is briefly unavailable. */
export function useConversation(
  client: Pick<ServiceClient, "workbenchRead">,
  id: string,
  enabled: boolean,
  initialLeaf: string | null = null,
): ConversationView & {
  refresh(): void;
  loadEarlier(): void;
  showFrom(ordinal: number): void;
  choose(leaf: string | null, first?: number): void;
} {
  const scope = useMemo(
    () => ({ client, id, initialLeaf }),
    [client, id, initialLeaf],
  );
  const latest = useRef(scope);
  latest.current = scope;
  const [state, setState] = useState<{
    scope: typeof scope;
    reader: ConversationReader;
    view: ConversationView;
  }>();
  useEffect(() => {
    const next = new ConversationReader(client, id, () => {
      if (latest.current === scope)
        setState({ scope, reader: next, view: next.view() });
    });
    next.choose(initialLeaf);
    setState({ scope, reader: next, view: next.view() });
    return () => next.close();
  }, [client, id, initialLeaf, scope]);
  // Navigation fences old data and actions during render, before effect cleanup.
  const current = state?.scope === scope ? state : undefined;
  const reader = current?.reader;
  const view = current?.view;
  useEffect(() => {
    reader?.setActive(enabled);
  }, [reader, enabled]);
  return {
    ...(view ?? {
      summary: undefined,
      leaf: null,
      pinned: false,
      branches: 0,
      runs: [],
      attempt: null,
      pending: [],
      undelivered: [],
      commands: [],
      count: 0,
      turns: [],
      earlier: false,
      loadingEarlier: false,
      error: "",
    }),
    refresh: reader?.refresh ?? noop,
    loadEarlier: reader?.loadEarlier ?? noop,
    showFrom: reader?.showFrom ?? noop,
    choose: reader?.choose ?? noop,
  };
}
function noop() {}
