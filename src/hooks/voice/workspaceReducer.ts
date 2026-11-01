import type { BoardInfo } from "@/lib/devops/briefing";
import type { WorkItem, WorkItemDetail } from "@/lib/devops/types";
import { TOOL_LABELS, type AgentStatus, type ConnectionState, type PendingAction, type VoiceEvent } from "@/types/voice";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  /** Assistant reply cut off by the user (barge-in). */
  interrupted?: boolean;
  /** When the entry started (ms since epoch). */
  at?: number;
}

/** Shown in the popup when a call ends. */
export interface SessionSummary {
  durationMs: number;
  /** Things said (both sides) during the call. */
  turns: number;
  /** Board changes made during the call. */
  changes: ActivityEntry[];
  endedBy: "assistant" | "user" | "connection";
}

export interface ActivityEntry {
  id: string;
  kind: "created" | "updated" | "cancelled";
  item: WorkItem;
  before?: WorkItem;
  at: number;
}

export interface WorkspaceState {
  connection: ConnectionState;
  connectionError: string | null;
  status: AgentStatus;
  /** Label of the tool currently running, e.g. "Searching Azure DevOps…". */
  activeTool: string | null;
  transcript: TranscriptEntry[];
  results: { title: string; items: WorkItem[] } | null;
  /** One item opened in full (from the assistant, or a click); shown over the results. */
  detail: WorkItemDetail | null;
  focusedId: number | null;
  pending: PendingAction | null;
  activity: ActivityEntry[];
  /** Ids that just changed, for a brief highlight animation. */
  flash: Record<number, "created" | "updated">;
  errors: { id: number; message: string }[];
  /** Project and current sprint for the header. */
  boardInfo: BoardInfo | null;
  /** When the current call connected. */
  sessionStartedAt: number | null;
  /** Set while the call is ending: who ended it. */
  closing: "assistant" | "user" | null;
  /** The call that just ended, for the "Session ended" popup. */
  sessionSummary: SessionSummary | null;
}

export const initialWorkspaceState: WorkspaceState = {
  connection: "disconnected",
  connectionError: null,
  status: "idle",
  activeTool: null,
  transcript: [],
  results: null,
  detail: null,
  focusedId: null,
  pending: null,
  activity: [],
  flash: {},
  errors: [],
  boardInfo: null,
  sessionStartedAt: null,
  closing: null,
  sessionSummary: null,
};

export type WorkspaceAction =
  | VoiceEvent
  | { type: "reset" }
  | { type: "dismiss_error"; id: number }
  | { type: "clear_flash"; id: number }
  | { type: "board_info"; info: BoardInfo | null }
  /** Shows a saved conversation (its transcript and board changes). */
  | { type: "load_conversation"; transcript: TranscriptEntry[]; activity: ActivityEntry[] }
  | { type: "dismiss_session_summary" }
  /** Back from an item's detail to the list. */
  | { type: "close_detail" };

let errorSeq = 0;

function upsertTranscript(
  list: TranscriptEntry[],
  role: TranscriptEntry["role"],
  id: string,
  text: string,
  final: boolean,
): TranscriptEntry[] {
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) {
    if (final && !text.trim()) return list;
    return [...list, { id, role, text, final, at: Date.now() }];
  }
  const existing = list[idx];
  // A final transcript replaces streamed deltas; an empty final means silence/noise, so drop it.
  if (final && !text.trim()) return list.filter((_, i) => i !== idx);
  const next = { ...existing, text: final ? text : existing.text + text, final };
  return list.map((e, i) => (i === idx ? next : e));
}

function replaceItem(items: WorkItem[], item: WorkItem) {
  return items.map((i) => (i.id === item.id ? item : i));
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "reset":
      return { ...initialWorkspaceState, boardInfo: state.boardInfo };

    case "connection": {
      const next = {
        ...state,
        connection: action.state,
        connectionError: action.state === "failed" ? (action.error ?? "Connection failed.") : null,
        activeTool: action.state === "connected" ? state.activeTool : null,
      };
      if (action.state === "connected") return { ...next, sessionStartedAt: Date.now(), closing: null, sessionSummary: null };
      if ((action.state === "disconnected" || action.state === "failed") && state.sessionStartedAt !== null) {
        const since = state.sessionStartedAt;
        return {
          ...next,
          sessionStartedAt: null,
          closing: null,
          sessionSummary: {
            durationMs: Date.now() - since,
            turns: state.transcript.filter((e) => (e.at ?? 0) >= since && e.text.trim()).length,
            changes: state.activity.filter((a) => a.at >= since && a.kind !== "cancelled"),
            endedBy: action.state === "failed" ? "connection" : (state.closing ?? "user"),
          },
        };
      }
      return next;
    }

    case "session_closing":
      return { ...state, closing: action.by };

    case "dismiss_session_summary":
      return { ...state, sessionSummary: null };

    case "load_conversation":
      return {
        ...initialWorkspaceState,
        boardInfo: state.boardInfo,
        transcript: action.transcript,
        activity: action.activity,
      };

    case "agent_status":
      return { ...state, status: action.status };

    case "user_transcript":
      return { ...state, transcript: upsertTranscript(state.transcript, "user", action.id, action.text, action.final) };

    case "assistant_transcript":
      return { ...state, transcript: upsertTranscript(state.transcript, "assistant", action.id, action.text, action.final) };

    case "assistant_interrupted":
      return {
        ...state,
        transcript: state.transcript
          .filter((e) => !(e.role === "assistant" && !e.final && !e.text.trim()))
          .map((e) => (e.role === "assistant" && !e.final ? { ...e, final: true, interrupted: true } : e)),
      };

    case "tool_started":
      return { ...state, status: "processing", activeTool: TOOL_LABELS[action.tool] ?? "Working…" };

    case "tool_finished":
      return { ...state, activeTool: null };

    case "work_items_loaded":
      return { ...state, results: { title: action.title, items: action.items }, focusedId: null };

    case "work_item_focused": {
      const inResults = state.results?.items.some((i) => i.id === action.item.id);
      return {
        ...state,
        focusedId: action.item.id,
        results: inResults
          ? { ...state.results!, items: replaceItem(state.results!.items, action.item) }
          : { title: `Work item #${action.item.id}`, items: [action.item] },
      };
    }

    case "work_item_detail":
      // A quiet refresh only updates an item that's already open.
      if (action.quiet && state.detail?.id !== action.detail.id) return state;
      return { ...state, detail: action.detail, focusedId: action.detail.id };

    case "close_detail":
      return { ...state, detail: null };

    case "work_item_preview":
      return {
        ...state,
        pending: action.action,
        focusedId: action.action.kind === "update" ? action.action.after.id : state.focusedId,
      };

    case "confirmation_resolved": {
      if (state.pending?.actionId !== action.actionId) return state;
      const activity =
        action.outcome === "cancelled"
          ? [{ id: `cancel-${action.actionId}`, kind: "cancelled" as const, item: state.pending.after, at: Date.now() }, ...state.activity]
          : state.activity;
      return { ...state, pending: null, activity };
    }

    case "work_item_updated":
      return {
        ...state,
        detail: state.detail && state.detail.id === action.item.id ? { ...state.detail, ...action.item } : state.detail,
        results: state.results && { ...state.results, items: replaceItem(state.results.items, action.item) },
        focusedId: action.item.id,
        activity: [
          { id: `upd-${action.item.id}-${action.item.rev}`, kind: "updated", item: action.item, before: action.before, at: Date.now() },
          ...state.activity,
        ],
        flash: { ...state.flash, [action.item.id]: "updated" },
      };

    case "work_item_created":
      return {
        ...state,
        results: state.results
          ? { ...state.results, items: [action.item, ...state.results.items] }
          : { title: "Newly created", items: [action.item] },
        focusedId: action.item.id,
        activity: [{ id: `new-${action.item.id}`, kind: "created", item: action.item, at: Date.now() }, ...state.activity],
        flash: { ...state.flash, [action.item.id]: "created" },
      };

    case "error":
      return { ...state, errors: [...state.errors.slice(-2), { id: ++errorSeq, message: action.message }] };

    case "dismiss_error":
      return { ...state, errors: state.errors.filter((e) => e.id !== action.id) };

    case "board_info":
      return { ...state, boardInfo: action.info };

    case "clear_flash": {
      const flash = { ...state.flash };
      delete flash[action.id];
      return { ...state, flash };
    }
  }
}
