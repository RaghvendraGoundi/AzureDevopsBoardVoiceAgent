"use client";

import { useEffect, useRef } from "react";
import type { InputMode } from "@/lib/voice/realtimeClient";
import type { AgentStatus, ConnectionState } from "@/types/voice";
import { CaptionsIcon, EndIcon, InterruptIcon, KeyboardIcon, MicIcon, MuteIcon } from "./icons";

interface Props {
  connection: ConnectionState;
  status: AgentStatus;
  mode: InputMode;
  talking: boolean;
  muted: boolean;
  captions: boolean;
  demoRunning: boolean;
  /** Live mic and speaker levels, 0..1. */
  levels: () => { input: number; output: number };
  onStop: () => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onInterrupt: () => void;
  onType: () => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
  onStopDemo: () => void;
}

const BARS = 5;

/**
 * The call dock: a glass capsule with Mute and Captions on the left, the mic
 * in the middle with live level meters either side, then Interrupt (while
 * the assistant speaks) or Type, and End.
 */
export function CallDock(p: Props) {
  const live = p.connection === "connected";
  const ptt = p.mode === "ptt";
  const speaking = p.status === "speaking";
  const dock = useRef<HTMLDivElement>(null);
  const { levels } = p;

  // Drive the meters and the mic halo straight from the audio levels, without re-rendering.
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    let raf = 0;
    let you = 0;
    let them = 0;
    const tick = () => {
      const { input, output } = levels();
      you += (Math.min(1, input * 1.8) - you) * 0.25;
      them += (Math.min(1, output * 1.8) - them) * 0.25;
      el.style.setProperty("--you", you.toFixed(3));
      el.style.setProperty("--them", them.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levels]);

  if (p.demoRunning) {
    return (
      <div className="dock panel hud">
        <span className="sub2 px-2">Playing the scripted demo</span>
        <button className="pill sm" onClick={p.onStopDemo}>
          Stop demo
        </button>
      </div>
    );
  }

  const meter = (side: "l" | "r") => (
    <span className={`meter ${side}`} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} style={{ ["--k" as string]: side === "l" ? BARS - i : i + 1 }} />
      ))}
    </span>
  );

  return (
    <div ref={dock} className={`dock panel hud ${speaking ? "them" : ""} ${p.connection === "connecting" ? "wait" : ""}`} role="toolbar" aria-label="Call controls">
      <div className="dgroup">
        <button className={`dbtn ${p.muted ? "on warnish" : ""}`} onClick={p.onToggleMute} aria-pressed={p.muted} aria-label={p.muted ? "Unmute your mic" : "Mute"} disabled={!live}>
          <MuteIcon />
          <span>{p.muted ? "Muted" : "Mute"}</span>
        </button>
        <button className={`dbtn ${p.captions ? "on" : ""}`} onClick={p.onToggleCaptions} aria-pressed={p.captions} aria-label="Captions">
          <CaptionsIcon />
          <span>Captions</span>
        </button>
      </div>

      <div className="dmic">
        {meter("l")}
        {ptt ? (
          <button
            className={`micbtn touch-none select-none ${p.talking ? "hot" : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              p.onTalkStart();
            }}
            onPointerUp={p.onTalkEnd}
            onPointerCancel={p.onTalkEnd}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={p.talking}
            aria-label="Hold to talk"
            disabled={!live}
          >
            <MicIcon size={26} />
          </button>
        ) : (
          // Hands-free: the mic is always open; pressing it means "let me talk now".
          <button
            className={`micbtn ${p.muted ? "mute" : "hot"}`}
            onClick={() => (p.muted ? p.onToggleMute() : speaking && p.onInterrupt())}
            aria-label={p.muted ? "Unmute your mic" : "Microphone"}
            disabled={!live}
          >
            <MicIcon size={26} />
          </button>
        )}
        {meter("r")}
      </div>

      <div className="dgroup">
        {speaking ? (
          <button className="dbtn" onClick={p.onInterrupt} aria-label="Interrupt">
            <InterruptIcon />
            <span>Interrupt</span>
          </button>
        ) : (
          <button className="dbtn" onClick={p.onType} aria-label="Type instead">
            <KeyboardIcon size={20} />
            <span>Type</span>
          </button>
        )}
        <button className="dbtn end" onClick={p.onStop} aria-label="End session">
          <EndIcon />
          <span>End</span>
        </button>
      </div>
    </div>
  );
}
