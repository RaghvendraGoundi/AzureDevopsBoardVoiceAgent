import type { WorkItem, WorkItemRef } from "./types";

/**
 * Results arranged as their hierarchy (Epic → Initiative/Feature → Story →
 * Task): matched items as full nodes, the items above them as context nodes.
 * Branches keep the order of the first result under them, so the tree reads
 * in the same order as the numbered list the assistant talks about.
 */

export type TreeNode =
  | { kind: "item"; id: number; item: WorkItem; position: number; children: TreeNode[] }
  | { kind: "context"; id: number; ref: WorkItemRef; children: TreeNode[] };

export function buildTree(items: WorkItem[], ancestors: WorkItemRef[] = []): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  const parentOf = new Map<number, number | null>();
  items.forEach((item, i) => {
    nodes.set(item.id, { kind: "item", id: item.id, item, position: i + 1, children: [] });
    parentOf.set(item.id, item.parentId);
  });
  for (const ref of ancestors) {
    if (nodes.has(ref.id)) continue;
    nodes.set(ref.id, { kind: "context", id: ref.id, ref, children: [] });
    parentOf.set(ref.id, ref.parentId ?? null);
  }

  // The first result under each node decides where it sorts.
  const firstPosition = new Map<number, number>();
  items.forEach((item, i) => {
    for (let id: number | null | undefined = item.id, guard = 0; id != null && guard < 10; id = parentOf.get(id), guard++) {
      if (!firstPosition.has(id)) firstPosition.set(id, i);
    }
  });
  const order = (a: TreeNode, b: TreeNode) => (firstPosition.get(a.id) ?? 1e9) - (firstPosition.get(b.id) ?? 1e9);

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = parentOf.get(node.id);
    const host = parent != null ? nodes.get(parent) : undefined;
    (host ? host.children : roots).push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort(order);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
