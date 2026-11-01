"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { voicesFor, type VoiceEngineId } from "@/lib/voice/voices";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ReplayIcon } from "./icons";
import { VoiceOrb } from "./VoiceOrb";

interface Props {
  engine: VoiceEngineId;
  /** The saved voice for each model (null: the default, Marin). */
  voices: Record<VoiceEngineId, string | null>;
  /** A call is running: the model and voice can't change until it ends. */
  locked: boolean;
  onConfirm: (engine: VoiceEngineId, voice: string) => void;
  onClose: () => void;
}

const MODELS: Array<{ id: VoiceEngineId; name: string; model: string; blurb: string }> = [
  { id: "realtime", name: "Realtime", model: "gpt-realtime-2.1", blurb: "Fastest on the board. You can also type." },
  { id: "live", name: "GPT-Live", model: "gpt-live-1", blurb: "Most natural. Talks and listens at once." },
];

/**
 * Choose the model and the voice, hearing each voice as you go: arrows,
 * swipes or the arrow keys move between voices and play a short greeting
 * while the orb moves with it.
 */
export function VoicePicker({ engine: initialEngine, voices, locked, onConfirm, onClose }: Props) {
  const [engine, setEngine] = useState<VoiceEngineId>(initialEngine);
  const list = voicesFor(engine);
  const startIndex = (e: VoiceEngineId) => Math.max(0, voicesFor(e).findIndex((v) => v.id === (voices[e] ?? "marin")));
  const [index, setIndex] = useState(() => startIndex(initialEngine));
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const voice = list[index];

  // One audio element for previews, metered so the orb can follow the voice.
  const audio = useRef<HTMLAudioElement | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef(new Uint8Array(256));
  const ensureAudio = useCallback(() => {
    if (audio.current) return audio.current;
    const el = new Audio();
    el.crossOrigin = "anonymous";
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

  // Hear each voice as it comes up (opening the picker was a click, so playback is allowed).
  // Not during a call, where the mic would pick it up: there you press Play.
  useEffect(() => {
    if (voice && !locked) play(engine, voice.id);
    else audio.current?.pause();
  }, [engine, voice, play, locked]);

  useEffect(
    () => () => {
      audio.current?.pause();
      void (analyser.current?.context as AudioContext | undefined)?.close();
    },
    [],
  );

  const move = useCallback((step: number) => setIndex((i) => (i + step + list.length) % list.length), [list.length]);
  const switchModel = (e: VoiceEngineId) => {
    if (e === engine || locked) return;
    setEngine(e);
    setIndex(startIndex(e));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, onClose]);

  // Swipe between voices on touch screens.
  const swipe = useRef<number | null>(null);

  return (
    <div className="picker-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker panel hud" role="dialog" aria-modal="true" aria-label="Choose model and voice">
        <div className="sheen" />
        <div className="relative z-[1] flex h-full flex-col">
          <div className="flex items-center justify-between px-6 pt-5">
            <div>
              <p className="lab">Assistant</p>
              <h2 className="disp text-[19px] font-bold">Model and voice</h2>
            </div>
            <button className="ibtn" onClick={onClose} aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>

          <div role="radiogroup" aria-label="Model" className="mx-6 mt-4 grid grid-cols-2 gap-2">
            {MODELS.map((m) => (
              <button key={m.id} role="radio" aria-checked={engine === m.id} className="modelcard" onClick={() => switchModel(m.id)} disabled={locked && engine !== m.id}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="disp text-[15px] font-bold">{m.name}</span>
                  <span className="mono text-[10px] text-muted">{m.model}</span>
                </span>
                <span className="sub2 text-[12.5px]!">{m.blurb}</span>
              </button>
            ))}
          </div>
          {locked && <p className="sub2 mx-6 mt-2 text-xs!">End the call to change the model or voice. You can still listen.</p>}

          <div
            className="relative mt-2 flex flex-1 touch-pan-y flex-col items-center justify-center px-6"
            onPointerDown={(e) => (swipe.current = e.clientX)}
            onPointerUp={(e) => {
              if (swipe.current === null) return;
              const dx = e.clientX - swipe.current;
              swipe.current = null;
              if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
            }}
          >
            <button className="ibtn lg picker-arrow left-4" onClick={() => move(-1)} aria-label="Previous voice">
              <ChevronLeftIcon size={20} />
            </button>
            <button className="ibtn lg picker-arrow right-4" onClick={() => move(1)} aria-label="Next voice">
              <ChevronRightIcon size={20} />
            </button>

            <div className="w-[min(260px,62vw)]">
              <VoiceOrb state={playing ? "speaking" : "idle"} levels={levels} />
            </div>
            <div key={`${engine}-${voice.id}`} className="voice-name text-center" aria-live="polite">
              <h3 className="serif text-[40px] leading-none">{voice.label}</h3>
              <p className="sub2 mt-2">{voice.detail}</p>
            </div>
            <button className="pill sm mt-4" onClick={() => play(engine, voice.id)} aria-label={`Play ${voice.label} again`}>
              <ReplayIcon size={15} />
              {playing ? "Playing…" : locked ? "Play sample" : "Play again"}
            </button>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5" aria-hidden>
              {list.map((v, i) => (
                <i key={v.id} className={`pdot ${i === index ? "on" : ""}`} onClick={() => setIndex(i)} />
              ))}
            </div>
          </div>

          <div className="flex gap-3 px-6 pt-2 pb-6">
            <button className="pill lg flex-1" onClick={onClose}>
              Cancel
            </button>
            <button className="pill pri lg flex-[1.4]" disabled={locked} onClick={() => onConfirm(engine, voice.id)}>
              Use {voice.label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
