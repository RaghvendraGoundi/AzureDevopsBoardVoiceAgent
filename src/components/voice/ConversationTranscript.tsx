"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/hooks/voice/workspaceReducer";

export function ConversationTranscript({ entries }: { entries: TranscriptEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-muted">
        <div>
          <p>Try saying:</p>
          <p className="mt-2 text-fg/80">“What are my active work items?”</p>
          <p className="text-fg/80">“Move the second one to completed.”</p>
          <p className="text-fg/80">“Create a task to add logging to the payment service.”</p>
        </div>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-3 p-4" aria-label="Conversation">
      {entries.map((e) => (
        <li key={e.id} className={`animate-rise flex ${e.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
              e.role === "user" ? "rounded-br-sm bg-accent/20 text-fg" : "rounded-bl-sm bg-panel-2 text-fg/90"
            }`}
          >
            {e.text || <span className="italic text-muted">…</span>}
            {e.interrupted && <span className="ml-1 text-xs text-muted italic">(interrupted)</span>}
          </div>
        </li>
      ))}
      <div ref={endRef} />
    </ol>
  );
}
