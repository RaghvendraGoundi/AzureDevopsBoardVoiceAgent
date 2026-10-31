"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { Conversation, ConversationChange, ConversationSummary, ConversationTurn } from "@/lib/conversations/types";
import type { ActivityEntry, TranscriptEntry, WorkspaceAction, WorkspaceState } from "./workspaceReducer";

const SAVE_DELAY_MS = 600;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/**
 * The user's conversations: a list for the sidebar, the open one, and
 * autosave. Every finished line of the transcript and every board change is
 * saved to the open conversation shortly after it happens. A conversation is
 * only created when a call starts in it, so empty ones don't pile up.
 */
export function useConversations(state: WorkspaceState, dispatch: Dispatch<WorkspaceAction>, paused: boolean) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
  const saved = useRef({ turns: new Set<string>(), changes: new Set<string>() });

  const setCurrent = (id: string | null) => {
    currentRef.current = id;
    setCurrentId(id);
  };

  const upsertSummary = (summary: ConversationSummary) =>
    setConversations((list) => [summary, ...list.filter((c) => c.id !== summary.id)]);

  const refresh = useCallback(async () => {
    try {
      setConversations((await api<{ conversations: ConversationSummary[] }>("/api/conversations")).conversations);
    } catch {
      // The list is a convenience; the app still works without it.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Starts a blank conversation (created on the server when the first call starts). */
  const newConversation = useCallback(() => {
    setCurrent(null);
    saved.current = { turns: new Set(), changes: new Set() };
    dispatch({ type: "reset" });
  }, [dispatch]);

  /** Opens a saved conversation. */
  const open = useCallback(
    async (id: string) => {
      setLoadingId(id);
      try {
        const { conversation } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`);
        const transcript: TranscriptEntry[] = conversation.turns.map((t) => ({ id: t.id, role: t.role, text: t.text, final: true, at: t.at }));
        const activity: ActivityEntry[] = [...conversation.changes].reverse();
        saved.current = { turns: new Set(transcript.map((t) => t.id)), changes: new Set(activity.map((a) => a.id)) };
        setCurrent(id);
        dispatch({ type: "load_conversation", transcript, activity });
      } catch {
        dispatch({ type: "error", message: "Couldn't open that conversation." });
      } finally {
        setLoadingId(null);
      }
    },
    [dispatch],
  );

  /** The open conversation's id, creating it on the server if this is a new one. */
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (currentRef.current) return currentRef.current;
    try {
      const { conversation } = await api<{ conversation: Conversation }>("/api/conversations", { method: "POST" });
      setCurrent(conversation.id);
      upsertSummary({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt, turnCount: 0, preview: "" });
      return conversation.id;
    } catch {
      return null; // talking still works; it just won't be saved
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setConversations((list) => list.filter((c) => c.id !== id));
      if (currentRef.current === id) newConversation();
      await api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => refresh());
    },
    [newConversation, refresh],
  );

  // Autosave: send finished lines and board changes that haven't been saved yet.
  useEffect(() => {
    const id = currentRef.current;
    if (!id || paused) return;
    const turns: ConversationTurn[] = state.transcript
      .filter((e) => e.final && e.text.trim() && !saved.current.turns.has(e.id))
      .map((e) => ({ id: e.id, role: e.role, text: e.text, at: e.at ?? Date.now() }));
    const changes: ConversationChange[] = state.activity
      .filter((a) => !saved.current.changes.has(a.id))
      .map((a) => ({ id: a.id, kind: a.kind, item: a.item, before: a.before, at: a.at }))
      .reverse();
    if (turns.length === 0 && changes.length === 0) return;
    const timer = setTimeout(async () => {
      turns.forEach((t) => saved.current.turns.add(t.id));
      changes.forEach((c) => saved.current.changes.add(c.id));
      try {
        const res = await api<{ conversation: ConversationSummary }>(`/api/conversations/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ turns, changes }),
        });
        upsertSummary(res.conversation);
      } catch {
        // Try again with the next change.
        turns.forEach((t) => saved.current.turns.delete(t.id));
        changes.forEach((c) => saved.current.changes.delete(c.id));
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.transcript, state.activity, paused]);

  return { conversations, currentId, loadingId, newConversation, open, ensureConversation, remove };
}
