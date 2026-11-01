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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(2,4,10,0.66)] p-4 backdrop-blur-sm">
      {summary ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-ended-title"
          className="panel animate-rise w-full max-w-md p-6"
        >
          <h2 id="session-ended-title" className="serif text-[34px] leading-none">
            Session ended
          </h2>
          <p className="sub2 mt-2">{ENDED_BY[summary.endedBy]}</p>

          <dl className="mt-5 flex">
            {[
              [duration(summary.durationMs), "Duration"],
              [String(summary.turns), "Messages"],
              [String(summary.changes.length), "Changes"],
            ].map(([value, label], i) => (
              <div key={label} className={`flex-1 ${i ? "border-l border-line pl-4" : ""}`}>
                <dd className="text-[30px] leading-none font-semibold tracking-tight">{value}</dd>
                <dt className="sub2 mt-1.5">{label}</dt>
              </div>
            ))}
          </dl>

          {summary.changes.length > 0 && (
            <ul className="mt-5 flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
              {summary.changes.slice(0, 4).map((c) => (
                <li key={c.id} className="truncate">
                  <span className={c.kind === "created" ? "text-voice" : "text-accent"}>{c.kind === "created" ? "Created" : "Updated"}</span>{" "}
                  <span className="mono text-muted">#{c.item.id}</span> {c.item.title}
                </li>
              ))}
              {summary.changes.length > 4 && <li className="sub2">and {summary.changes.length - 4} more</li>}
            </ul>
          )}

          {conversationTitle && (
            <p className="sub2 mt-4">
              Saved to <span className="text-fg">{conversationTitle}</span>
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button ref={primary} onClick={onContinue} className="pill pri lg">
              Continue this conversation
            </button>
            <div className="flex gap-2">
              <button onClick={onNewConversation} className="pill flex-1">
                New conversation
              </button>
              <button onClick={onDismiss} className="pill flex-1">
                Close
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section role="alertdialog" aria-live="assertive" className="panel animate-rise flex items-center gap-4 px-6 py-5">
          <span className="ind t" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <div>
            <p className="serif text-[28px] leading-none">Closing session…</p>
            <p className="sub2 mt-1.5">{closing === "assistant" ? "Saying goodbye" : "Hanging up"}</p>
          </div>
        </section>
      )}
    </div>
  );
}
