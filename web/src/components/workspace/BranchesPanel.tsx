/* The inspector's Tree tab: a session's user messages as Pi's /tree shows
 * them. A linear conversation renders as a quiet timeline; forks draw exact
 * rails with a continuous active path and fold long off-path branches by
 * default. Nothing here sends, moves or deletes anything. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  FiChevronDown,
  FiChevronRight,
  FiCornerDownRight,
  FiEdit2,
  FiRefreshCw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import type { ChatTreeNode } from "../../../../src/service/contracts/workbench.ts";
import {
  type AncestorLane,
  buildTreeLayout,
  type ConversationTree,
} from "../../client/conversation-tree";
import { describeError, type Locale, useT } from "../../i18n/locale";

/** Minimal hierarchical conversation-tree icon matching Feather stroke weight,
 * intentionally distinct from Git branch glyphs. */
export function ConversationTreeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5.5" cy="5.5" r="2" />
      <path d="M10.5 5.5H19.5" />
      <path d="M5.5 7.5V16.5A2 2 0 0 0 7.5 18.5H19" />
      <path d="M5.5 10A2 2 0 0 0 7.5 12H17" />
    </svg>
  );
}

/** What the open conversation hands the tab: its one tree read and the ways
 * to act on a message of it. */
export interface BranchesView {
  /** The conversation it belongs to. */
  id: string;
  tree: ConversationTree | undefined;
  error: string | undefined;
  loading: boolean;
  /** An earlier path was chosen instead of following the session's latest. */
  pinned: boolean;
  /** No reply is live: the anchor may be moved. */
  canAct: boolean;
  /** Show a message on its path; readonly. */
  onShow(node: ChatTreeNode): void;
  onEdit(node: ChatTreeNode): void;
  onContinue(node: ChatTreeNode): void;
  onLatest(): void;
  onRefresh(): void;
}

export function compactTime(
  at: number,
  locale: Locale,
  now = Date.now(),
): string {
  const date = new Date(at);
  const current = new Date(now);
  const sameYear = date.getFullYear() === current.getFullYear();
  const sameDay =
    sameYear &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (locale === "zh") {
    return sameYear
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function fullTime(at: number, locale: Locale): string {
  return new Date(at).toLocaleString(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(query, cursor);
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    const end = index + query.length;
    parts.push(
      <mark className="branch-hit" key={index}>
        {text.slice(index, end)}
      </mark>,
    );
    cursor = end;
    index = lower.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function laneClass(lane: AncestorLane): string {
  switch (lane.kind) {
    case "empty":
      return "tree-lane lane-empty";
    case "line":
      return `tree-lane lane-line tone-${lane.tone}`;
    case "tee":
      return `tree-lane lane-tee top-${lane.top} bottom-${lane.bottom} branch-${lane.branch}`;
    case "elbow":
      return `tree-lane lane-elbow top-${lane.top} branch-${lane.branch}`;
  }
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const lastConversation = useRef(view?.id);
  useEffect(() => {
    if (lastConversation.current !== view?.id) {
      lastConversation.current = view?.id;
      setFilter("");
      setExpanded(new Set());
    }
  }, [view?.id]);

  const tree = view?.tree;
  const layout = useMemo(
    () => buildTreeLayout(tree?.nodes ?? [], expanded),
    [tree, expanded],
  );
  const query = filter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      query
        ? layout.all.filter((node) => node.text.toLowerCase().includes(query))
        : [],
    [layout.all, query],
  );

  const hasMessages = layout.all.length > 0;
  const reading = !tree && !view?.error && (!view || view.loading);
  const empty = !reading && !view?.error && !hasMessages;

  // Keep the active path's end visible when opening the panel or switching paths.
  const currentEndRef = useRef<HTMLLIElement>(null);
  const activeLeafKey = `${view?.id ?? ""}:${tree?.leaf ?? ""}:${layout.currentEndId ?? ""}`;
  const scrolledKey = useRef("");
  useEffect(() => {
    if (!hasMessages || query || scrolledKey.current === activeLeafKey) return;
    scrolledKey.current = activeLeafKey;
    currentEndRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeLeafKey, hasMessages, query]);

  const use = (act: (node: ChatTreeNode) => void, node: ChatTreeNode) => {
    act(node);
    onChosen?.();
  };
  const toggleFold = (id: string) => {
    setExpanded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderActions = (node: ChatTreeNode) => (
    <div className="branch-actions">
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
    </div>
  );

  return (
    <section className="branches-panel" aria-label={t("Conversation tree")}>
      {(hasMessages || (!!view?.error && !tree)) && (
        <header className="panel-crumbs">
          {hasMessages ? (
            <label className="lp-filter">
              <FiSearch aria-hidden="true" />
              <input
                type="search"
                value={filter}
                placeholder={t("Filter messages…")}
                aria-label={t("Filter messages…")}
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
          ) : (
            <span className="tree-crumbs-spacer" />
          )}
          <button
            type="button"
            className="crumb"
            title={t("Refresh tree")}
            aria-label={t("Refresh tree")}
            disabled={!view}
            onClick={() => view?.onRefresh()}
          >
            <FiRefreshCw aria-hidden="true" />
          </button>
        </header>
      )}
      {view?.pinned && hasMessages && (
        <p className="branches-pinned">
          <ConversationTreeIcon className="branches-pinned-icon" />
          <span>{t("Viewing an earlier path, not the latest.")}</span>
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
      {tree?.truncated && hasMessages && (
        <p className="inspector-note">
          {t("Only the newest messages are listed.")}
        </p>
      )}
      {reading ? (
        <p className="panel-empty" role="status">
          {t("Reading…")}
        </p>
      ) : empty ? (
        <div className="tree-empty">
          <span className="tree-empty-icon" aria-hidden="true">
            <ConversationTreeIcon />
          </span>
          <p className="tree-empty-title">{t("No messages yet")}</p>
          <p className="tree-empty-hint">
            {t(
              "Messages appear here as a tree after you send one. Editing or continuing from an earlier message creates a new path, shared with /tree in Pi.",
            )}
          </p>
        </div>
      ) : hasMessages && query && filtered.length === 0 ? (
        <p className="panel-empty">{t("No matching messages")}</p>
      ) : null}
      {hasMessages && (
        <ol
          className={`branch-rows${
            query
              ? " is-filtered"
              : layout.hasForks
                ? " is-forked"
                : " is-linear"
          }`}
          aria-busy={view?.loading || undefined}
        >
          {query
            ? filtered.map((node) => {
                const isEnd = node.id === layout.currentEndId;
                return (
                  <li
                    key={node.id}
                    className={`branch-item${node.current ? " current" : " off-path"}${isEnd ? " current-end" : ""}`}
                  >
                    <span className="branch-lanes" aria-hidden="true">
                      <span className="tree-lane lane-node top-none bottom-none">
                        <span className="branch-dot" />
                      </span>
                    </span>
                    <div className="branch-main">
                      <button
                        type="button"
                        className="branch-row"
                        aria-current={node.current ? "true" : undefined}
                        title={node.text}
                        onClick={() => view && use(view.onShow, node)}
                      >
                        <span className="branch-text">
                          {node.text ? highlightMatch(node.text, query) : "…"}
                        </span>
                        {node.at > 0 && (
                          <span className="branch-meta">
                            <time
                              dateTime={new Date(node.at).toISOString()}
                              title={fullTime(node.at, locale)}
                            >
                              {compactTime(node.at, locale)}
                            </time>
                          </span>
                        )}
                      </button>
                    </div>
                    {renderActions(node)}
                  </li>
                );
              })
            : layout.rows.map((row) => {
                const { node } = row;
                const offPath = layout.hasForks && !node.current;
                return (
                  <li
                    key={node.id}
                    ref={row.currentEnd ? currentEndRef : undefined}
                    className={`branch-item${node.current ? " current" : ""}${
                      offPath ? " off-path" : ""
                    }${row.currentEnd ? " current-end" : ""}${
                      row.separateRoot ? " separate-root" : ""
                    }`}
                  >
                    <span className="branch-lanes" aria-hidden="true">
                      {row.lanes.map((lane, level) => (
                        <span
                          className={laneClass(lane)}
                          // biome-ignore lint/suspicious/noArrayIndexKey: ordered guide columns per depth level
                          key={level}
                        >
                          {(lane.kind === "tee" || lane.kind === "elbow") && (
                            <span className="tree-turn" />
                          )}
                        </span>
                      ))}
                      <span
                        className={`tree-lane lane-node top-${row.nodeTop} bottom-${row.nodeBottom}`}
                      >
                        <span className="branch-dot" />
                      </span>
                    </span>
                    <div className="branch-main">
                      <button
                        type="button"
                        className="branch-row"
                        aria-current={node.current ? "true" : undefined}
                        title={node.text}
                        onClick={() => view && use(view.onShow, node)}
                      >
                        <span className="branch-text">{node.text || "…"}</span>
                        {(node.at > 0 ||
                          (layout.hasForks && row.currentEnd)) && (
                          <span className="branch-meta">
                            {layout.hasForks && row.currentEnd && (
                              <span className="branch-here">
                                {t("Current")}
                              </span>
                            )}
                            {node.at > 0 && (
                              <time
                                dateTime={new Date(node.at).toISOString()}
                                title={fullTime(node.at, locale)}
                              >
                                {compactTime(node.at, locale)}
                              </time>
                            )}
                          </span>
                        )}
                      </button>
                      {row.collapsible && (
                        <button
                          type="button"
                          className="branch-fold"
                          aria-expanded={!row.collapsed}
                          aria-label={
                            row.collapsed
                              ? t("Expand {count} more messages", {
                                  count: row.hiddenCount,
                                })
                              : t("Collapse {count} messages", {
                                  count: row.hiddenCount,
                                })
                          }
                          onClick={() => toggleFold(node.id)}
                        >
                          {row.collapsed ? (
                            <FiChevronRight aria-hidden="true" />
                          ) : (
                            <FiChevronDown aria-hidden="true" />
                          )}
                          <span>
                            {row.collapsed
                              ? t("+{count} more", { count: row.hiddenCount })
                              : t("Hide {count}", { count: row.hiddenCount })}
                          </span>
                        </button>
                      )}
                    </div>
                    {renderActions(node)}
                  </li>
                );
              })}
        </ol>
      )}
    </section>
  );
}
