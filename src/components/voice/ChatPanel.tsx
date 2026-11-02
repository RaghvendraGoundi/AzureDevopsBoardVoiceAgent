"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/hooks/voice/workspaceReducer";
import type { ConversationSummary } from "@/lib/conversations/types";
import type { WorkItem } from "@/lib/devops/types";
import { showAliases } from "@/lib/privacy/aliasesClient";
import { relativeTime } from "./time";
import { CloseIcon, CollapseLeftIcon, HistoryIcon, PlusIcon, SendIcon, TrashIcon, WorkspaceIcon } from "./icons";

interface Props {
  variant: "panel" | "sheet";
  transcript: TranscriptEntry[];
  conversations: ConversationSummary[];
  currentId: string | null;
  loadingId: string | null;
  /** A call is live: switching conversations would cut it off. */
  locked: boolean;
  /** Typing only works with the Realtime model. */
  canType: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSend: (text: string) => void;
  /** Changes when the message box should take focus. */
  focusKey?: number;
  /** A call is live: show the live signal line under the header. */
  live?: boolean;
  /** What the workspace is showing, so replies can point at the items they mention. */
  results?: { items: WorkItem[] } | null;
  onOpenWorkspace?: () => void;
  /** Bring one item to the front of the workspace. */
  onFocusItem?: (id: number) => void;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Up to three of the items on screen that a reply names, by title or number, in the order it names them. */
function mentioned(text: string, items: WorkItem[]): WorkItem[] {
  const said = norm(text);
  return items
    .map((item) => {
      const title = norm(item.title);
      const at = title.length >= 8 ? said.indexOf(title) : -1;
      const byId = at < 0 ? said.search(new RegExp(`\\b${item.id}\\b`)) : -1;
      return { item, at: at >= 0 ? at : byId, end: at >= 0 ? at + title.length : byId + String(item.id).length };
    })
    .filter((m) => m.at >= 0)
    // A title inside a longer one ("Fix slow order lookup query" in "Implement fix slow…") isn't a mention of its own.
    .filter((m, _, all) => !all.some((o) => o !== m && o.at <= m.at && o.end >= m.end && o.end - o.at > m.end - m.at))
    .sort((a, b) => a.at - b.at)
    .slice(0, 3)
    .map((m) => m.item);
}

const clockTime = (at?: number) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/** The conversation as a thread, a box to type into it, and the list of saved conversations. */
export function ChatPanel(p: Props) {
  const [history, setHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Type instead" in the dock opens the chat with the cursor in the box.
  useEffect(() => {
    if (!p.focusKey) return;
    setHistory(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [p.focusKey]);
  const current = p.conversations.find((c) => c.id === p.currentId);
  const messages = p.transcript.filter((e) => e.text.trim() || !e.final);
  const resultItems = p.results?.items ?? [];
  const lastReplyId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  useEffect(() => {
    if (!history) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, messages.at(-1)?.text, history]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !p.canType) return;
    p.onSend(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="phd">
        <div className="min-w-0 flex-1">
          <h3 id="chat-title">{history ? "Conversations" : "Conversation"}</h3>
          <div className="sm truncate">
            {history ? "Saved for you" : current ? `${current.title} · ${relativeTime(current.updatedAt)}` : "New conversation"}
          </div>
        </div>
        <button
          className={`ibtn ${history ? "on" : ""}`}
          onClick={() => setHistory((h) => !h)}
          aria-pressed={history}
          aria-label="Show conversations"
          title="Saved conversations"
        >
          <HistoryIcon size={18} />
        </button>
        <button className="ibtn" onClick={() => { p.onNew(); setHistory(false); }} disabled={p.locked} aria-label="New conversation" title="New conversation">
          <PlusIcon size={18} />
        </button>
        <button className="ibtn" onClick={p.onClose} aria-label="Close chat">
          {p.variant === "sheet" ? <CloseIcon size={18} /> : <CollapseLeftIcon size={18} />}
        </button>
      </div>

      {p.live && !history && <div className="live-line" aria-hidden />}
      {history ? (
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 py-3">
          {p.locked && <p className="sub2 px-2 pb-2">End the call to switch conversations.</p>}
          <ul className="flex flex-col gap-1">
            {p.conversations.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  className="rowbtn pr-11"
                  aria-current={c.id === p.currentId ? "true" : undefined}
                  disabled={p.locked || c.id === p.currentId}
                  onClick={() => {
                    p.onOpen(c.id);
                    setHistory(false);
                  }}
                >
                  <span className="truncate text-[15px] font-semibold">{p.loadingId === c.id ? "Opening…" : c.title}</span>
                  <span className="sub2 truncate">
                    {relativeTime(c.updatedAt)}
                    {c.preview && ` · ${c.preview}`}
                  </span>
                </button>
                {confirming === c.id ? (
                  <div className="flex items-center gap-3 px-3 pb-2 text-xs">
                    <span className="text-muted">Delete this conversation?</span>
                    <button className="font-semibold text-danger hover:underline" onClick={() => { setConfirming(null); p.onDelete(c.id); }}>
                      Delete
                    </button>
                    <button className="text-muted hover:text-fg" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  !p.locked && (
                    <button
                      className="ibtn absolute top-2.5 right-2 size-8! opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => setConfirming(c.id)}
                      aria-label={`Delete ${c.title}`}
                    >
                      <TrashIcon size={15} />
                    </button>
                  )
                )}
              </li>
            ))}
            {p.conversations.length === 0 && <li className="sub2 px-2 py-4">Your conversations will appear here.</li>}
          </ul>
        </nav>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-line px-5 py-5" aria-label="Conversation">
          {messages.length === 0 && (
            <li className="sub2 py-6 text-center">
              Try “What am I working on this sprint?” or “What’s on hold?”
            </li>
          )}
          {messages.map((m) => {
            const refs = m.role === "assistant" && m.final ? mentioned(m.text, resultItems) : [];
            return (
              <li key={m.id} className={`msg ${m.role === "user" ? "you" : ""}`}>
                <span className="who">
                  <span className="orbdot" aria-hidden />
                  DevOps Voice
                  <em>{clockTime(m.at)}</em>
                </span>
                <div className="bub">
                  {(m.role === "assistant" ? showAliases(m.text) : m.text) || <span className="text-muted italic">…</span>}
                  {m.interrupted && <span className="ml-1 text-xs text-muted italic">(interrupted)</span>}
                </div>
                {refs.length > 0 && (
                  <div className="refs" aria-label="Items mentioned">
                    {refs.map((r) => (
                      <button key={r.id} onClick={() => p.onFocusItem?.(r.id)}>
                        <span className="id">#{r.id}</span>
                        {r.title}
                      </button>
                    ))}
                  </div>
                )}
                {m.id === lastReplyId && m.final && resultItems.length > 0 && p.onOpenWorkspace && (
                  <button className="jump" onClick={p.onOpenWorkspace}>
                    <WorkspaceIcon size={16} />
                    Shown in Workspace · {resultItems.length} {resultItems.length === 1 ? "item" : "items"}
                  </button>
                )}
              </li>
            );
          })}
          <div ref={endRef} />
        </ol>
      )}

      {!history && (
        <form onSubmit={send} className="px-4 pt-2 pb-4">
          <label className="field">
            <span className="sr-only">Type a message</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              ref={inputRef}
              placeholder={p.canType ? "Type instead of speaking" : "Typing works with the Realtime model"}
              disabled={!p.canType}
            />
            <button type="submit" className="ibtn" aria-label="Send" disabled={!p.canType || !draft.trim()}>
              <SendIcon size={18} />
            </button>
          </label>
        </form>
      )}
    </div>
  );
}
