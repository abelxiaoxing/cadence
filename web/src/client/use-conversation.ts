import { useEffect, useState } from "react";
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
): ConversationView & { refresh(): void; loadEarlier(): void } {
  const [reader, setReader] = useState<ConversationReader | null>(null);
  const [view, setView] = useState<ConversationView | null>(null);
  useEffect(() => {
    const next = new ConversationReader(client, id, () => setView(next.view()));
    setReader(next);
    setView(next.view());
    return () => next.close();
  }, [client, id]);
  useEffect(() => {
    reader?.setActive(enabled);
  }, [reader, enabled]);
  return {
    ...(view ?? {
      summary: undefined,
      count: 0,
      turns: [],
      earlier: false,
      loadingEarlier: false,
      error: "",
    }),
    refresh: reader?.refresh ?? noop,
    loadEarlier: reader?.loadEarlier ?? noop,
  };
}
function noop() {}
