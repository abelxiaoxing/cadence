/* The inspector's Branches tab: a session's user messages as Pi's /tree shows
 * them. A linear run stays flat and each fork indents its branches behind a
 * rail; the branch shown is marked. A row shows its message in its branch, and
 * its actions move the composer's anchor there. Nothing here sends, moves or
 * deletes anything. Cadence-own; the filter box reuses the sidebar's
 * (pi .lp-filter). */
import { useMemo, useState } from "react";
import {
  FiCornerDownRight,
  FiEdit2,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import type { ChatTreeNode } from "../../../../src/service/contracts/workbench.ts";
import {
  type ConversationTree,
  treeRows,
} from "../../client/conversation-tree";
import { describeError, useT } from "../../i18n/locale";

/** What the open conversation hands the tab: its one tree read and the ways
 * to act on a message of it. */
export interface BranchesView {
  /** The conversation it belongs to. */
  id: string;
  tree: ConversationTree | undefined;
  error: string | undefined;
  loading: boolean;
  /** A branch was chosen instead of following the session's latest. */
  pinned: boolean;
  /** No reply is queued or running: the anchor may be moved. */
  canAct: boolean;
  /** Show a message in its branch; readonly. */
  onShow(node: ChatTreeNode): void;
  onEdit(node: ChatTreeNode): void;
  onContinue(node: ChatTreeNode): void;
  onLatest(): void;
  onRefresh(): void;
}

export function BranchesPanel({
  view,
  onChosen,
}: {
  view: BranchesView | undefined;
  /** After a row or one of its actions was used: a phone closes its drawer. */
  onChosen?(): void;
}) {
  const { t, locale } = useT();
  const [filter, setFilter] = useState("");
  const when = (at: number) =>
    new Date(at).toLocaleString(locale === "zh" ? "zh-CN" : "en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const tree = view?.tree;
  const rows = useMemo(() => treeRows(tree?.nodes ?? []), [tree]);
  const query = filter.trim().toLowerCase();
  const shown = query
    ? rows.filter(({ node }) => node.text.toLowerCase().includes(query))
    : rows;
  const use = (act: (node: ChatTreeNode) => void, node: ChatTreeNode) => {
    act(node);
    onChosen?.();
  };
  return (
    <section className="branches-panel" aria-label={t("Conversation branches")}>
      <header className="panel-crumbs">
        <label className="lp-filter">
          <FiSearch aria-hidden="true" />
          <input
            type="search"
            value={filter}
            placeholder={t("Filter messages…")}
            aria-label={t("Filter messages…")}
            disabled={!rows.length}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filter && (
            <button
              type="button"
              className="lp-filter-clear"
              title={t("Clear filter")}
              aria-label={t("Clear filter")}
              onClick={() => setFilter("")}
            >
              <FiX aria-hidden="true" />
            </button>
          )}
        </label>
        <button
          type="button"
          className="crumb"
          title={t("Refresh branches")}
          aria-label={t("Refresh branches")}
          disabled={!view}
          onClick={() => view?.onRefresh()}
        >
          <FiRefreshCw aria-hidden="true" />
        </button>
      </header>
      <p className="panel-hint">
        {t(
          "Each line is a message; indented lines are branches. Choose one to read that branch. The terminal shares this tree (/tree in Pi).",
        )}
      </p>
      {view?.pinned && (
        <p className="branches-pinned">
          <span>{t("A chosen branch is shown, not the latest.")}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              view.onLatest();
              onChosen?.();
            }}
          >
            {t("Show the latest")}
          </button>
        </p>
      )}
      {view?.error && (
        <p className="inspector-note" role="alert">
          {describeError(t, view.error)}
        </p>
      )}
      {tree?.truncated && (
        <p className="inspector-note">
          {t("Only the newest messages are listed.")}
        </p>
      )}
      {!tree && !view?.error ? (
        <p className="panel-empty" role="status">
          {t("Reading…")}
        </p>
      ) : tree && rows.length === 0 ? (
        <p className="panel-empty">{t("No messages yet.")}</p>
      ) : tree && shown.length === 0 ? (
        <p className="panel-empty">{t("No matching messages")}</p>
      ) : null}
      <ol className="branch-rows" aria-busy={view?.loading || undefined}>
        {shown.map(({ node, depth }) => (
          <li
            key={node.id}
            className={`branch-item${node.current ? " current" : ""}`}
          >
            {Array.from({ length: depth }, (_, level) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: identical rails, one per fork level
              <span className="branch-rail" key={level} aria-hidden="true" />
            ))}
            <button
              type="button"
              className="branch-row"
              aria-current={node.current ? "true" : undefined}
              title={node.text}
              onClick={() => view && use(view.onShow, node)}
            >
              <span className="branch-dot" aria-hidden="true" />
              <span className="branch-text">{node.text || "…"}</span>
              {node.at > 0 && (
                <time dateTime={new Date(node.at).toISOString()}>
                  {when(node.at)}
                </time>
              )}
            </button>
            <button
              type="button"
              className="branch-act"
              aria-label={t("Edit and resend: {text}", {
                text: node.text || "…",
              })}
              title={t("Edit and resend")}
              disabled={!view?.canAct}
              onClick={() => view && use(view.onEdit, node)}
            >
              <FiEdit2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className="branch-act"
              aria-label={t("Continue from here: {text}", {
                text: node.text || "…",
              })}
              title={t("Continue from here")}
              disabled={!view?.canAct}
              onClick={() => view && use(view.onContinue, node)}
            >
              <FiCornerDownRight aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
