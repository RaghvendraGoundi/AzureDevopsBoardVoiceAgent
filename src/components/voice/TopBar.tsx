"use client";

import type { VoiceEngine } from "@/hooks/voice/useVoiceSession";
import type { ConnectionState } from "@/types/voice";
import { voicesFor } from "@/lib/voice/voices";
import { ChevronDownIcon, LogoMark, WaveIcon } from "./icons";

interface Props {
  connection: ConnectionState;
  demoRunning: boolean;
  engine: VoiceEngine;
  /** The chosen voice for this engine; null is the default. */
  voice: string | null;
  /** Opens the engine and voice picker. */
  onOpenPicker: () => void;
  onEngineChange: (engine: VoiceEngine) => void;
}

const CONN: Record<ConnectionState, string> = {
  disconnected: "Offline",
  connecting: "Connecting",
  connected: "Live",
  failed: "Disconnected",
};

const ENGINE_NAME: Record<VoiceEngine, string> = { realtime: "Realtime", live: "GPT-Live" };
const ENGINE_HINT: Record<VoiceEngine, string> = {
  realtime: "Realtime: quickest replies and board actions, and you can type too",
  live: "GPT-Live: the most natural conversation; it listens while it talks",
};

/** Brand on the left; engine and voice in the centre; connection on the right. */
export function TopBar(p: Props) {
  const live = p.connection === "connected" || p.connection === "connecting";
  const voiceLabel = voicesFor(p.engine).find((v) => v.id === (p.voice ?? "marin"))?.label ?? "Marin";

  return (
    <header className="relative z-20 flex h-[72px] items-center gap-3 px-4 sm:gap-4 sm:px-7">
      <a href="/voice" className="brand" aria-label="DevOps Voice home">
        <LogoMark size={40} />
        <span className="word">
          <b>DevOps</b>
          <i>Voice</i>
        </span>
      </a>
      <div className="flex-1" />

      {/* What you're talking to, front and centre: the engine, and the voice (opens the picker). */}
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 md:flex">
        <div className="esw" role="radiogroup" aria-label="Engine">
          {(["realtime", "live"] as const).map((e) => (
            <button
              key={e}
              role="radio"
              aria-checked={p.engine === e}
              disabled={live || p.demoRunning}
              title={live ? "End the call to switch engines" : ENGINE_HINT[e]}
              onClick={() => p.onEngineChange(e)}
            >
              {ENGINE_NAME[e]}
            </button>
          ))}
        </div>
        <button className="modelchip" onClick={p.onOpenPicker} aria-label={`Choose voice. Currently ${voiceLabel}`}>
          <span className="dotorb realtime" aria-hidden>
            <WaveIcon size={16} />
          </span>
          <b>{voiceLabel}</b>
          <ChevronDownIcon size={16} className="text-muted" />
        </button>
      </div>
      {/* Phones: one chip opens the picker for both. */}
      <button className="modelchip md:hidden" onClick={p.onOpenPicker} aria-label={`${ENGINE_NAME[p.engine]}, voice ${voiceLabel}. Change`}>
        <span className="dotorb realtime" aria-hidden>
          <WaveIcon size={16} />
        </span>
        <b>{voiceLabel}</b>
        <ChevronDownIcon size={16} className="text-muted" />
      </button>

      <span className="conn" data-state={p.demoRunning ? "connecting" : p.connection}>
        <i aria-hidden />
        <span className="hidden sm:inline">{p.demoRunning ? "Demo" : CONN[p.connection]}</span>
      </span>
    </header>
  );
}
