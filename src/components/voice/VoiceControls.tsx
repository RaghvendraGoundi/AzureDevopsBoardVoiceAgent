import type { VoiceEngine } from "@/hooks/voice/useVoiceSession";
import type { InputMode } from "@/lib/voice/realtimeClient";
import type { ConnectionState } from "@/types/voice";

interface Props {
  connection: ConnectionState;
  muted: boolean;
  demoRunning: boolean;
  mode: InputMode;
  talking: boolean;
  engine: VoiceEngine;
  onEngineChange: (engine: VoiceEngine) => void;
  onModeChange: (mode: InputMode) => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  onDemo: () => void;
  onStopDemo: () => void;
}

const ENGINES: Array<{ id: VoiceEngine; label: string; model: string }> = [
  { id: "realtime", label: "Realtime", model: "gpt-realtime-2.1 · board tools" },
  { id: "live", label: "GPT-Live", model: "gpt-live-1 · board tools via backend" },
];

const PILL: Record<ConnectionState, { label: string; dot: string }> = {
  disconnected: { label: "Offline", dot: "bg-muted" },
  connecting: { label: "Connecting", dot: "bg-warn animate-pulse" },
  connected: { label: "Live", dot: "bg-ok" },
  failed: { label: "Disconnected", dot: "bg-danger" },
};

export function VoiceControls(p: Props) {
  const live = p.connection === "connected" && !p.demoRunning;
  const busy = p.connection === "connecting";
  const pill = p.demoRunning ? { label: "Demo", dot: "bg-think animate-pulse" } : PILL[p.connection];
  const engine = ENGINES.find((e) => e.id === p.engine) ?? ENGINES[0];
  const realtime = p.engine === "realtime";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-1">
        <div role="radiogroup" aria-label="Voice model" className="inline-flex rounded-full border border-line p-0.5 text-xs">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={p.engine === e.id}
              disabled={live || busy}
              onClick={() => p.onEngineChange(e.id)}
              className={`rounded-full px-3 py-1 font-medium disabled:cursor-not-allowed ${
                p.engine === e.id ? "bg-panel-2 text-fg" : "text-muted hover:text-fg disabled:hover:text-muted"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted">{engine.model}</span>
      </div>

      {realtime && (
        <div role="radiogroup" aria-label="Input mode" className="inline-flex rounded-full border border-line p-0.5 text-xs">
          {(["handsfree", "ptt"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={p.mode === m}
              onClick={() => p.onModeChange(m)}
              className={`rounded-full px-3 py-1 font-medium ${p.mode === m ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {m === "handsfree" ? "Hands-free" : "Push to talk"}
            </button>
          ))}
        </div>
      )}

      {live && realtime && p.mode === "ptt" && (
        <button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            p.onTalkStart();
          }}
          onPointerUp={p.onTalkEnd}
          onPointerCancel={p.onTalkEnd}
          onContextMenu={(e) => e.preventDefault()}
          aria-pressed={p.talking}
          className={`w-56 touch-none rounded-2xl border-2 px-5 py-3 text-sm font-semibold select-none ${
            p.talking ? "border-listen bg-listen/20 text-fg" : "border-line text-fg hover:bg-panel-2"
          }`}
        >
          {p.talking ? "Listening… release to send" : "Hold to talk (or Space)"}
        </button>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-muted">
          <span className={`size-2 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>

        {live || busy ? (
          <button
            onClick={p.onStop}
            className="rounded-full bg-danger/90 px-5 py-2.5 text-sm font-semibold text-white hover:bg-danger"
          >
            End session
          </button>
        ) : (
          <button
            onClick={p.onStart}
            disabled={p.demoRunning}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            Start voice session
          </button>
        )}

        <button
          onClick={p.onToggleMute}
          disabled={!live}
          aria-pressed={p.muted}
          className={`rounded-full border px-4 py-2.5 text-sm font-medium disabled:opacity-40 ${
            p.muted ? "border-warn text-warn" : "border-line text-fg hover:bg-panel-2"
          }`}
        >
          {p.muted ? "Unmute" : "Mute"}
        </button>

        {p.demoRunning ? (
          <button onClick={p.onStopDemo} className="text-xs text-muted underline-offset-4 hover:underline">
            Stop demo
          </button>
        ) : (
          <button
            onClick={p.onDemo}
            disabled={live || busy}
            className="text-xs text-muted underline-offset-4 hover:underline disabled:opacity-40"
          >
            Simulate demo
          </button>
        )}
      </div>
    </div>
  );
}
