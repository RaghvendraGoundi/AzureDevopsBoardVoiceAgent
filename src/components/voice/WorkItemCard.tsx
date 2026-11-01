import type { StateCategory, WorkItem } from "@/lib/devops/types";
import { TypeIcon } from "./icons";

/** States that mean "stuck", shown in the attention colour whatever the process calls them. */
const HOLD = /hold|block|wait|paus|imped/i;

export function StateBadge({ state, category, big }: { state: string; category: StateCategory; big?: boolean }) {
  return (
    <span className={`state${HOLD.test(state) ? " hold" : ""}${big ? " big" : ""}`} data-cat={category}>
      <i aria-hidden />
      {state}
    </span>
  );
}

interface Props {
  item: WorkItem;
  position?: number;
  focused?: boolean;
  flash?: "created" | "updated";
}

export function WorkItemCard({ item, position, focused, flash }: Props) {
  return (
    <article className={`card animate-rise ${focused ? "focus" : ""} ${flash ? "animate-flash" : ""}`}>
      <div className="meta">
        {position !== undefined && <span className="text-fg/70">{position}.</span>}
        <span className="tg">
          <TypeIcon type={item.type} />
          {item.type}
        </span>
        <span>#{item.id}</span>
        <span className="ml-auto">
          <StateBadge state={item.state} category={item.stateCategory} />
        </span>
      </div>
      <h3 className="ttl">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>
      {item.parentId && (
        <p className="sub2 truncate" title={item.parentTitle ?? undefined}>
          ↳ #{item.parentId} {item.parentTitle}
        </p>
      )}
      <p className="sub2 mt-1">
        {item.sprintName ?? "Backlog"} · {item.assignedTo?.displayName ?? "Unassigned"}
        {item.priority !== null && ` · P${item.priority}`}
      </p>
      {flash && <p className="mt-2 text-xs font-semibold text-voice">{flash === "created" ? "✓ Created" : "✓ Updated"}</p>}
    </article>
  );
}
