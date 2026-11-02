"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { runDemo } from "@/lib/voice/demoScript";
import { LiveClient } from "@/lib/voice/liveClient";
import { ConnectError, RealtimeClient, type InputMode, type SessionCredentials } from "@/lib/voice/realtimeClient";
import { executeToolRemote, fetchSessionCredentials, resolveActionRemote } from "@/lib/voice/toolExecutor";
import { flush as flushTelemetry, newTelemetrySession, track } from "@/lib/telemetry/client";
import { greetingInstruction } from "@/lib/voice/greeting";
import { voicesFor } from "@/lib/voice/voices";
import type { BoardInfo } from "@/lib/devops/briefing";
import type { VoiceEvent } from "@/types/voice";
import { useConversations } from "./useConversations";
import { initialWorkspaceState, workspaceReducer } from "./workspaceReducer";

/**
 * realtime: gpt-realtime-2.1 with the board tools.
 * live: GPT-Live-1, a full-duplex conversation model (no board tools yet).
 */
export type VoiceEngine = "realtime" | "live";

/** Session keys last 10 minutes; reuse a prefetched one only while it's comfortably fresh. */
const PREFETCH_MAX_AGE_MS = 5 * 60 * 1000;

export function useVoiceSession() {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [muted, setMuted] = useState(false);
  const [outputMuted, setOutputMuted] = useState(false);
  // A message typed before a call was running, sent once it connects.
  const pendingText = useRef<string | null>(null);
  const outputMutedRef = useRef(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [mode, setModeState] = useState<InputMode>("handsfree");
  const [talking, setTalking] = useState(false);
  const [engine, setEngineState] = useState<VoiceEngine>("realtime");
  // The chosen voice for each engine; null means the server's default.
  const [voices, setVoices] = useState<Record<VoiceEngine, string | null>>({ realtime: null, live: null });
  const realtimeVoice = useRef<string | null>(null);
  realtimeVoice.current = voices.realtime;
  const clientRef = useRef<RealtimeClient | LiveClient | null>(null);
  const demoAbort = useRef<AbortController | null>(null);
  const prefetched = useRef<{ creds: Promise<SessionCredentials>; at: number } | null>(null);
  const conversations = useConversations(state, dispatch, demoRunning);
  const { ensureConversation, newConversation } = conversations;
  // Whether the open conversation already has turns, without making start() depend on the transcript.
  const hasHistory = useRef(false);
  const boardInfoRef = useRef<BoardInfo | null>(null);
  boardInfoRef.current = state.boardInfo;
  hasHistory.current = state.transcript.some((e) => e.final && e.text.trim());

  /** Mint a session key ahead of time so pressing Start doesn't wait on it. */
  const prefetch = useCallback(() => {
    const creds = fetchSessionCredentials(null, realtimeVoice.current);
    creds.catch(() => {
      // A failed prefetch is retried for real when the user presses Start.
      prefetched.current = null;
    });
    prefetched.current = { creds, at: Date.now() };
  }, []);

  /** A key can only start one call: hand out the prefetched one once, else mint a new one. */
  const takeCredentials = useCallback(() => {
    const p = prefetched.current;
    prefetched.current = null;
    return p && Date.now() - p.at < PREFETCH_MAX_AGE_MS ? p.creds : fetchSessionCredentials(null, realtimeVoice.current);
  }, []);

  const onEvent = useCallback((event: VoiceEvent) => dispatch(event), []);

  const start = useCallback(async () => {
    if (clientRef.current) return;
    demoAbort.current?.abort();
    // The assistant hung up after the user said they were done.
    const onEnded = () => {
      if (clientRef.current !== client) return;
      track("session_ended", { engine, endedBy: "assistant" });
      flushTelemetry();
      clientRef.current = null;
      setMuted(false);
      setTalking(false);
      prefetch();
    };
    const onStage = (stage: string, ms: number) => track("connect_stage", { engine, stage, ms });
    const makeClient = () =>
      engine === "live"
        ? new LiveClient({ onEvent, executeTool: executeToolRemote, onEnded })
        : new RealtimeClient({ onEvent, executeTool: executeToolRemote, onEnded, onStage });
    let client = makeClient();
    clientRef.current = client;
    setMuted(false);
    newTelemetrySession();
    const connectStarted = performance.now();
    const voice = engine === "live" ? voices.live : voices.realtime;
    try {
      const conversationId = await ensureConversation();
      // A prefetched key has no history in it, so a resumed conversation needs a fresh one.
      const credentials = hasHistory.current ? () => fetchSessionCredentials(conversationId, voices.realtime) : takeCredentials;
      const connect = (c: typeof client) =>
        c instanceof LiveClient ? c.connect(conversationId, voices.live) : c.connect(credentials, mode);
      try {
        await connect(client);
      } catch (err) {
        // One automatic retry when the network, not the mic or the setup, got in the way.
        if (!(err instanceof ConnectError) || !err.retryable || clientRef.current !== client) throw err;
        track("connect_retry", { engine, stage: err.stage, error: err.message });
        await new Promise((r) => setTimeout(r, 1200));
        client = makeClient();
        clientRef.current = client;
        await connect(client);
      }
      client.setOutputMuted(outputMutedRef.current);
      track("session_started", { engine, voice, conversationId, connectedMs: Math.round(performance.now() - connectStarted) });
      const text = pendingText.current;
      pendingText.current = null;
      if (text && !client.sendText(text)) {
        dispatch({ type: "error", message: "Typing works with the Realtime model. Say it instead, or switch models." });
      }
      // The assistant speaks first, unless the call started with something the user typed.
      if (!text) client.greet(greetingInstruction(boardInfoRef.current, hasHistory.current));
    } catch (err) {
      // The client already emitted a failed connection event with the reason.
      track("session_failed", { engine, error: err instanceof Error ? err.message : String(err), afterMs: Math.round(performance.now() - connectStarted) });
      flushTelemetry();
      clientRef.current = null;
      pendingText.current = null;
    }
  }, [onEvent, mode, engine, voices, takeCredentials, prefetch, ensureConversation]);

  /** Takes effect from the next call: a voice is fixed when the session starts. */
  const setVoice = useCallback(
    (id: string, forEngine: VoiceEngine = engine) => {
      if (!voicesFor(forEngine).some((v) => v.id === id)) return;
      setVoices((v) => ({ ...v, [forEngine]: id }));
      try {
        localStorage.setItem(`voice-voice-${forEngine}`, id);
      } catch {
        // Storage may be unavailable; the choice just won't persist.
      }
      // A prefetched Realtime key carries the old voice.
      if (forEngine === "realtime") {
        realtimeVoice.current = id;
        if (!clientRef.current) prefetch();
      }
    },
    [engine, prefetch],
  );

  const stop = useCallback(() => {
    if (clientRef.current) {
      dispatch({ type: "session_closing", by: "user" });
      track("session_ended", { endedBy: "user" });
      flushTelemetry();
    }
    clientRef.current?.disconnect();
    clientRef.current = null;
    setMuted(false);
    prefetch();
  }, [prefetch]);

  /** Takes effect from the next session; the engine can't change mid-call. */
  const setEngine = useCallback((next: VoiceEngine) => {
    if (clientRef.current) return;
    setEngineState(next);
    try {
      localStorage.setItem("voice-engine", next);
    } catch {
      // Storage may be unavailable; the choice just won't persist.
    }
  }, []);

  const setMode = useCallback((next: InputMode) => {
    setModeState(next);
    setTalking(false);
    const client = clientRef.current;
    if (client instanceof RealtimeClient) client.setMode(next);
    try {
      localStorage.setItem("voice-input-mode", next);
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
  }, []);

  const pttStart = useCallback(() => {
    const client = clientRef.current;
    if (!(client instanceof RealtimeClient)) return;
    setTalking(true);
    client.pttStart();
  }, []);

  const pttEnd = useCallback(() => {
    setTalking(false);
    const client = clientRef.current;
    if (client instanceof RealtimeClient) client.pttEnd();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      clientRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  /** Silences (or restores) the assistant's voice; captions keep showing what it says. */
  const toggleOutputMute = useCallback(() => {
    setOutputMuted((m) => {
      outputMutedRef.current = !m;
      clientRef.current?.setOutputMuted(!m);
      return !m;
    });
  }, []);

  /** Stops the assistant mid-reply. */
  const interrupt = useCallback(() => clientRef.current?.stopSpeaking(), []);

  /** Sends a typed message; starts a call first if none is running. */
  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const client = clientRef.current;
      if (!client) {
        pendingText.current = clean;
        void start();
        return;
      }
      if (!client.sendText(clean)) {
        dispatch({ type: "error", message: "Typing works with the Realtime model. Say it instead, or switch models." });
      }
    },
    [start],
  );

  /** On-screen Confirm / Cancel for a pending write. */
  const resolvePending = useCallback(async (actionId: string, decision: "confirm" | "cancel") => {
    try {
      const result = await resolveActionRemote(actionId, decision);
      result.uiEvents.forEach(dispatch);
      const ok = result.output.ok !== false;
      clientRef.current?.sendUiNote(
        decision === "confirm"
          ? ok
            ? `I pressed Confirm and it succeeded: ${JSON.stringify(result.output)}`
            : `I pressed Confirm but it failed: ${String(result.output.error)}`
          : "I pressed Cancel on the pending change.",
      );
    } catch {
      dispatch({ type: "error", message: "Couldn't reach the board service." });
    }
  }, []);

  /**
   * Board actions started from the screen: they run the same tools the
   * assistant uses, so a write still shows a preview and waits for a yes.
   */
  const runFromScreen = useCallback(async (tool: string, args: Record<string, unknown>, note?: string) => {
    try {
      const result = await executeToolRemote(tool, args);
      result.uiEvents.forEach(dispatch);
      if (note && result.output.ok !== false) {
        clientRef.current?.sendUiNote(`${note} Action id ${String(result.output.action_id ?? "none")}; wait for my yes or no.`);
      }
      return result.output.ok !== false;
    } catch {
      dispatch({ type: "error", message: "Couldn't reach the board service." });
      return false;
    }
  }, []);

  const board = {
    /** Open an item in full (parents, children, comments). */
    open: (id: number) => runFromScreen("get_work_item", { id }),
    proposeComment: (id: number, comment: string) =>
      runFromScreen("propose_update_work_item", { id, comment }, `On screen I asked to add a comment to #${id}.`),
    proposeDescription: (id: number, description: string) =>
      runFromScreen("propose_update_work_item", { id, description }, `On screen I asked to change the description of #${id}.`),
    proposeDeleteComment: (id: number, commentId: number) =>
      runFromScreen("propose_delete_comment", { id, comment_id: commentId }, `On screen I asked to delete comment ${commentId} on #${id}.`),
    closeDetail: () => dispatch({ type: "close_detail" }),
  };

  const startDemo = useCallback(async () => {
    if (clientRef.current || demoRunning) return;
    const ctrl = new AbortController();
    demoAbort.current = ctrl;
    // The demo runs in a blank, unsaved conversation.
    newConversation();
    setDemoRunning(true);
    try {
      await runDemo(dispatch, ctrl.signal);
    } finally {
      setDemoRunning(false);
      dispatch({ type: "dismiss_session_summary" });
    }
  }, [demoRunning, newConversation]);

  const stopDemo = useCallback(() => demoAbort.current?.abort(), []);

  const levels = useCallback(() => clientRef.current?.levels() ?? { input: 0, output: 0 }, []);

  // Clear change highlights after a moment.
  useEffect(() => {
    const ids = Object.keys(state.flash).map(Number);
    if (ids.length === 0) return;
    const t = setTimeout(() => ids.forEach((id) => dispatch({ type: "clear_flash", id })), 2400);
    return () => clearTimeout(t);
  }, [state.flash]);

  // Have a session key ready before the user presses Start.
  useEffect(() => prefetch(), [prefetch]);

  // Project and sprint for the header; also warms the board caches on the server.
  useEffect(() => {
    fetch("/api/board/info")
      .then((r) => r.json())
      .then((d: { info?: BoardInfo | null }) => dispatch({ type: "board_info", info: d.info ?? null }))
      .catch(() => undefined);
  }, []);

  // Restore the last input mode.
  useEffect(() => {
    try {
      if (localStorage.getItem("voice-input-mode") === "ptt") setModeState("ptt");
      if (localStorage.getItem("voice-engine") === "live") setEngineState("live");
      const saved = (e: VoiceEngine) => {
        const id = localStorage.getItem(`voice-voice-${e}`);
        return id && voicesFor(e).some((v) => v.id === id) ? id : null;
      };
      setVoices({ realtime: saved("realtime"), live: saved("live") });
      realtimeVoice.current = saved("realtime");
      // The first prefetch ran before the saved voice was known.
      if (realtimeVoice.current && !clientRef.current) prefetch();
    } catch {
      // Ignore unavailable storage.
    }
  }, []);

  // Space bar is push-to-talk while a session is live.
  useEffect(() => {
    if (mode !== "ptt" || engine !== "realtime") return;
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target) || !clientRef.current) return;
      e.preventDefault();
      pttStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      pttEnd();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, engine, pttStart, pttEnd]);

  // Hang up if the page goes away.
  useEffect(() => () => clientRef.current?.disconnect(), []);

  return {
    state,
    muted,
    outputMuted,
    toggleOutputMute,
    interrupt,
    sendText,
    demoRunning,
    mode,
    talking,
    engine,
    setEngine,
    voice: voices[engine],
    voices,
    setVoice,
    conversations,
    dismissSessionSummary: () => dispatch({ type: "dismiss_session_summary" }),
    setMode,
    pttStart,
    pttEnd,
    start,
    stop,
    toggleMute,
    resolvePending,
    startDemo,
    stopDemo,
    levels,
    dismissError: (id: number) => dispatch({ type: "dismiss_error", id }),
    board,
    /** "Stop waiting" for a slow board call: it ends now and the assistant is told. */
    stopWaiting: () => clientRef.current?.cancelTools(),
    /** Highlight one of the listed items, e.g. from a reply that mentions it. */
    focusItem: (id: number) => {
      const item = state.results?.items.find((i) => i.id === id);
      if (item) dispatch({ type: "work_item_focused", item });
    },
  };
}
