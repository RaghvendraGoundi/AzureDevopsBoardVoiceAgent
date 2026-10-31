"use client";

import { useEffect, useRef } from "react";
import type { SessionSummary } from "@/hooks/voice/workspaceReducer";

interface Props {
  /** The call is ending: who ended it. */
  closing: "assistant" | "user" | null;
  summary: SessionSummary | null;
  conversationTitle: string | null;
  onContinue: () => void;
  onNewConversation: () => void;
  onDismiss: () => void;
}

function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const ENDED_BY: Record<SessionSummary["endedBy"], string> = {
  assistant: "The assistant closed the session.",
  user: "You ended the session.",
  connection: "The connection to the voice service was lost.",
};

/**
 * Popups around the end of a call: "Closing session…" while the assistant
 * says goodbye, then a summary of the call with what to do next.
 */
export function SessionDialog({ closing, summary, conversationTitle, onContinue, onNewConversation, onDismiss }: Props) {
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!summary) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [summary, onDismiss]);

  if (!summary && !closing) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      {summary ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-ended-title"
          className="animate-rise w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-2xl"
        >
          <h2 id="session-ended-title" className="text-lg font-semibold">
            Session ended
          </h2>
          <p className="mt-1 text-sm text-muted">{ENDED_BY[summary.endedBy]}</p>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-panel-2 px-2 py-2.5">
              <dd className="text-lg font-semibold">{duration(summary.durationMs)}</dd>
              <dt className="text-xs text-muted">Duration</dt>
            </div>
            <div className="rounded-xl bg-panel-2 px-2 py-2.5">
              <dd className="text-lg font-semibold">{summary.turns}</dd>
              <dt className="text-xs text-muted">Messages</dt>
            </div>
            <div className="rounded-xl bg-panel-2 px-2 py-2.5">
              <dd className="text-lg font-semibold">{summary.changes.length}</dd>
              <dt className="text-xs text-muted">Changes</dt>
            </div>
          </dl>

          {summary.changes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {summary.changes.slice(0, 4).map((c) => (
                <li key={c.id} className="truncate">
                  <span className={c.kind === "created" ? "text-listen" : "text-ok"}>{c.kind === "created" ? "Created" : "Updated"}</span>{" "}
                  #{c.item.id} {c.item.title}
                </li>
              ))}
              {summary.changes.length > 4 && <li className="text-xs text-muted">and {summary.changes.length - 4} more</li>}
            </ul>
          )}

          {conversationTitle && (
            <p className="mt-3 text-xs text-muted">
              Saved to <span className="text-fg/80">{conversationTitle}</span>
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              ref={primary}
              onClick={onContinue}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Continue this conversation
            </button>
            <div className="flex gap-2">
              <button onClick={onNewConversation} className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-panel-2">
                New conversation
              </button>
              <button onClick={onDismiss} className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-panel-2">
                Close
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section role="alertdialog" aria-live="assertive" className="animate-rise flex items-center gap-3 rounded-2xl border border-line bg-panel px-5 py-4 shadow-2xl">
          <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
          <div>
            <p className="font-semibold">Closing session…</p>
            <p className="text-xs text-muted">{closing === "assistant" ? "Saying goodbye" : "Hanging up"}</p>
          </div>
        </section>
      )}
    </div>
  );
}
