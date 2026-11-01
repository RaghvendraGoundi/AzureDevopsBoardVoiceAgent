"use client";

import type { InputMode } from "@/lib/voice/realtimeClient";
import type { AgentStatus, ConnectionState } from "@/types/voice";
import { CaptionsIcon, EndIcon, MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon, StopIcon } from "./icons";

interface Props {
  connection: ConnectionState;
  status: AgentStatus;
  mode: InputMode;
  talking: boolean;
  muted: boolean;
  outputMuted: boolean;
  captions: boolean;
  demoRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onToggleOutput: () => void;
  onToggleCaptions: () => void;
  onInterrupt: () => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
  onStopDemo: () => void;
}

/** Call controls: one big Start when idle; voice, captions, mic, interrupt and end during a call. */
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
  return (
    <div className="panel flex items-end gap-4 rounded-full! px-5 py-3 sm:gap-7 sm:px-6">
      <div className="dockc">
        <button
          className={`ibtn lg ${p.outputMuted ? "on" : ""}`}
          onClick={p.onToggleOutput}
          aria-pressed={p.outputMuted}
          aria-label={p.outputMuted ? "Unmute the assistant" : "Mute the assistant"}
          disabled={!live}
        >
          {p.outputMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
        </button>
        Voice
      </div>
      <div className="dockc">
        <button
          className={`ibtn lg ${p.captions ? "on" : ""}`}
          onClick={p.onToggleCaptions}
          aria-pressed={p.captions}
          aria-label="Captions"
        >
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
          <button
            className={`ibtn xl ${p.muted ? "off" : ""}`}
            onClick={p.onToggleMute}
            aria-pressed={p.muted}
            aria-label={p.muted ? "Unmute your mic" : "Mute your mic"}
            disabled={!live}
          >
            {p.muted ? <MicOffIcon size={26} /> : <MicIcon size={26} />}
          </button>
        )}
        {ptt ? (p.talking ? "Talking" : "Hold") : p.muted ? "Mic off" : "Mic"}
      </div>
      <div className="dockc">
        <button className="ibtn lg" onClick={p.onInterrupt} disabled={p.status !== "speaking"} aria-label="Interrupt">
          <StopIcon />
        </button>
        Interrupt
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
