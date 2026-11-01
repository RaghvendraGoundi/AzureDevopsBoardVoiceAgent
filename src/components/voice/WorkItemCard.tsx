import type { StateCategory, WorkItem } from "@/lib/devops/types";
import { FlagIcon, ParentIcon, TypeIcon } from "./icons";

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
  /** The current sprint's name: other sprints are called out on the card. */
  currentSprint?: string | null;
  /** Opens an item (this one, or its parent) in full. */
  onOpen?: (id: number) => void;
}

export const typeTone = (type: string) => {
  const t = type.toLowerCase();
  if (t === "bug" || t === "impediment" || t === "issue") return "bug";
  if (t === "task") return "task";
  if (t === "epic" || t === "feature" || t === "initiative") return "port";
  return "story";
};

export function WorkItemCard({ item, position, focused, flash, currentSprint, onOpen }: Props) {
  const who = item.assignedTo?.displayName ?? null;
  const offSprint = item.sprintName !== (currentSprint ?? null) ? (item.sprintName ?? "Backlog") : null;
  return (
    <article
      className={`card wcard ${flash === "created" ? "materialize" : flash === "updated" ? "card-updated" : "animate-rise"} ${focused ? "focus" : ""}`}
      aria-label={position !== undefined ? `Item ${position}` : undefined}
      data-item={item.id}
    >
      <div className="crow">
        <span className={`ty ${typeTone(item.type)}`}>
          <i aria-hidden>
            <TypeIcon type={item.type} size={16} />
          </i>
          {item.type}
          <span className="id">#{item.id}</span>
        </span>
        {/* Keyed by state so a status change re-runs the pop-in. */}
        <span key={item.state} className={flash === "updated" ? "pill-in" : ""}>
          <StateBadge state={item.state} category={item.stateCategory} />
        </span>
      </div>
      <h3 className="ct">
        {onOpen ? (
          <button className="titlebtn" onClick={() => onOpen(item.id)}>
            {item.title}
          </button>
        ) : (
          item.title
        )}
      </h3>
      {item.parentId &&
        (onOpen ? (
          <button className="par parbtn" onClick={() => onOpen(item.parentId!)} title={`Open #${item.parentId} ${item.parentTitle ?? ""}`}>
            <ParentIcon />
            <span className="truncate">
              #{item.parentId} {item.parentTitle}
            </span>
          </button>
        ) : (
          <p className="par" title={item.parentTitle ?? undefined}>
            <ParentIcon />
            <span className="truncate">
              #{item.parentId} {item.parentTitle}
            </span>
          </p>
        ))}
      <div className="wmeta">
        <span className="who2">
          <span className="ava" aria-hidden>
            {who ? who.trim()[0]?.toUpperCase() : "?"}
          </span>
          {who ? who.split(" ")[0] : "Unassigned"}
          {offSprint && <span className="text-muted">· {offSprint}</span>}
        </span>
        {item.priority !== null && (
          <span className={`prio ${item.priority === 1 ? "hi" : ""}`}>
            <FlagIcon />P{item.priority}
          </span>
        )}
      </div>
      {flash && (
        <p className="mono text-[11px] font-semibold tracking-[0.08em] text-voice animate-rise">
          {flash === "created" ? "✓ CREATED" : "✓ UPDATED"}
        </p>
      )}
    </article>
  );
}
