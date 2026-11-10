/** A session's user messages as a tree (one `conversation-tree` read) and what
 * the transcript derives from it: the rows of the Branches tab, the versions of
 * a message where the session forks, and the questions of the branch shown.
 * Everything here is readonly: choosing a row or a version only changes what
 * is read. */
import { useEffect, useMemo, useState } from "react";
import type { ChatTreeNode } from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { useWorkbench } from "./use-workbench";

export interface ConversationTree {
  /** The branch end the nodes' `current` marks were read for. */
  leaf: string | null;
  nodes: readonly ChatTreeNode[];
  /** Only the newest messages are listed. */
  truncated: boolean;
}

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

/** The versions of each message where the session forks: the user messages
 * that follow the same earlier one, oldest first. A message without a sibling
 * has no entry. The oldest messages of a clipped tree have lost the parent
 * that would tell them apart, so they are never listed as versions. */
export function messageVersions(
  tree: Pick<ConversationTree, "nodes" | "truncated">,
): Map<string, readonly ChatTreeNode[]> {
  const byParent = new Map<string | null, ChatTreeNode[]>();
  for (const node of tree.nodes) {
    if (node.parent === null && tree.truncated) continue;
    const siblings = byParent.get(node.parent);
    if (siblings) siblings.push(node);
    else byParent.set(node.parent, [node]);
  }
  const versions = new Map<string, readonly ChatTreeNode[]>();
  for (const siblings of byParent.values())
    if (siblings.length > 1)
      for (const node of siblings) versions.set(node.id, siblings);
  return versions;
}

/** The user messages of the branch shown, oldest first. */
export const branchQuestions = (
  nodes: readonly ChatTreeNode[],
): ChatTreeNode[] => nodes.filter((node) => node.current);

/** Where a message of the branch shown sits among its turns, so a turn not
 * loaded yet can be read. It is counted back from a shown turn the tree also
 * lists; when none is (only a live turn is shown), from the branch end, where
 * a live turn's own message is not on the listed branch yet. */
export function questionOrdinal(
  questions: readonly Pick<ChatTreeNode, "id">[],
  id: string,
  shown: readonly { ordinal: number; header: { id: string } }[],
  count: number,
  live: boolean,
): number | undefined {
  const at = questions.findIndex((question) => question.id === id);
  if (at < 0) return undefined;
  const place = new Map(
    questions.map((question, index) => [question.id, index]),
  );
  const known = shown.find((turn) => place.has(turn.header.id));
  const ordinal = known
    ? known.ordinal - ((place.get(known.header.id) as number) - at)
    : count - (live ? 1 : 0) - (questions.length - at);
  return ordinal >= 0 && ordinal < count ? ordinal : undefined;
}

/** One tree read for the branch shown, made again only when that branch gains
 * or changes a message: `shape` names what would change the tree (the branch's
 * newest turn and turn count, the session's leaf count, a reply settling). A
 * branch that only grows inside its last turn names a new leaf with every
 * entry of the reply, and keeps the tree it has. The previous tree also stays
 * while the next is read, so the rail, the version pagers and the Branches tab
 * never blink; `current` says the tree shown was read for the branch as it is. */
export function useConversationTree(
  client: Pick<ServiceClient, "workbenchRead">,
  id: string,
  leaf: string | null,
  shape: string,
  enabled: boolean,
): {
  tree: ConversationTree | undefined;
  current: boolean;
  error: string | undefined;
  loading: boolean;
  refresh(): void;
} {
  const [asked, setAsked] = useState<{ shape: string; leaf: string | null }>();
  useEffect(() => {
    if (enabled)
      setAsked((was) => (was?.shape === shape ? was : { shape, leaf }));
  }, [enabled, shape, leaf]);
  const read = useWorkbench(
    client,
    asked ? { kind: "conversation-tree", id, leaf: asked.leaf } : null,
  );
  const { value, refresh } = read;
  const fresh = useMemo<ConversationTree | undefined>(
    () =>
      asked && value?.kind === "conversation-tree"
        ? { leaf: asked.leaf, nodes: value.nodes, truncated: value.truncated }
        : undefined,
    [value, asked],
  );
  const [kept, setKept] = useState<ConversationTree>();
  useEffect(() => {
    if (fresh) setKept(fresh);
  }, [fresh]);
  return {
    tree: fresh ?? kept,
    current: !!fresh && asked?.shape === shape,
    error: read.error,
    loading: read.loading,
    refresh,
  };
}
