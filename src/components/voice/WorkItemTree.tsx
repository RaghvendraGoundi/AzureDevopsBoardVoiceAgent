"use client";

import { useState } from "react";
import type { TreeNode } from "@/lib/devops/tree";
import { ChevronDownIcon, ChevronRightIcon, TypeIcon } from "./icons";
import { StateBadge, typeTone, WorkItemCard } from "./WorkItemCard";
import type { StateCategory } from "@/lib/devops/types";

interface Props {
  nodes: TreeNode[];
  focusedId: number | null;
  flash: Record<number, "created" | "updated">;
  currentSprint: string | null;
  onOpen: (id: number) => void;
}

/** Context rows only know the state's name; close enough for the badge's dot. */
const guessCategory = (state: string): StateCategory =>
  /done|closed|complete|resolved|removed/i.test(state) ? "Completed" : /^(new|proposed|to do|approved)$/i.test(state) ? "Proposed" : "InProgress";

/** Results as their hierarchy: epics and initiatives as compact context rows, matched items as cards. */
export function WorkItemTree(p: Props) {
  return (
    <ul className="wtree" role="tree" aria-label="Work items by hierarchy">
      {p.nodes.map((n) => (
        <Node key={n.id} node={n} depth={0} {...p} />
      ))}
    </ul>
  );
}

function Node({ node, depth, ...p }: Props & { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const kids = node.children.length > 0;

  return (
    <li role="treeitem" aria-expanded={kids ? open : undefined} aria-level={depth + 1} className="wnode">
      {node.kind === "context" ? (
        <div className="wctx">
          {kids ? (
            <button className="wtoggle" onClick={() => setOpen((o) => !o)} aria-label={open ? `Collapse ${node.ref.title}` : `Expand ${node.ref.title}`}>
              {open ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
            </button>
          ) : (
            <span className="wtoggle" aria-hidden />
          )}
          <button className="wctx-row" onClick={() => p.onOpen(node.id)} title={`Open ${node.ref.type} #${node.id}`}>
            <span className={`ty-dot ${typeTone(node.ref.type)}`} aria-hidden>
              <TypeIcon type={node.ref.type} size={13} />
            </span>
            <span className="wctx-type">{node.ref.type}</span>
            <span className="min-w-0 flex-1 truncate">{node.ref.title}</span>
            <StateBadge state={node.ref.state} category={guessCategory(node.ref.state)} />
          </button>
        </div>
      ) : (
        <WorkItemCard
          item={node.item}
          position={node.position}
          focused={node.id === p.focusedId}
          flash={p.flash[node.id]}
          currentSprint={p.currentSprint}
          onOpen={p.onOpen}
        />
      )}
      {kids && open && (
        <ul role="group" className="wkids">
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} {...p} />
          ))}
        </ul>
      )}
    </li>
  );
}
