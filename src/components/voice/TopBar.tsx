"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { VoiceEngine } from "@/hooks/voice/useVoiceSession";
import type { InputMode } from "@/lib/voice/realtimeClient";
import type { ConnectionState } from "@/types/voice";
import { voicesFor } from "@/lib/voice/voices";
import { BoardIcon, ChevronDownIcon, LogoMark, SettingsIcon, WaveIcon } from "./icons";

interface Props {
  connection: ConnectionState;
  demoRunning: boolean;
  mode: InputMode;
  engine: VoiceEngine;
  /** The chosen voice for this engine; null is the default. */
  voice: string | null;
  /** Opens the model and voice picker. */
  onOpenPicker: () => void;
  onEngineChange: (engine: VoiceEngine) => void;
  /** The scripted demo confirms a real change, so it's only offered on the emulated board. */
  demoAvailable: boolean;
  onModeChange: (mode: InputMode) => void;
  onDemo: () => void;
  onStopDemo: () => void;
}

const CONN: Record<ConnectionState, string> = {
  disconnected: "Offline",
  connecting: "Connecting",
  connected: "Connected",
  failed: "Disconnected",
};

const ENGINE_NAME: Record<VoiceEngine, string> = { realtime: "Realtime", live: "GPT-Live" };

export function TopBar(p: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const live = p.connection === "connected" || p.connection === "connecting";
  const voiceLabel = voicesFor(p.engine).find((v) => v.id === (p.voice ?? "marin"))?.label ?? "Marin";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="relative z-20 flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <LogoMark />
        <span className="disp logotxt text-[17px] font-bold tracking-[-0.01em]">
          DevOps<span> Voice</span>
        </span>
      </div>
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
              title={live ? "End the call to switch engines" : undefined}
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

      <span className="conn" data-state={p.demoRunning ? "connecting" : p.connection}>
        <i aria-hidden />
        <span className="hidden sm:inline">{p.demoRunning ? "Demo" : CONN[p.connection]}</span>
      </span>

      <div ref={menuRef} className="relative">
        <button className={`ibtn ${open ? "on" : ""}`} aria-label="Settings" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
          <SettingsIcon size={18} />
        </button>
        {open && (
          <div className="panel animate-rise absolute top-12 right-0 menu max-h-[calc(100dvh-80px)] w-72 overflow-x-hidden overflow-y-auto rounded-2xl! p-3" role="dialog" aria-label="Settings">
            <button className="rowbtn" onClick={() => { p.onOpenPicker(); setOpen(false); }}>
              <span className="lab">Model and voice</span>
              <span className="text-sm font-semibold">
                {ENGINE_NAME[p.engine]} · {voiceLabel}
              </span>
              <span className="sub2 text-xs!">Compare models and listen to the voices</span>
            </button>

            {p.engine === "realtime" && (
              <div className="mt-3">
                <p className="lab px-2 pb-2">Input</p>
                <div role="radiogroup" aria-label="Input mode (phone)" className="modeseg">
                  {(["handsfree", "ptt"] as const).map((m) => (
                    <button key={m} role="radio" aria-checked={p.mode === m} onClick={() => p.onModeChange(m)}>
                      {m === "handsfree" ? "Hands-free" : "Push to talk"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
              <Link href="/board" className="rowbtn flex-row! items-center gap-2 text-sm font-semibold">
                <BoardIcon size={16} /> Sprint board
              </Link>
              {!p.demoAvailable ? null : p.demoRunning ? (
                <button className="rowbtn text-sm font-semibold" onClick={() => { p.onStopDemo(); setOpen(false); }}>
                  Stop demo
                </button>
              ) : (
                <button className="rowbtn text-sm font-semibold disabled:opacity-50" disabled={live} onClick={() => { p.onDemo(); setOpen(false); }}>
                  Simulate demo
                  <span className="sub2 text-xs! font-normal">Scripted call, real board tools</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
