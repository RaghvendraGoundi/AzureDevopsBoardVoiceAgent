"use client";

import type { WorkspaceState } from "@/hooks/voice/workspaceReducer";
import { ConfirmationCard } from "./ConfirmationCard";
import { StateBadge, WorkItemCard } from "./WorkItemCard";

interface Props {
  state: WorkspaceState;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
  onDismissError: (id: number) => void;
}

function Skeletons() {
  return (
    <div className="grid gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function DevOpsWorkspace({ state, onResolve, onDismissError }: Props) {
  const { results, pending, activity, errors, activeTool, focusedId, flash, boardInfo } = state;
  const loading = activeTool !== null && !pending;

  return (
    <div className="flex flex-col gap-5">
      {boardInfo && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="font-medium text-fg/80">{boardInfo.project}</span>
          {boardInfo.sprint ? (
            <span>
              {boardInfo.sprint.name}
              {boardInfo.sprint.daysLeft !== null && ` · ${boardInfo.sprint.daysLeft} days left`}
            </span>
          ) : (
            <span>No current sprint</span>
          )}
          <span>{boardInfo.user}</span>
          {boardInfo.provider === "emulated" && <span className="rounded bg-panel-2 px-1.5 py-0.5">emulated</span>}
        </p>
      )}
      {errors.map((e) => (
        <div
          key={e.id}
          role="alert"
          className="animate-rise flex items-start justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-red-200"
        >
          <span>{e.message}</span>
          <button onClick={() => onDismissError(e.id)} className="text-red-300/80 hover:text-red-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}

      {pending && <ConfirmationCard key={pending.actionId} action={pending} onResolve={onResolve} />}

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{results?.title ?? "Workspace"}</h2>
          {results && <span className="text-xs text-muted">{results.items.length} items</span>}
        </header>
        {loading && !results ? (
          <Skeletons />
        ) : results ? (
          results.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No matching work items.</p>
          ) : (
            <div className={`grid gap-3 transition-opacity xl:grid-cols-2 ${loading ? "opacity-50" : ""}`}>
              {results.items.map((item, i) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  position={i + 1}
                  focused={item.id === focusedId}
                  flash={flash[item.id]}
                />
              ))}
            </div>
          )
        ) : (
          <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
            Work items you ask about will appear here.
          </p>
        )}
      </section>

      {activity.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Session activity</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="animate-rise flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
                <span
                  className={
                    a.kind === "cancelled" ? "text-muted" : a.kind === "created" ? "text-listen" : "text-ok"
                  }
                >
                  {a.kind === "created" ? "Created" : a.kind === "updated" ? "Updated" : "Cancelled"}
                </span>
                <span className="text-fg/90">
                  {a.item.id ? `#${a.item.id} ` : ""}
                  {a.item.title}
                </span>
                {a.kind === "updated" && a.before && a.before.state !== a.item.state && (
                  <span className="flex items-center gap-1">
                    <StateBadge state={a.before.state} category={a.before.stateCategory} /> →{" "}
                    <StateBadge state={a.item.state} category={a.item.stateCategory} />
                  </span>
                )}
                {a.kind === "updated" && a.before && a.before.sprintName !== a.item.sprintName && (
                  <span className="text-xs text-muted">
                    {a.before.sprintName ?? "Backlog"} → {a.item.sprintName ?? "Backlog"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
