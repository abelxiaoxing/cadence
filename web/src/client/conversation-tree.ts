/** A session's user messages as a tree (one `conversation-tree` read) and what
 * the transcript derives from it: the rows of the Tree tab, the versions of
 * a message where the session forks, and the questions of the path shown.
 * Everything here is readonly: choosing a row or a version only changes what
 * is read. */
import { useEffect, useMemo, useState } from "react";
import type { ChatTreeNode } from "../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../src/service-client.ts";
import { useWorkbench } from "./use-workbench";

export interface ConversationTree {
  /** The path end the nodes' `current` marks were read for. */
  leaf: string | null;
  nodes: readonly ChatTreeNode[];
  /** Only the newest messages are listed. */
  truncated: boolean;
}

export type RailTone = "none" | "muted" | "current";

export type AncestorLane =
  | { kind: "empty" }
  | { kind: "line"; tone: "muted" | "current" }
  | {
      kind: "tee";
      top: "muted" | "current";
      bottom: "muted" | "current";
      branch: "muted" | "current";
    }
  | {
      kind: "elbow";
      top: "muted" | "current";
      branch: "muted" | "current";
    };

/** One rendered row of the conversation tree, with exact rail geometry and
 * off-path subtree folding state. */
export interface TreeRow {
  node: ChatTreeNode;
  depth: number;
  /** Leading guide columns (0..depth-1) before this node's own column. */
  lanes: readonly AncestorLane[];
  /** Vertical connector above this node's dot in its own column. */
  nodeTop: RailTone;
  /** Vertical connector below this node's dot in its own column. */
  nodeBottom: RailTone;
  /** Starts a separate root path after an earlier root. */
  separateRoot: boolean;
  /** True for the final node on the currently viewed path. */
  currentEnd: boolean;
  /** Off-path fork with at least two descendants: folded by default (2A). */
  collapsible: boolean;
  collapsed: boolean;
  /** Number of descendant messages inside this collapsible off-path fork. */
  hiddenCount: number;
}

/** Off-path forks with at least this many descendants start folded. */
export const FOLD_DESCENDANTS_MIN = 2;

export interface TreeLayout {
  rows: readonly TreeRow[];
  /** All nodes in tree order without folding, used for full-tree filtering. */
  all: readonly ChatTreeNode[];
  hasForks: boolean;
  currentEndId: string | undefined;
}

/** Build the tree topology, exact current-path rails, and folded off-path
 * subtrees while preserving recorded (oldest-first) order as Pi's `/tree` does.
 * `expanded` toggles collapsible off-path forks open. */
export function buildTreeLayout(
  nodes: readonly ChatTreeNode[],
  expanded: ReadonlySet<string> = new Set(),
): TreeLayout {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, ChatTreeNode[]>();
  for (const node of nodes) {
    const parent =
      node.parent !== null && ids.has(node.parent) ? node.parent : null;
    const siblings = children.get(parent);
    if (siblings) siblings.push(node);
    else children.set(parent, [node]);
  }
  const hasForks = [...children.values()].some((kids) => kids.length > 1);

  // Iterative bottom-up descendant counts (safe for deep trees and cycles).
  const descendants = new Map<string, number>();
  const countVisited = new Set<string>();
  const countStack: { id: string; expanded: boolean }[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const id = nodes[i].id;
    if (!countVisited.has(id)) countStack.push({ id, expanded: false });
  }
  while (countStack.length > 0) {
    const item = countStack.pop() as { id: string; expanded: boolean };
    if (item.expanded) {
      let total = 0;
      for (const child of children.get(item.id) ?? []) {
        const sub = descendants.get(child.id);
        if (sub !== undefined) total += 1 + sub;
      }
      descendants.set(item.id, total);
      continue;
    }
    if (countVisited.has(item.id)) continue;
    countVisited.add(item.id);
    countStack.push({ id: item.id, expanded: true });
    const kids = children.get(item.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (!countVisited.has(kids[i].id))
        countStack.push({ id: kids[i].id, expanded: false });
    }
  }

  // Iterative full DFS order to locate the terminal node of the active path and feed search.
  const all: ChatTreeNode[] = [];
  const allVisited = new Set<string>();
  const roots = children.get(null) ?? [];
  const allStack: ChatTreeNode[] = [];
  for (let i = roots.length - 1; i >= 0; i--) allStack.push(roots[i]);
  while (allStack.length > 0) {
    const node = allStack.pop() as ChatTreeNode;
    if (allVisited.has(node.id)) continue;
    allVisited.add(node.id);
    all.push(node);
    const kids = children.get(node.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) allStack.push(kids[i]);
  }
  let currentEndId: string | undefined;
  for (const node of all) if (node.current) currentEndId = node.id;

  // Iterative walk with active ancestor guides to emit exact connector geometry.
  const rows: TreeRow[] = [];
  type Guide = { kind: "empty" } | { kind: "line"; tone: "muted" | "current" };
  type GroupFrame = {
    parent: ChatTreeNode | null;
    kids: readonly ChatTreeNode[];
    parentDepth: number;
    guides: readonly Guide[];
    index: number;
  };
  const rowVisited = new Set<string>();
  const groupStack: GroupFrame[] = roots.length
    ? [{ parent: null, kids: roots, parentDepth: 0, guides: [], index: 0 }]
    : [];

  while (groupStack.length > 0) {
    const frame = groupStack[groupStack.length - 1];
    if (frame.index >= frame.kids.length) {
      groupStack.pop();
      continue;
    }
    const i = frame.index++;
    const { parent, kids, parentDepth, guides } = frame;
    const node = kids[i];
    if (rowVisited.has(node.id)) continue;
    rowVisited.add(node.id);

    const isRoot = parent === null;
    const fork = kids.length > 1;
    const depth = isRoot ? 0 : fork ? parentDepth + 1 : parentDepth;

    const hasLaterSibling = i < kids.length - 1;
    const hasLaterCurrent =
      hasLaterSibling && kids.slice(i + 1).some((sibling) => sibling.current);
    const laterTone: "muted" | "current" = hasLaterCurrent
      ? "current"
      : "muted";
    const nodeTone: "muted" | "current" = node.current ? "current" : "muted";

    const lanes: AncestorLane[] = [...guides];
    let nextGuides: Guide[] = [...guides];
    if (!isRoot && fork) {
      const topTone: "muted" | "current" =
        parent.current && (node.current || hasLaterCurrent)
          ? "current"
          : "muted";
      lanes.push(
        hasLaterSibling
          ? {
              kind: "tee",
              top: topTone,
              bottom: laterTone,
              branch: nodeTone,
            }
          : { kind: "elbow", top: topTone, branch: nodeTone },
      );
      nextGuides = [
        ...guides,
        hasLaterSibling ? { kind: "line", tone: laterTone } : { kind: "empty" },
      ];
    }

    const hiddenCount = descendants.get(node.id) ?? 0;
    const collapsible =
      !node.current && fork && hiddenCount >= FOLD_DESCENDANTS_MIN;
    const collapsed = collapsible && !expanded.has(node.id);
    const nodeKids = (children.get(node.id) ?? []).filter(
      (child) => !rowVisited.has(child.id),
    );

    const nodeTop: RailTone =
      isRoot || fork
        ? "none"
        : parent.current && node.current
          ? "current"
          : "muted";
    const nodeBottom: RailTone =
      collapsed || nodeKids.length === 0
        ? "none"
        : node.current && nodeKids.some((child) => child.current)
          ? "current"
          : "muted";

    rows.push({
      node,
      depth,
      lanes,
      nodeTop,
      nodeBottom,
      separateRoot: isRoot && i > 0,
      currentEnd: node.id === currentEndId,
      collapsible,
      collapsed,
      hiddenCount,
    });

    if (!collapsed && nodeKids.length > 0) {
      groupStack.push({
        parent: node,
        kids: nodeKids,
        parentDepth: depth,
        guides: nextGuides,
        index: 0,
      });
    }
  }

  return { rows, all, hasForks, currentEndId };
}

/** Depth-first rows; only a node with several children indents them. */
export function treeRows(
  nodes: readonly ChatTreeNode[],
): { node: ChatTreeNode; depth: number }[] {
  const expanded = new Set(nodes.map((node) => node.id));
  return buildTreeLayout(nodes, expanded).rows.map(({ node, depth }) => ({
    node,
    depth,
  }));
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

/** The user messages of the path shown, oldest first. */
export const branchQuestions = (
  nodes: readonly ChatTreeNode[],
): ChatTreeNode[] => nodes.filter((node) => node.current);

/** Where a message of the path shown sits among its turns, so a turn not
 * loaded yet can be read. It is counted back from a shown turn the tree also
 * lists; when none is (only a live turn is shown), from the path end, where
 * a live turn's own message is not on the listed path yet. */
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

/** One tree read for the path shown, made again only when that path gains
 * or changes a message: `shape` names what would change the tree (the path's
 * newest turn and turn count, the session's leaf count, a reply settling). A
 * path that only grows inside its last turn names a new leaf with every
 * entry of the reply, and keeps the tree it has. The previous tree also stays
 * while the next is read, so the rail, the version pagers and the Tree tab
 * never blink; `current` says the tree shown was read for the path as it is. */
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
  const tree = fresh ?? kept;
  return {
    tree,
    current: !!fresh && asked?.shape === shape,
    error: read.error,
    loading: read.loading || (enabled && !tree && !read.error),
    refresh,
  };
}
