/* Adapted directly from pi-web-ui conv-groups.ts; MIT (c) 2026 xing-shuyin.
 * Presentation tree only; dependency readiness/outcomes remain shared-owner facts. */
export interface NavigationNode {
  id: string;
  parentId: string | null;
  label: string;
  active: boolean;
  failed: boolean;
  unknown: boolean;
}
export interface NavigationRow {
  c: NavigationNode;
  depth: number;
  hasKids: boolean;
  isCollapsed: boolean;
  descendantCount: number;
  hasActive: boolean;
  hasFailure: boolean;
  hasUnknown: boolean;
}

/**
 * 将同组内的对话按父子树展开成扁平渲染行列表（issue #564）。
 * 当父对话处于折叠状态时，其所有后代子代理从行列表中隐藏，并在父行上汇总后代计数与活跃状态。
 */
export function buildNavigationRows(
  convs: NavigationNode[],
  collapsedParentIds: Set<string> = new Set(),
): NavigationRow[] {
  const byId = new Map(convs.map((x) => [x.id, x]));
  const kids = new Map<string, NavigationNode[]>();
  const roots: NavigationNode[] = [];

  for (const x of convs) {
    if (x.parentId && byId.has(x.parentId)) {
      const arr = kids.get(x.parentId) ?? [];
      arr.push(x);
      kids.set(x.parentId, arr);
    } else {
      roots.push(x);
    }
  }

  const getDescendants = (id: string): NavigationNode[] => {
    const res: NavigationNode[] = [];
    const queue = [...(kids.get(id) ?? [])];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      res.push(item);
      const sub = kids.get(item.id);
      if (sub) queue.push(...sub);
    }
    return res;
  };

  const rows: NavigationRow[] = [];
  const seen = new Set<string>();
  const hidden = new Set<string>();

  const append = (c: NavigationNode, depth: number) => {
    if (seen.has(c.id) || hidden.has(c.id)) return;
    seen.add(c.id);

    const myKids = kids.get(c.id) ?? [];
    const hasKids = myKids.length > 0;
    const isCollapsed = hasKids && collapsedParentIds.has(c.id);

    let descendantCount = 0;
    let hasActive = false;
    let hasFailure = false;
    let hasUnknown = false;

    if (hasKids) {
      const descendants = getDescendants(c.id);
      descendantCount = descendants.length;
      hasActive = descendants.some((d) => d.active);
      hasFailure = descendants.some((d) => d.failed);
      hasUnknown = descendants.some((d) => d.unknown);

      if (isCollapsed) {
        for (const d of descendants) {
          hidden.add(d.id);
        }
      }
    }

    rows.push({
      c,
      depth,
      hasKids,
      isCollapsed,
      descendantCount,
      hasActive,
      hasFailure,
      hasUnknown,
    });

    if (!isCollapsed) {
      for (const child of myKids) append(child, depth + 1);
    }
  };

  for (const root of roots) append(root, 0);
  for (const orphan of convs) append(orphan, 0);

  return rows;
}
