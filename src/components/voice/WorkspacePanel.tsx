"use client";

import { useEffect, useState } from "react";
import type { WorkspaceState } from "@/hooks/voice/workspaceReducer";
import { ConfirmationCard } from "./ConfirmationCard";
import { CloseIcon, CollapseRightIcon } from "./icons";
import { StateBadge, WorkItemCard } from "./WorkItemCard";

interface Props {
  state: WorkspaceState;
  /** "panel": desktop side panel; "sheet": phone bottom sheet. */
  variant: "panel" | "sheet";
  /** The assistant is working on the board: show the live signal line. */
  busy?: boolean;
  onClose: () => void;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
  onDismissError: (id: number) => void;
}

type Tab = "results" | "changes";

/** What the assistant found and changed: results, the change waiting for a yes, and session activity. */
export function WorkspacePanel({ state, variant, busy, onClose, onResolve, onDismissError }: Props) {
  const { results, pending, activity, errors, activeTool, focusedId, flash, boardInfo } = state;
  const [tab, setTab] = useState<Tab>("results");
  const loading = activeTool !== null && !pending;
  const changes = activity.filter((a) => a.kind !== "cancelled").length;

  // An item picked elsewhere (e.g. from a chat reply) scrolls into view.
  useEffect(() => {
    if (focusedId === null) return;
    setTab("results");
    requestAnimationFrame(() =>
      document.querySelector(`[data-item="${focusedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }, [focusedId]);

  // A change waiting for a yes always brings Results to the front.
  useEffect(() => {
    if (pending) setTab("results");
  }, [pending]);

  const sprint = boardInfo?.sprint;
  const subtitle = [sprint?.name, boardInfo?.project].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="phd">
        <div className="min-w-0 flex-1">
          <h3 id="workspace-title">Workspace</h3>
          <div className="sm truncate">
            {subtitle || "Your board"}
            {sprint?.daysLeft != null && ` · ${sprint.daysLeft} days left`}
          </div>
        </div>
        <button className="ibtn" onClick={onClose} aria-label="Close workspace">
          {variant === "sheet" ? <CloseIcon size={18} /> : <CollapseRightIcon size={18} />}
        </button>
      </div>

      {busy && <div className="live-line" aria-hidden />}
      <div className="tabs" role="tablist" aria-label="Workspace">
        <button role="tab" aria-selected={tab === "results"} onClick={() => setTab("results")}>
          Results<span className="ct">{results?.items.length ?? 0}</span>
        </button>
        <button role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>
          Changes<span className="ct">{changes}</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-5" role="tabpanel" aria-labelledby="workspace-title">
        {errors.map((e) => (
          <div key={e.id} role="alert" className="card animate-rise flex items-start justify-between gap-3 border-danger/40! text-sm">
            <span className="text-[#ffb3bb]">{e.message}</span>
            <button onClick={() => onDismissError(e.id)} className="ibtn size-7!" aria-label="Dismiss">
              <CloseIcon size={14} />
            </button>
          </div>
        ))}

        {tab === "results" ? (
          <>
            {pending && <ConfirmationCard key={pending.actionId} action={pending} onResolve={onResolve} />}
            {results && (
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <h4 className="text-[15px] font-semibold">{results.title}</h4>
                <span className="sub2 shrink-0">{results.items.length} items</span>
              </div>
            )}
            {loading && !results ? (
              [0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-[18px]" aria-hidden />)
            ) : results ? (
              results.items.length === 0 ? (
                <p className="card sub2 text-center">No matching work items.</p>
              ) : (
                <div className={`flex flex-col gap-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
                  {results.items.map((item, i) => (
                    <WorkItemCard key={item.id} item={item} position={i + 1} focused={item.id === focusedId} flash={flash[item.id]} currentSprint={sprint?.name ?? null} />
                  ))}
                  {results.items.length > 3 && <div className="listfade" aria-hidden />}
                </div>
              )
            ) : (
              !pending && <p className="sub2 px-1 py-6 text-center">Ask about your work and the results show up here.</p>
            )}
          </>
        ) : activity.length === 0 ? (
          <p className="sub2 px-1 py-6 text-center">Changes you confirm in this conversation show up here.</p>
        ) : (
          <ol className="timeline">
            {activity.map((a) => (
              <li key={a.id} className="card animate-rise py-3!">
                <span className={`tl-node ${a.kind}`} aria-hidden />
                <div className="meta">
                  <span className={a.kind === "cancelled" ? "text-muted" : a.kind === "created" ? "text-voice" : "text-[#ff7a33]"}>
                    {a.kind === "created" ? "CREATED" : a.kind === "updated" ? "UPDATED" : "CANCELLED"}
                  </span>
                  {a.item.id ? <span>#{a.item.id}</span> : null}
                  <span className="ml-auto">{new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </div>
                <p className="ttl text-[15px]!">{a.item.title}</p>
                {a.kind === "updated" && a.before && a.before.state !== a.item.state && (
                  <p className="mt-1.5 flex items-center gap-2">
                    <StateBadge state={a.before.state} category={a.before.stateCategory} />
                    <span className="flowline sm" aria-label="to" />
                    <StateBadge state={a.item.state} category={a.item.stateCategory} />
                  </p>
                )}
                {a.kind === "updated" && a.before && a.before.sprintName !== a.item.sprintName && (
                  <p className="sub2 mt-1">
                    {a.before.sprintName ?? "Backlog"} → {a.item.sprintName ?? "Backlog"}
                  </p>
                )}
                {a.kind === "created" && (
                  <p className="sub2 mt-0.5">
                    {a.item.type} · {a.item.sprintName ?? "Backlog"}
                    {a.item.parentId ? ` · under #${a.item.parentId}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
