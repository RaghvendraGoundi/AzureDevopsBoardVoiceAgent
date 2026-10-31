"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { runDemo } from "@/lib/voice/demoScript";
import { LiveClient } from "@/lib/voice/liveClient";
import { RealtimeClient, type InputMode, type SessionCredentials } from "@/lib/voice/realtimeClient";
import { executeToolRemote, fetchSessionCredentials, resolveActionRemote } from "@/lib/voice/toolExecutor";
import type { BoardInfo } from "@/lib/devops/briefing";
import type { VoiceEvent } from "@/types/voice";
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
  const [demoRunning, setDemoRunning] = useState(false);
  const [mode, setModeState] = useState<InputMode>("handsfree");
  const [talking, setTalking] = useState(false);
  const [engine, setEngineState] = useState<VoiceEngine>("realtime");
  const clientRef = useRef<RealtimeClient | LiveClient | null>(null);
  const demoAbort = useRef<AbortController | null>(null);
  const prefetched = useRef<{ creds: Promise<SessionCredentials>; at: number } | null>(null);

  /** Mint a session key ahead of time so pressing Start doesn't wait on it. */
  const prefetch = useCallback(() => {
    const creds = fetchSessionCredentials();
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
    return p && Date.now() - p.at < PREFETCH_MAX_AGE_MS ? p.creds : fetchSessionCredentials();
  }, []);

  const onEvent = useCallback((event: VoiceEvent) => dispatch(event), []);

  const start = useCallback(async () => {
    if (clientRef.current) return;
    demoAbort.current?.abort();
    // The assistant hung up after the user said they were done.
    const onEnded = () => {
      if (clientRef.current !== client) return;
      clientRef.current = null;
      setMuted(false);
      setTalking(false);
      prefetch();
    };
    const client =
      engine === "live"
        ? new LiveClient({ onEvent, executeTool: executeToolRemote, onEnded })
        : new RealtimeClient({ onEvent, executeTool: executeToolRemote, onEnded });
    clientRef.current = client;
    setMuted(false);
    try {
      if (client instanceof LiveClient) await client.connect();
      else await client.connect(takeCredentials, mode);
    } catch {
      // The client already emitted a failed connection event with the reason.
      clientRef.current = null;
    }
  }, [onEvent, mode, engine, takeCredentials, prefetch]);

  const stop = useCallback(() => {
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

  const startDemo = useCallback(async () => {
    if (clientRef.current || demoRunning) return;
    const ctrl = new AbortController();
    demoAbort.current = ctrl;
    dispatch({ type: "reset" });
    setDemoRunning(true);
    try {
      await runDemo(dispatch, ctrl.signal);
    } finally {
      setDemoRunning(false);
    }
  }, [demoRunning]);

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
    demoRunning,
    mode,
    talking,
    engine,
    setEngine,
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
  };
}
