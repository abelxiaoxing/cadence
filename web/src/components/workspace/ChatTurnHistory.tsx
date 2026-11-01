import { useState } from "react";
import type { ChatTurn } from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";
import { ChatTurnView } from "./ChatTurnView";

/** One full transcript page at a time; polling the latest turn never replaces
 * an explicitly selected historical page or grows an unbounded browser list. */
export function ChatTurnHistory({
  client,
  conversationId,
  turn,
}: {
  client: ServiceClient;
  conversationId: string;
  turn: ChatTurn;
}) {
  const { t } = useT();
  const [page, setPage] = useState<number | null>(null);
  const read = useWorkbench(
    client,
    page === null
      ? null
      : {
          kind: "conversation-transcript",
          id: conversationId,
          turnId: turn.id,
          page,
        },
  );
  const value =
    read.value?.kind === "conversation-transcript" ? read.value : undefined;
  const pages = turn.transcript?.pages ?? 0;
  return (
    <div>
      {pages > 0 && (
        <nav aria-label={t("Turn transcript")}>
          {page === null ? (
            <button type="button" className="ghost" onClick={() => setPage(0)}>
              {t("Full transcript ({pages} pages)", { pages })}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="ghost"
                disabled={page === 0 || read.loading}
                onClick={() => setPage(page - 1)}
              >
                {t("Previous page")}
              </button>
              <span>
                {t("Transcript page {page} of {pages}", {
                  page: page + 1,
                  pages,
                })}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={page + 1 >= pages || read.loading}
                onClick={() => setPage(page + 1)}
              >
                {t("Next page")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setPage(null)}
              >
                {t("Latest messages")}
              </button>
            </>
          )}
        </nav>
      )}
      {page !== null && (
        <p className="inspector-note">
          {t(
            "Long messages and tool results continue on the next transcript page.",
          )}
        </p>
      )}
      {read.error && (
        <p role="alert">
          {describeError(t, read.error)}{" "}
          <button type="button" onClick={read.refresh}>
            {t("Observe current state")}
          </button>
        </p>
      )}
      {page === null ? (
        <ChatTurnView turn={turn} />
      ) : (
        value && <ChatTurnView turn={value.turn} />
      )}
    </div>
  );
}
