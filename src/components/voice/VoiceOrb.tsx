"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/types/voice";
import { ORB_MARKUP } from "./orbMarkup";

/** The design's orb states: each sets the globe speed, bars, ripples, sweep and particles. */
export type OrbState = "idle" | "listening" | "confirm" | "speaking" | "thinking";

export function orbStateFor(status: AgentStatus | "connecting", awaitingYes: boolean): OrbState {
  if (status === "speaking") return "speaking";
  if (awaitingYes && (status === "listening" || status === "idle")) return "confirm";
  if (status === "processing" || status === "connecting") return "thinking";
  if (status === "listening") return awaitingYes ? "confirm" : "listening";
  return "idle";
}

const DESIGN_SIZE = 440;

interface Props {
  state: OrbState;
  /** Live audio levels (0..1); the orb swells slightly with your voice or the assistant's. */
  levels: () => { input: number; output: number };
}

/**
 * The variant B orb, rendered from the design's own markup at its native
 * 440px and scaled to fit the space it's given.
 */
export function VoiceOrb({ state, levels }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);

  // Fit the 440px design into the box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const s = el.clientWidth / DESIGN_SIZE;
      if (stage.current) stage.current.style.transform = `scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A gentle swell with the live audio, without re-rendering React every frame.
  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const { input, output } = levels();
      const target = state === "speaking" ? output : state === "listening" || state === "confirm" ? input : 0;
      smoothed += (target - smoothed) * 0.2;
      if (orb.current) orb.current.style.transform = `scale(${(1 + smoothed * 0.06).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levels, state]);

  return (
    <div ref={box} className="relative aspect-square w-full" aria-hidden>
      <div ref={stage} className="stage absolute top-0 left-0 origin-top-left" style={{ width: DESIGN_SIZE, height: DESIGN_SIZE }}>
        <div ref={orb} className={`orb st-${state}`} dangerouslySetInnerHTML={{ __html: ORB_MARKUP }} />
      </div>
    </div>
  );
}
