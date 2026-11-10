/* Adapted from pi-web-ui web/src/components/FileChangeCard.tsx @ b627452c: the
 * card toolbar (path, language, line counts), UnifiedDiffView, DiffLineRow and
 * WriteCodeView. MIT (c) 2026 xing-shuyin.
 * Cadence: the body of an opened `edit` or `write` tool card, built from the
 * call's recorded arguments. It says what the call asked for and is never
 * compared with the file. No split or raw view, fullscreen portal, open-file
 * bridge, copy action or streaming state. */
import { useState } from "react";
import { FiAlertCircle, FiFileText } from "react-icons/fi";
import { useT } from "../../i18n/locale";
import type { DiffLine, FileDiffData } from "../../rich/file-diff";

/** Lines rendered before the rest waits behind an explicit action: a recorded
 * `write` can hold megabytes. */
export const DIFF_LINE_LIMIT = 400;

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div className={`diff-line-row ${line.type}`}>
      <span className="diff-gutter-sym">{line.type === "add" ? "+" : "-"}</span>
      <span className="diff-line-content">
        {line.tokens?.length
          ? line.tokens.map((token, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one recorded line never reorder
                key={index}
                className={
                  token.type === "same" ? undefined : `char-${token.type}`
                }
              >
                {token.text}
              </span>
            ))
          : line.content || " "}
      </span>
    </div>
  );
}

export function FileChangeCard({
  data,
  failed = false,
}: {
  data: FileDiffData;
  /** The call recorded an error: what follows was asked for, not applied. */
  failed?: boolean;
}) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  const total = data.additions + data.deletions;
  let room = all ? Number.POSITIVE_INFINITY : DIFF_LINE_LIMIT;
  const shown = data.hunks.flatMap((hunk, index) => {
    const lines = hunk.lines.slice(0, Math.max(room, 0));
    room -= lines.length;
    return lines.length > 0 ? [{ hunk, index, lines }] : [];
  });
  return (
    <div className={`file-diff-card${failed ? " is-err" : ""}`}>
      <div className="file-diff-toolbar">
        <div className="file-diff-info">
          <FiFileText className="file-diff-file-icon" aria-hidden="true" />
          <span className="file-diff-path" title={data.filePath}>
            {data.filePath || t("No path recorded")}
          </span>
          {data.language !== "plaintext" && (
            <span className="file-diff-lang">{data.language}</span>
          )}
          <span
            className="file-diff-stat-badge"
            title={t("{added} lines added, {removed} removed", {
              added: data.additions,
              removed: data.deletions,
            })}
          >
            <span className="add">+{data.additions}</span>
            {!data.isWrite && <span className="del">-{data.deletions}</span>}
          </span>
        </div>
        <span
          className="file-diff-claim"
          title={t(
            "Built from the call's recorded arguments. It is not compared with the file, so it is not proof of what the file holds.",
          )}
        >
          {failed && <FiAlertCircle aria-hidden="true" />}
          {failed
            ? t("Error recorded: requested, not applied")
            : data.isWrite
              ? t("Requested content")
              : t("Requested change")}
        </span>
      </div>
      <div className="file-diff-body">
        {total === 0 ? (
          <div className="diff-empty-tip">{t("No lines recorded.")}</div>
        ) : (
          <div className="diff-unified-view">
            {shown.map(({ hunk, index, lines }) => (
              <div className="diff-hunk-section" key={index}>
                {data.hunks.length > 1 && (
                  <div className="diff-hunk-header">
                    <span className="diff-hunk-text">
                      {t(
                        "Replacement {index} of {count}: {removed} lines for {added}",
                        {
                          index: index + 1,
                          count: data.hunks.length,
                          removed: hunk.removed,
                          added: hunk.added,
                        },
                      )}
                    </span>
                  </div>
                )}
                {lines.map((line, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: recorded lines never reorder
                  <DiffLineRow key={at} line={line} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {!all && total > DIFF_LINE_LIMIT && (
        <p className="file-diff-more">
          {t("Showing the first {shown} of {total} lines.", {
            shown: DIFF_LINE_LIMIT,
            total,
          })}{" "}
          <button type="button" onClick={() => setAll(true)}>
            {t("Show all lines")}
          </button>
        </p>
      )}
    </div>
  );
}
