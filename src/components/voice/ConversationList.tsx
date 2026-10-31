"use client";

import { useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/types";

interface Props {
  conversations: ConversationSummary[];
  currentId: string | null;
  loadingId: string | null;
  /** A call is live: switching would cut it off, so the list is read-only. */
  locked: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function relativeTime(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConversationList({ conversations, currentId, loadingId, locked, onNew, onOpen, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <button
          onClick={onNew}
          disabled={locked}
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-panel-2 disabled:opacity-40"
        >
          + New
        </button>
      </div>
      {locked && <p className="px-3 pb-2 text-xs text-muted">End the call to switch conversations.</p>}

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
        {currentId === null && (
          <li className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <p className="font-medium">New conversation</p>
            <p className="text-xs text-muted">Starts when you start a call</p>
          </li>
        )}
        {conversations.map((c) => {
          const active = c.id === currentId;
          return (
            <li key={c.id} className="group relative">
              <button
                onClick={() => onOpen(c.id)}
                disabled={locked || active}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-lg px-3 py-2 pr-8 text-left text-sm transition-colors ${
                  active ? "bg-panel-2" : "hover:bg-panel-2/60 disabled:hover:bg-transparent"
                } ${locked && !active ? "opacity-50" : ""}`}
              >
                <p className="truncate font-medium">{loadingId === c.id ? "Opening…" : c.title}</p>
                <p className="truncate text-xs text-muted">
                  {relativeTime(c.updatedAt)}
                  {c.preview && ` · ${c.preview}`}
                </p>
              </button>
              {confirming === c.id ? (
                <div className="mt-1 flex items-center gap-2 px-3 pb-1 text-xs">
                  <span className="text-muted">Delete this conversation?</span>
                  <button onClick={() => { setConfirming(null); onDelete(c.id); }} className="font-semibold text-danger hover:underline">
                    Delete
                  </button>
                  <button onClick={() => setConfirming(null)} className="text-muted hover:text-fg">
                    Keep
                  </button>
                </div>
              ) : (
                !locked && (
                  <button
                    onClick={() => setConfirming(c.id)}
                    aria-label={`Delete ${c.title}`}
                    className="absolute top-2 right-2 rounded px-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
                  >
                    ✕
                  </button>
                )
              )}
            </li>
          );
        })}
        {conversations.length === 0 && currentId === null && (
          <li className="px-3 py-2 text-xs text-muted">Your conversations will appear here.</li>
        )}
      </ul>
    </nav>
  );
}
