"use client";

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
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onInterrupt: () => void;
  onType: () => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
  onStopDemo: () => void;
}

/**
 * The call dock from variant B: Mute, Captions, Mic, then Interrupt while
 * the assistant speaks (Type otherwise), and End. One big mic when idle.
 */
export function CallDock(p: Props) {
  const live = p.connection === "connected";
  const connecting = p.connection === "connecting";

  if (p.demoRunning) {
    return (
      <div className="panel flex items-center gap-4 rounded-full! px-5 py-3">
        <span className="sub2">Playing the scripted demo</span>
        <button className="pill sm" onClick={p.onStopDemo}>
          Stop demo
        </button>
      </div>
    );
  }

  if (!live && !connecting) {
    return (
      <div className="dockc">
        <button className="ibtn xl" onClick={p.onStart} aria-label="Start voice session">
          <MicIcon size={26} />
        </button>
        Start
      </div>
    );
  }

  const ptt = p.mode === "ptt";
  const speaking = p.status === "speaking";
  return (
    <div className="panel flex w-[min(464px,100%)] items-end justify-between rounded-full! px-[22px] py-3">
      <div className="dockc">
        <button className={`ibtn lg ${p.muted ? "on" : ""}`} onClick={p.onToggleMute} aria-pressed={p.muted} aria-label={p.muted ? "Unmute your mic" : "Mute"} disabled={!live}>
          <MuteIcon />
        </button>
        {p.muted ? "Muted" : "Mute"}
      </div>
      <div className="dockc">
        <button className={`ibtn lg ${p.captions ? "on" : ""}`} onClick={p.onToggleCaptions} aria-pressed={p.captions} aria-label="Captions">
          <CaptionsIcon />
        </button>
        Captions
      </div>
      <div className="dockc">
        {ptt ? (
          <button
            className={`ibtn xl touch-none select-none ${p.talking ? "" : "off"}`}
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
            className={`ibtn xl ${p.muted ? "off" : ""}`}
            onClick={() => (p.muted ? p.onToggleMute() : speaking && p.onInterrupt())}
            aria-label={p.muted ? "Unmute your mic" : "Microphone"}
            disabled={!live}
          >
            <MicIcon size={26} />
          </button>
        )}
        {ptt && p.talking ? "Talking" : ptt ? "Hold" : "Mic"}
      </div>
      <div className="dockc">
        {speaking ? (
          <button className="ibtn lg" onClick={p.onInterrupt} aria-label="Interrupt">
            <InterruptIcon />
          </button>
        ) : (
          <button className="ibtn lg" onClick={p.onType} aria-label="Type instead">
            <KeyboardIcon size={20} />
          </button>
        )}
        {speaking ? "Interrupt" : "Type"}
      </div>
      <div className="dockc">
        <button className="ibtn lg warn" onClick={p.onStop} aria-label="End session">
          <EndIcon />
        </button>
        End
      </div>
    </div>
  );
}
