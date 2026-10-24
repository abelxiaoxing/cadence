/* Adapted from pi-web-ui components/ToolCallBlock.tsx; MIT (c) 2026 xing-shuyin.
 * Retains expandable header, path/status head chrome, raw arguments/output panes.
 * Removes inferred stream status, result regex IDs, bash-kill, plugins and media paths. */
import { memo, useState } from "react";
import { FiTool } from "react-icons/fi";
import type { HistoryRecord, ListRequest, ServiceClient } from "../../types";
import { ContentExplorer } from "../history/ContentExplorer";
import { CollapsibleHead } from "./CollapsibleHead";
export const ToolCallBlock = memo(function ToolCallBlock({
  record,
  client,
  seed,
}: {
  record: Extract<HistoryRecord, { kind: "tool" }>;
  client: ServiceClient;
  seed: ListRequest;
}) {
  const [open, setOpen] = useState(false);
  const status = record.result
    ? record.result.isError
      ? "SDK tool error observed"
      : "SDK tool end observed"
    : record.startObserved
      ? "Start observed; end not observed in this snapshot"
      : "No start observed";
  const tone = record.result
    ? record.result.isError
      ? "err"
      : "ok"
    : record.startObserved
      ? "pending"
      : "";
  return (
    <div className={`toolcall ${record.result?.isError ? "err" : ""}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headClassName="toolcall-head"
        titleText="Inspect recorded tool call"
        icon={<FiTool />}
        iconClassName="toolcall-icon"
        titleClassName="toolcall-name"
        after={
          <>
            <span className="toolcall-path">
              Child {record.owner.childRunId} · call {record.owner.entity.id} ·
              v{record.version}
            </span>
            <span className={`toolcall-badge ${tone}`}>{status}</span>
          </>
        }
      >
        {record.name}
      </CollapsibleHead>
      {open && (
        <div className="toolcall-body">
          <p>
            SDK tool observations are not native process launch/close or passing
            parent checks.
          </p>
          <dl>
            <dt>Source ID</dt>
            <dd>
              {record.source.disposition}:{" "}
              {record.source.value ?? "unavailable"}
            </dd>
            <dt>Declaration</dt>
            <dd>
              {record.declaration
                ? `${record.declaration.messageId} / ${record.declaration.blockId} (${record.declarationStage})`
                : "No declaration recorded; orphan result remains accessible"}
            </dd>
          </dl>
          <div className="toolcall-output">
            <div className="toolcall-output-label">
              Recorded tool end (not parsed from output)
            </div>
            <pre>
              {record.result
                ? JSON.stringify(record.result, null, 2)
                : "No end fact in this snapshot."}
            </pre>
          </div>
          <div className="toolcall-args">
            <ContentExplorer
              client={client}
              seed={seed}
              entityId={record.owner.entity.id}
            />
          </div>
        </div>
      )}
    </div>
  );
});
