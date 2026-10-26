/* Adapted from pi-web-ui components/ToolCallBlock.tsx; MIT (c) 2026 xing-shuyin.
 * Retains expandable header, path/status head chrome, raw arguments/output panes.
 * Removes inferred stream status, result regex IDs, bash-kill, plugins and media paths. */
import { memo, useState } from "react";
import { FiTool } from "react-icons/fi";
import { useT } from "../../i18n/locale";
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
  const { t, tx } = useT();
  const [open, setOpen] = useState(false);
  const status = record.result
    ? record.result.isError
      ? t("SDK tool error observed")
      : t("SDK tool end observed")
    : record.startObserved
      ? t("Start observed; end not observed in this snapshot")
      : t("No start observed");
  const tone = record.result
    ? record.result.isError
      ? "err"
      : "ok"
    : record.startObserved
      ? "pending"
      : "";
  return (
    <div className={`toolcall${tone === "err" ? " err" : ""}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((v) => !v)}
        headClassName="toolcall-head"
        titleText={t("Inspect recorded tool call")}
        icon={<FiTool />}
        iconClassName="toolcall-icon"
        titleClassName="toolcall-name"
        after={
          <>
            <span className="toolcall-path">
              {t("Child {child} · call {call} · v{version}", {
                child: record.owner.childRunId ?? "",
                call: record.owner.entity.id,
                version: record.version,
              })}
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
            {t(
              "SDK tool observations are not native process launch/close or passing parent checks.",
            )}
          </p>
          <dl>
            <dt>{t("Source ID")}</dt>
            <dd>
              {tx(record.source.disposition)}:{" "}
              {record.source.value ?? t("unavailable")}
            </dd>
            <dt>{t("Declaration")}</dt>
            <dd>
              {record.declaration
                ? `${record.declaration.messageId} / ${record.declaration.blockId} (${tx(String(record.declarationStage))})`
                : t(
                    "No declaration recorded; orphan result remains accessible",
                  )}
            </dd>
          </dl>
          <div className="toolcall-output">
            <div className="toolcall-output-label">
              {t("Recorded tool end (not parsed from output)")}
            </div>
            <pre>
              {record.result
                ? JSON.stringify(record.result, null, 2)
                : t("No end fact in this snapshot.")}
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
