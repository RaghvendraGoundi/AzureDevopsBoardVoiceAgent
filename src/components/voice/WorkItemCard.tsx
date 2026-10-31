import type { StateCategory, WorkItem } from "@/lib/devops/types";

/** Badge colour by state category, so any process (Agile, Scrum, Basic, custom) looks right. */
export const CATEGORY_STYLE: Record<StateCategory, string> = {
  Proposed: "bg-slate-500/20 text-slate-300",
  InProgress: "bg-accent/20 text-blue-300",
  Resolved: "bg-think/20 text-violet-300",
  Completed: "bg-ok/20 text-emerald-300",
  Removed: "bg-danger/15 text-red-300",
};

/** Left border by kind of item. */
function typeStyle(type: string) {
  const t = type.toLowerCase();
  if (t === "bug" || t === "impediment") return "border-l-danger";
  if (t === "epic" || t === "feature") return "border-l-think";
  if (t === "task") return "border-l-warn";
  return "border-l-listen";
}

export function StateBadge({ state, category }: { state: string; category: StateCategory }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${CATEGORY_STYLE[category]}`}>{state}</span>;
}

interface Props {
  item: WorkItem;
  position?: number;
  focused?: boolean;
  flash?: "created" | "updated";
}

export function WorkItemCard({ item, position, focused, flash }: Props) {
  return (
    <article
      className={`animate-rise rounded-xl border border-l-4 bg-panel p-4 transition-colors ${typeStyle(item.type)} ${
        focused ? "border-accent ring-1 ring-accent/50" : "border-line"
      } ${flash ? "animate-flash" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {position !== undefined && <span className="mr-2 font-semibold text-fg/70">{position}.</span>}
            {item.type} · #{item.id}
          </p>
          <h3 className="mt-1 leading-snug font-semibold text-fg">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          {item.parentId && (
            <p className="mt-1 truncate text-xs text-muted" title={item.parentTitle ?? undefined}>
              ↳ #{item.parentId} {item.parentTitle}
            </p>
          )}
        </div>
        <StateBadge state={item.state} category={item.stateCategory} />
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <div>
          <dt className="inline">Sprint </dt>
          <dd className="inline font-medium text-fg/80">{item.sprintName ?? "Backlog"}</dd>
        </div>
        {item.priority !== null && (
          <div>
            <dt className="inline">Priority </dt>
            <dd className="inline font-medium text-fg/80">{item.priority}</dd>
          </div>
        )}
        <div>
          <dt className="inline">Assigned </dt>
          <dd className="inline font-medium text-fg/80">{item.assignedTo?.displayName ?? "Unassigned"}</dd>
        </div>
      </dl>
      {flash && <p className="mt-2 text-xs font-semibold text-ok">{flash === "created" ? "✓ Created" : "✓ Updated"}</p>}
    </article>
  );
}
