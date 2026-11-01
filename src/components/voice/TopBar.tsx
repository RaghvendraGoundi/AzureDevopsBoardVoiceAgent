"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { VoiceEngine } from "@/hooks/voice/useVoiceSession";
import type { InputMode } from "@/lib/voice/realtimeClient";
import type { ConnectionState } from "@/types/voice";
import { BoardIcon, LogoMark, SettingsIcon } from "./icons";

interface Props {
  connection: ConnectionState;
  demoRunning: boolean;
  mode: InputMode;
  engine: VoiceEngine;
  /** The scripted demo confirms a real change, so it's only offered on the emulated board. */
  demoAvailable: boolean;
  onModeChange: (mode: InputMode) => void;
  onEngineChange: (engine: VoiceEngine) => void;
  onDemo: () => void;
  onStopDemo: () => void;
}

const CONN: Record<ConnectionState, string> = {
  disconnected: "Offline",
  connecting: "Connecting",
  connected: "Connected",
  failed: "Disconnected",
};

const ENGINES: Array<{ id: VoiceEngine; label: string; detail: string }> = [
  { id: "realtime", label: "Realtime", detail: "gpt-realtime-2.1 · fastest on the board" },
  { id: "live", label: "GPT-Live", detail: "gpt-live-1 · most natural conversation" },
];

export function TopBar(p: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const live = p.connection === "connected" || p.connection === "connecting";

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

      {p.engine === "realtime" && (
        <div role="radiogroup" aria-label="Input mode" className="modeseg hidden sm:inline-flex">
          {(["handsfree", "ptt"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={p.mode === m} onClick={() => p.onModeChange(m)}>
              {m === "handsfree" ? "Hands-free" : "Push to talk"}
            </button>
          ))}
        </div>
      )}

      <span className="conn" data-state={p.demoRunning ? "connecting" : p.connection}>
        <i aria-hidden />
        <span className="hidden sm:inline">{p.demoRunning ? "Demo" : CONN[p.connection]}</span>
      </span>

      <div ref={menuRef} className="relative">
        <button className={`ibtn ${open ? "on" : ""}`} aria-label="Settings" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
          <SettingsIcon size={18} />
        </button>
        {open && (
          <div className="panel animate-rise absolute top-12 right-0 w-72 rounded-2xl! p-3" role="dialog" aria-label="Settings">
            <p className="lab px-2 pt-1 pb-2">Voice model</p>
            <div role="radiogroup" aria-label="Voice model" className="flex flex-col gap-1">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  role="radio"
                  aria-checked={p.engine === e.id}
                  disabled={live || p.demoRunning}
                  onClick={() => p.onEngineChange(e.id)}
                  className="rowbtn disabled:opacity-50"
                  aria-current={p.engine === e.id ? "true" : undefined}
                >
                  <span className="text-sm font-semibold">{e.label}</span>
                  <span className="sub2 text-xs!">{e.detail}</span>
                </button>
              ))}
            </div>
            {live && <p className="sub2 px-2 pt-1 text-xs!">End the call to switch models.</p>}

            {p.engine === "realtime" && (
              <div className="mt-3 sm:hidden">
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
