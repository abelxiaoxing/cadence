/* A session's user messages as Pi's /tree shows them: a linear run stays flat
 * and each fork indents its branches. Choosing one shows that branch; nothing
 * is moved, deleted or sent. */
import { useMemo } from "react";
import { FiX } from "react-icons/fi";
import type { ChatTreeNode } from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";

/** Depth-first rows; only a node with several children indents them. */
export function treeRows(
  nodes: readonly ChatTreeNode[],
): { node: ChatTreeNode; depth: number }[] {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, ChatTreeNode[]>();
  for (const node of nodes) {
    const parent =
      node.parent !== null && ids.has(node.parent) ? node.parent : null;
    const siblings = children.get(parent);
    if (siblings) siblings.push(node);
    else children.set(parent, [node]);
  }
  const rows: { node: ChatTreeNode; depth: number }[] = [];
  const stack: { node: ChatTreeNode; depth: number }[] = [];
  const push = (kids: ChatTreeNode[], depth: number) => {
    const fork = kids.length > 1;
    for (let i = kids.length - 1; i >= 0; i--)
      stack.push({ node: kids[i], depth: fork ? depth + 1 : depth });
  };
  push(children.get(null) ?? [], -1);
  while (stack.length) {
    const row = stack.pop() as { node: ChatTreeNode; depth: number };
    rows.push({ ...row, depth: Math.max(0, row.depth) });
    push(children.get(row.node.id) ?? [], Math.max(0, row.depth));
  }
  return rows;
}

export function BranchTree({
  client,
  id,
  leaf,
  onChoose,
  onClose,
}: {
  client: ServiceClient;
  id: string;
  leaf: string | null;
  onChoose(leaf: string): void;
  onClose(): void;
}) {
  const { t } = useT();
  const read = useWorkbench(client, { kind: "conversation-tree", id, leaf });
  const tree =
    read.value?.kind === "conversation-tree" ? read.value : undefined;
  const rows = useMemo(() => treeRows(tree?.nodes ?? []), [tree]);
  return (
    <section className="branch-tree" aria-label={t("Conversation branches")}>
      <header>
        <h3>{t("Conversation branches")}</h3>
        <button
          type="button"
          className="ghost"
          aria-label={t("Close")}
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </button>
      </header>
      <p className="panel-hint">
        {t(
          "Each line is a message; indented lines are branches. Choose one to read that branch. The terminal shares this tree (/tree in Pi).",
        )}
      </p>
      {read.error && <p role="alert">{describeError(t, read.error)}</p>}
      {!tree && !read.error && <p>{t("Reading…")}</p>}
      {tree?.truncated && (
        <p className="panel-hint">
          {t("Only the newest messages are listed.")}
        </p>
      )}
      <ol className="branch-rows">
        {rows.map(({ node, depth }) => (
          <li key={node.id} style={{ paddingInlineStart: `${depth * 16}px` }}>
            <button
              type="button"
              className={`branch-row${node.current ? " current" : ""}`}
              aria-current={node.current ? "true" : undefined}
              title={node.text}
              onClick={() => onChoose(node.leaf)}
            >
              <span className="branch-text">{node.text || "…"}</span>
              {node.at > 0 && (
                <time dateTime={new Date(node.at).toISOString()}>
                  {new Date(node.at).toLocaleString()}
                </time>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
