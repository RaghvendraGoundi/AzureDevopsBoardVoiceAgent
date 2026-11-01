"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InputMode } from "@/lib/voice/realtimeClient";
import { voicesFor, type VoiceEngineId } from "@/lib/voice/voices";
import { CheckIcon, CloseIcon, KeyboardIcon, MicIcon, WaveIcon } from "./icons";
import { VoiceOrb } from "./VoiceOrb";

interface Props {
  engine: VoiceEngineId;
  /** The saved voice for each model (null: the default, Marin). */
  voices: Record<VoiceEngineId, string | null>;
  mode: InputMode;
  /** A call is running: the model and voice can't change until it ends. */
  locked: boolean;
  onConfirm: (engine: VoiceEngineId, voice: string, mode: InputMode) => void;
  onClose: () => void;
}

const ENGINES: Array<{ id: VoiceEngineId; name: string; model: string; blurb: string; points: string[] }> = [
  {
    id: "realtime",
    name: "Realtime",
    model: "gpt-realtime-2.1",
    blurb: "Quick and precise: best for getting board work done.",
    points: ["Fastest replies and board changes", "Talk or type; hands-free or push to talk", "Waits for you to finish, then answers"],
  },
  {
    id: "live",
    name: "GPT-Live",
    model: "gpt-live-1",
    blurb: "A natural, two-way conversation.",
    points: ["Listens while it talks, so you can cut in", "More voices, with regional accents", "Hands board work to a reasoning model, a moment slower"],
  },
];

const Play = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M7 5v14l12-7z" fill="currentColor" />
  </svg>
);

const Eq = ({ bars = 3 }: { bars?: number }) => (
  <span className="eqb" aria-hidden>
    {Array.from({ length: bars }, (_, i) => (
      <u key={i} />
    ))}
  </span>
);

const BothWays = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 7h12l-3-3M17 17H5l3 3" />
  </svg>
);

/**
 * Choose the engine, the voice and how you talk. Picking a voice plays a
 * short greeting in it; the preview's orb moves with the sample.
 */
export function VoicePicker({ engine: initialEngine, voices, mode: initialMode, locked, onConfirm, onClose }: Props) {
  const [engine, setEngine] = useState<VoiceEngineId>(initialEngine);
  const [mode, setMode] = useState<InputMode>(initialMode);
  const list = voicesFor(engine);
  const savedId = (e: VoiceEngineId) => voices[e] ?? "marin";
  const [voiceId, setVoiceId] = useState(() => savedId(initialEngine));
  const voice = list.find((v) => v.id === voiceId) ?? list[0];
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

  // One audio element for previews, metered so the orb can follow the voice.
  const audio = useRef<HTMLAudioElement | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef(new Uint8Array(256));
  const ensureAudio = useCallback(() => {
    if (audio.current) return audio.current;
    const el = new Audio();
    el.onplaying = () => setPlaying(true);
    const stopped = () => setPlaying(false);
    el.onended = stopped;
    el.onpause = stopped;
    el.onerror = stopped;
    try {
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      ctx.createMediaElementSource(el).connect(node);
      node.connect(ctx.destination);
      analyser.current = node;
    } catch {
      // No metering; the preview still plays.
    }
    audio.current = el;
    return el;
  }, []);

  const levels = useCallback(() => {
    const node = analyser.current;
    if (!node || !playingRef.current) return { input: 0, output: 0 };
    node.getByteTimeDomainData(buf.current);
    let sum = 0;
    for (const v of buf.current) sum += ((v - 128) / 128) ** 2;
    return { input: 0, output: Math.min(1, Math.sqrt(sum / buf.current.length) * 4) };
  }, []);

  const play = useCallback(
    (e: VoiceEngineId, id: string) => {
      const el = ensureAudio();
      el.pause();
      el.src = `/voices/${e}/${id}.m4a`;
      el.currentTime = 0;
      void (analyser.current?.context as AudioContext | undefined)?.resume();
      el.play().catch(() => setPlaying(false));
    },
    [ensureAudio],
  );

  useEffect(
    () => () => {
      audio.current?.pause();
      void (analyser.current?.context as AudioContext | undefined)?.close();
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickVoice = (id: string) => {
    setVoiceId(id);
    // During a call the mic would pick the sample up, so there it plays only on a second tap.
    if (!locked || id === voiceId) play(engine, id);
  };
  const pickEngine = (e: VoiceEngineId) => {
    if (e === engine || locked) return;
    audio.current?.pause();
    setEngine(e);
    setVoiceId(savedId(e));
  };

  const engineName = ENGINES.find((x) => x.id === engine)!.name;
  const talkName = mode === "ptt" ? "Push to talk" : "Hands-free";

  return (
    <div className="picker-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <div className="pk-head">
          <div>
            <p className="lab">Assistant</p>
            <h2 id="picker-title" className="serif">
              Engine &amp; voice
            </h2>
          </div>
          <button className="ibtn lg" onClick={onClose} aria-label="Close">
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="pk-engines" role="radiogroup" aria-label="Engine">
          {ENGINES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={engine === m.id}
              className="ecard"
              onClick={() => pickEngine(m.id)}
              disabled={locked && engine !== m.id}
            >
              <span className="eic">{m.id === "realtime" ? <WaveIcon size={22} /> : <BothWays />}</span>
              <span className="min-w-0">
                <span className="et">
                  <b>{m.name}</b>
                  <code>{m.model}</code>
                </span>
                <span className="ed">{m.blurb}</span>
                <ul className="epts">
                  {m.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </span>
              <span className="ck" aria-hidden>
                <CheckIcon size={14} />
              </span>
            </button>
          ))}
        </div>
        {locked && <p className="sub2 px-9 pt-2 text-xs!">End the call to change the engine, voice or how you talk. You can still listen.</p>}

        <div className="pk-body">
          <div className="min-w-0">
            <div className="pk-sec">
              <b>Voice</b>
              <span>{list.length} voices · tap to preview</span>
            </div>
            <div role="radiogroup" aria-label="Voice" className="vgrid" style={{ gridTemplateRows: `repeat(${Math.ceil(list.length / 2)}, 60px)` }}>
              {list.map((v) => {
                const on = v.id === voice.id;
                return (
                  <button key={v.id} role="radio" aria-checked={on} className="vrow" onClick={() => pickVoice(v.id)}>
                    <span className="vav">{on && playing ? <Eq /> : on ? <CheckIcon size={16} /> : <Play />}</span>
                    <span className="min-w-0">
                      <span className="vn">{v.label}</span>
                      <span className="vt">{v.detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pk-side">
            <div className="pv">
              <div className={`morb ${playing ? "pl" : ""}`}>
                <VoiceOrb state={playing ? "speaking" : "idle"} levels={levels} />
              </div>
              <div className="min-w-0">
                <p key={`${engine}-${voice.id}`} className="pn serif voice-name">
                  {voice.label}
                </p>
                <p className="pt">{voice.detail}</p>
                <button className="play" onClick={() => (playing ? audio.current?.pause() : play(engine, voice.id))}>
                  {playing ? (
                    <>
                      <Eq bars={4} />
                      Playing…
                    </>
                  ) : (
                    <>
                      <Play />
                      Play sample
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <div className="pk-sec">
                <b>How you talk</b>
              </div>
              {engine === "realtime" ? (
                <div role="radiogroup" aria-label="How you talk" className="flex flex-col gap-2.5">
                  <button role="radio" aria-checked={mode === "handsfree"} className="mopt" onClick={() => setMode("handsfree")} disabled={locked}>
                    <span className="mic">
                      <MicIcon size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="mt">Hands-free</span>
                      <span className="md">Speak freely. I reply when you pause.</span>
                    </span>
                    <span className="rd" aria-hidden />
                  </button>
                  <button role="radio" aria-checked={mode === "ptt"} className="mopt" onClick={() => setMode("ptt")} disabled={locked}>
                    <span className="mic">
                      <KeyboardIcon size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="mt">Push to talk</span>
                      <span className="md">
                        Hold <kbd>SPACE</kbd> to talk, release to send.
                      </span>
                    </span>
                    <span className="rd" aria-hidden />
                  </button>
                </div>
              ) : (
                <div className="pk-note">
                  <span className="mic on">
                    <BothWays size={20} />
                  </span>
                  <span>
                    <span className="mt">Always on, both ways</span>
                    <span className="md">I listen while I talk, so you can cut in like a normal conversation. No modes to pick.</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pk-foot">
          <div className="sum">
            <b>{engineName}</b>
            <s />
            <span>{voice.label}</span>
            {engine === "realtime" && (
              <>
                <s />
                <span>{talkName}</span>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button className="pill lg" onClick={onClose}>
              Cancel
            </button>
            <button className="pill pri lg" disabled={locked} onClick={() => onConfirm(engine, voice.id, mode)}>
              Use {voice.label}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
