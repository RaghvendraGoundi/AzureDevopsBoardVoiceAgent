"use client";

import { useEffect, useState } from "react";
import { showAliases } from "@/lib/privacy/aliasesClient";
import { ActivityStrip } from "./ActivityStrip";
import type { TranscriptEntry, WorkspaceState } from "@/hooks/voice/workspaceReducer";
import type { InputMode } from "@/lib/voice/realtimeClient";
import { orbStateFor, VoiceOrb } from "./VoiceOrb";

interface Props {
  state: WorkspaceState;
  mode: InputMode;
  talking: boolean;
  muted: boolean;
  captions: boolean;
  demoRunning: boolean;
  levels: () => { input: number; output: number };
  /** A side panel is open: keep captions clear of it. */
  narrowCaptions?: boolean;
  /** Tapping the orb: start a call when idle, interrupt while it speaks. */
  onOrb: () => void;
  /** "Stop waiting" for a slow board call. */
  onStopWaiting?: () => void;
}

function greeting(name: string | undefined, now = new Date()) {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name?.split(" ")[0];
  return first ? `${part}, ${first}` : part;
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Item numbers and ids in captions stand out ("1058", "#1058", "number 1058"). */
function highlight(text: string) {
  const parts = text.split(/((?:number |#)?\d{2,})/g);
  return parts.map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part));
}

/** The latest thing you said and the assistant's latest reply. */
function lastExchange(transcript: TranscriptEntry[]) {
  let you: TranscriptEntry | undefined;
  let them: TranscriptEntry | undefined;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const e = transcript[i];
    if (!them && e.role === "assistant" && (e.text.trim() || !e.final)) them = e;
    if (e.role === "user" && (e.text.trim() || !e.final)) {
      you = e;
      break;
    }
  }
  return { you, them };
}

/** The middle of the screen: when and how the assistant is, the orb, and live captions. */
export function CallStage({ state, mode, talking, muted, captions, demoRunning, levels, narrowCaptions, onOrb, onStopWaiting }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const live = state.connection === "connected" || demoRunning;
  const { status, pending, activeTool, boardInfo } = state;

  useEffect(() => {
    if (!state.sessionStartedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.sessionStartedAt]);

  const yourCall = live && !!pending && (status === "listening" || status === "idle");
  const idle = !live && state.connection !== "connecting" && status !== "error" && state.connection !== "failed";
  let word = "Ready";
  let ind: "l" | "s" | "t" | "i" | "c" | null = "i";
  let sub = "Tap the orb or press Space to start.";
  if (state.connection === "connecting") {
    word = "Connecting";
    ind = "t";
    sub = "Setting up the call…";
  } else if (status === "error" || state.connection === "failed") {
    word = "Something went wrong";
    ind = null;
    sub = state.connectionError ?? "Tap the orb or press Space to try again.";
  } else if (yourCall) {
    word = "Your call";
    ind = "l";
    sub = "Say yes, or use the buttons";
  } else if (status === "speaking") {
    word = "Speaking";
    ind = "s";
    sub = mode === "ptt" ? "Tap the orb to interrupt" : "Tap the orb or press Space to interrupt";
  } else if (status === "processing") {
    word = "Thinking";
    ind = "t";
    sub = activeTool ? "Working on your board" : "Working on it…";
  } else if (live) {
    word = mode === "ptt" && !talking ? "Hold to talk" : "Listening";
    ind = mode === "ptt" && !talking ? "i" : "l";
    sub = muted ? "Your mic is muted." : mode === "ptt" ? "Hold Space or the mic, and let go when you're done." : "Go ahead, I'm listening.";
  }

  const label = state.sessionStartedAt
    ? `Session ${clock(now - state.sessionStartedAt)}`
    : [new Date().toLocaleDateString(undefined, { weekday: "long" }), boardInfo?.sprint?.name].filter(Boolean).join(" · ");
  const { you, them } = lastExchange(state.transcript);

  return (
    <div className="flex w-full flex-col items-center text-center">
      <p className="lab mb-1">{label}</p>
      <h1 className="serif text-[clamp(34px,5.2vh,46px)] leading-[1.05]">
        {ind && (
          <span className={`ind ${ind}`} aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
        {word}
      </h1>
      {/* Before a call: the greeting here, and the hint under the orb (as designed). */}
      {!idle && <p className="mt-1.5 text-[15px] text-[#8ea6bf]">{sub}</p>}
      {live && <ActivityStrip steps={state.steps} variant="stage" onStop={onStopWaiting} />}
      {state.connection === "failed" && (
        <a className="textbtn mt-1" href="/diagnostics">
          Run the connection check
        </a>
      )}

      <button
        className={`orbbtn my-[clamp(4px,1.5vh,20px)] ${
          // During a call the captions need room above the dock, so the orb gives up height.
          live && captions ? "w-[min(clamp(180px,calc(100dvh-470px),380px),82cqw)]" : "w-[min(440px,46vh,82cqw)]"
        }`}
        onClick={onOrb}
        aria-label={live ? (status === "speaking" ? "Interrupt the assistant" : "Assistant") : "Start voice session"}
      >
        <VoiceOrb state={orbStateFor(state.connection === "connecting" ? "connecting" : status, yourCall)} levels={levels} />
      </button>

      {/* Before a call, as designed: the greeting under the orb; how to start sits at the bottom. */}
      {idle && <p className="greet">{greeting(boardInfo?.user)}</p>}

      {captions && live && (you || them) && (
        <div className={`w-full px-4 ${narrowCaptions ? "max-w-[min(580px,max(280px,calc(100vw-900px)))]" : "max-w-[580px]"}`} aria-live="off">
          {you && (
            <p className="caph mb-1.5 line-clamp-2">
              <span className="capwho text-[#8fb0c8]!">YOU</span>&nbsp; {you.text || "…"}
            </p>
          )}
          {them && (
            <>
              <p className="capwho mb-1">DEVOPS VOICE</p>
              <p className="capl line-clamp-2">
                {highlight(showAliases(them.text))}
                {!them.final && <span className="cur" aria-hidden />}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
