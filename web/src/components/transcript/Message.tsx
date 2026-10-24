/* Adapted from pi-web-ui Message.tsx readonly role/block/Markdown composition.
 * MIT (c) 2026 xing-shuyin. Retains original recorded text, including apparent markers.
 * No reask/fork/retry/steer, hidden thinking, media or transcript repair. */
import { memo, useState } from "react";
import { FiChevronUp, FiEye } from "react-icons/fi";
import { contentCursor } from "../../history/readers";
import type { HistoryRecord, ListRequest, ServiceClient } from "../../types";
import { ContentExplorer } from "../history/ContentExplorer";
import { DetailPane } from "../history/DetailPane";
export const Message = memo(function Message({
  message,
  client,
  seed,
}: {
  message: Extract<HistoryRecord, { kind: "message" }>;
  client: ServiceClient;
  seed: ListRequest;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article
      className={`msg msg-${message.role}`}
      data-msg-id={message.owner.entity.id}
    >
      <header className="msg-meta">
        <strong className="msg-role">{message.role}</strong>
        <span className="msg-state">
          {message.state} message record, not execution outcome
        </span>
        <span className="msg-time">v{message.version}</span>
        <button
          type="button"
          className="msg-inspect"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <FiChevronUp aria-hidden="true" />
          ) : (
            <FiEye aria-hidden="true" />
          )}
          {expanded ? "Collapse" : "Inspect message"}
        </button>
      </header>
      <div className="msg-body">
        <p className="msg-ident">
          Child {message.owner.childRunId} · message {message.owner.entity.id} ·
          version {message.version}
        </p>
        {message.role === "tool-result" && (
          <p className="msg-note">
            Result call: {message.resultCallId ?? "unassociated / orphan"}. Kept
            visible independently of the tool card.
          </p>
        )}
        {expanded && (
          <div className="msg-text">
            <div className="msg-text-main">
              {message.finalText &&
              seed.scope.kind !== "workspace" &&
              seed.snapshotSeq !== null ? (
                <DetailPane
                  client={client}
                  cursor={contentCursor(
                    seed.storeId,
                    seed.scope,
                    seed.snapshotSeq,
                    message.finalText,
                  )}
                />
              ) : (
                <p>
                  No finalized text field in this snapshot. Inspect retained
                  partial/final blocks and omission metadata below.
                </p>
              )}
              <details>
                <summary>
                  All message blocks, source limits and tool associations
                </summary>
                <ContentExplorer
                  client={client}
                  seed={seed}
                  entityId={message.owner.entity.id}
                />
              </details>
            </div>
          </div>
        )}
      </div>
    </article>
  );
});
