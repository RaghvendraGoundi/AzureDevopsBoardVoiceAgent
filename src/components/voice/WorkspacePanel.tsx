"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceState } from "@/hooks/voice/workspaceReducer";
import { ActivityStrip } from "./ActivityStrip";
import { ConfirmationCard } from "./ConfirmationCard";
import { BoardIcon, CloseIcon, CollapseRightIcon } from "./icons";
import { StateBadge, WorkItemCard } from "./WorkItemCard";
import { WorkItemDetailView } from "./WorkItemDetailView";
import { WorkItemTree } from "./WorkItemTree";
import { buildTree } from "@/lib/devops/tree";

interface Props {
  state: WorkspaceState;
  /** "panel": desktop side panel; "sheet": phone bottom sheet. */
  variant: "panel" | "sheet";
  /** The assistant is working on the board: show the live signal line. */
  busy?: boolean;
  onClose: () => void;
  onResolve: (actionId: string, decision: "confirm" | "cancel") => Promise<void>;
  onDismissError: (id: number) => void;
  /** "Stop waiting" for a slow board call. */
  onStopWaiting?: () => void;
  /** Opening items and proposing comment or description changes from the screen. */
  board: {
    open: (id: number) => Promise<boolean>;
    closeDetail: () => void;
    proposeComment: (id: number, text: string) => Promise<boolean>;
    proposeDescription: (id: number, text: string) => Promise<boolean>;
    proposeDeleteComment: (id: number, commentId: number) => Promise<boolean>;
  };
}

type Tab = "results" | "changes";

/** What the assistant found and changed: results, the change waiting for a yes, and session activity. */
export function WorkspacePanel({ state, variant, busy, onClose, onResolve, onDismissError, board, onStopWaiting }: Props) {
  const { results, pending, activity, errors, activeTool, focusedId, flash, boardInfo, detail } = state;
  const [tab, setTab] = useState<Tab>("results");
  const loading = activeTool !== null && !pending;
  const changes = activity.filter((a) => a.kind !== "cancelled").length;
  const scroller = useRef<HTMLDivElement>(null);
  // Tree (grouped under epics and initiatives) or a flat list; remembered per browser.
  const [view, setView] = useState<"tree" | "list">("tree");
  useEffect(() => {
    try {
      if (localStorage.getItem("workspace-view") === "list") setView("list");
    } catch {
      // Storage may be unavailable.
    }
  }, []);
  const chooseView = (v: "tree" | "list") => {
    setView(v);
    try {
      localStorage.setItem("workspace-view", v);
    } catch {
      // Storage may be unavailable; the choice just won't persist.
    }
  };
  const hasTree = !!results && results.items.some((i) => i.parentId !== null);
  // Items opened from inside an item (a parent, a child), so "back" returns to where you were.
  const [trail, setTrail] = useState<Array<{ id: number; title: string }>>([]);
  useEffect(() => {
    if (!detail) setTrail([]);
  }, [detail]);
  const openFromDetail = (id: number) => {
    if (detail && id !== detail.id) setTrail((t) => [...t, { id: detail.id, title: detail.title }]);
    void board.open(id);
  };
  const back = () => {
    const prev = trail.at(-1);
    if (prev) {
      setTrail((t) => t.slice(0, -1));
      void board.open(prev.id);
    } else board.closeDetail();
  };
  const backLabel = trail.length
    ? `Back to #${trail.at(-1)!.id}`
    : results
      ? `Back to ${results.items.length} ${results.items.length === 1 ? "item" : "items"}`
      : null;

  // An item picked elsewhere (e.g. from a chat reply) scrolls into view.
  useEffect(() => {
    if (focusedId === null) return;
    setTab("results");
    requestAnimationFrame(() =>
      document.querySelector(`[data-item="${focusedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }, [focusedId]);

  // A change waiting for a yes always brings Results to the front, scrolled to it.
  useEffect(() => {
    if (!pending) return;
    setTab("results");
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }, [pending]);

  // A newly opened item starts at its top.
  useEffect(() => {
    if (detail) scroller.current?.scrollTo({ top: 0 });
  }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <a className="ibtn" href="/board" aria-label="Open the sprint board" title="Sprint board">
          <BoardIcon size={18} />
        </a>
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

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4 pb-5" role="tabpanel" aria-labelledby="workspace-title">
        <ActivityStrip steps={state.steps} variant="panel" onStop={onStopWaiting} />
        {errors.map((e) => (
          <div key={e.id} role="alert" className="card animate-rise flex items-start justify-between gap-3 border-danger/40! text-sm">
            <span className="text-[#ffb3bb]">{e.message}</span>
            <button onClick={() => onDismissError(e.id)} className="ibtn size-7!" aria-label="Dismiss">
              <CloseIcon size={14} />
            </button>
          </div>
        ))}

        {tab === "results" && detail ? (
          <>
            {pending && <ConfirmationCard key={pending.actionId} action={pending} onResolve={onResolve} />}
            <WorkItemDetailView
              key={detail.id}
              detail={detail}
              backLabel={backLabel}
              onBack={back}
              onOpen={openFromDetail}
              onProposeComment={board.proposeComment}
              onProposeDescription={board.proposeDescription}
              onProposeDeleteComment={board.proposeDeleteComment}
            />
          </>
        ) : tab === "results" ? (
          <>
            {pending && <ConfirmationCard key={pending.actionId} action={pending} onResolve={onResolve} />}
            {results && (
              <div className="mt-1 flex items-center justify-between gap-3">
                <h4 className="min-w-0 truncate text-[15px] font-semibold">{results.title}</h4>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="sub2">{results.items.length} items</span>
                  {hasTree && (
                    <div className="viewseg" role="radiogroup" aria-label="Show as">
                      {(["tree", "list"] as const).map((v) => (
                        <button key={v} role="radio" aria-checked={view === v} onClick={() => chooseView(v)}>
                          {v === "tree" ? "Tree" : "List"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {loading && !results ? (
              [0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-[18px]" aria-hidden />)
            ) : results ? (
              results.items.length === 0 ? (
                <p className="card sub2 text-center">No matching work items.</p>
              ) : (
                <div className={`flex flex-col gap-3 transition-opacity ${loading ? "opacity-50" : ""}`}>
                  {hasTree && view === "tree" ? (
                    <WorkItemTree
                      nodes={buildTree(results.items, results.ancestors)}
                      focusedId={focusedId}
                      flash={flash}
                      currentSprint={sprint?.name ?? null}
                      onOpen={(id) => void board.open(id)}
                    />
                  ) : (
                  results.items.map((item, i) => (
                    <WorkItemCard key={item.id} item={item} position={i + 1} focused={item.id === focusedId} flash={flash[item.id]} currentSprint={sprint?.name ?? null} onOpen={(id) => void board.open(id)} />
                  ))
                  )}
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
