import { describe, expect, it } from "vitest";
import { buildTree, type TreeNode } from "./tree";
import type { WorkItem } from "./types";

const item = (id: number, parentId: number | null, title = `Item ${id}`) => ({ id, parentId, title, type: "Task" }) as WorkItem;
const shape = (nodes: TreeNode[]): unknown => nodes.map((n) => [n.kind === "item" ? n.id : `ctx ${n.id}`, ...(n.children.length ? [shape(n.children)] : [])]);

describe("buildTree", () => {
  it("puts results under their stories, initiatives and epics", () => {
    const items = [item(30, 20), item(31, 20), item(40, 21)];
    const ancestors = [
      { id: 20, title: "Story A", type: "User Story", state: "Active", parentId: 10 },
      { id: 21, title: "Story B", type: "User Story", state: "New", parentId: 10 },
      { id: 10, title: "Initiative", type: "Initiative", state: "Active", parentId: 1 },
      { id: 1, title: "Epic", type: "Epic", state: "Active", parentId: null },
    ];
    expect(shape(buildTree(items, ancestors))).toEqual([["ctx 1", [["ctx 10", [["ctx 20", [[30], [31]]], ["ctx 21", [[40]]]]]]]]);
  });

  it("nests results under other results, and keeps the list order", () => {
    const items = [item(2, null), item(5, 9), item(3, 2)];
    const tree = buildTree(items, []);
    expect(shape(tree)).toEqual([[2, [[3]]], [5]]);
    expect(tree[0].kind === "item" && tree[0].position).toBe(1);
  });
});
