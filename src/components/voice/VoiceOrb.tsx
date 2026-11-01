"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/types/voice";

interface Props {
  status: AgentStatus;
  /** Live audio levels (0..1); polled every frame. */
  levels: () => { input: number; output: number };
}

const MERIDIANS = [0, 30, 60, 90, 120, 150];
const PARALLELS = [-0.6, -0.3, 0, 0.3, 0.6];

// 56 bars around the globe; each reacts a little differently to the level.
const BARS = Array.from({ length: 56 }, (_, i) => {
  const wave = Math.sin(i * 0.9) * 0.5 + Math.sin(i * 0.37 + 1) * 0.5;
  return { angle: (360 / 56) * i, height: 18 + Math.round(Math.abs(wave) * 22), gain: 0.9 + Math.abs(wave) * 1.6 };
});

/**
 * The assistant's orb: a turning wireframe globe with a glowing core, and
 * a ring of bars that follows the live audio (your voice while listening,
 * the assistant's while speaking). Colour comes from the scene's tone.
 */
export function VoiceOrb({ status, levels }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Drive the level through a CSS variable so React doesn't re-render every frame.
  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const { input, output } = levels();
      const target = status === "speaking" ? output : status === "listening" ? input : status === "processing" ? 0.18 : 0;
      smoothed += (target - smoothed) * 0.22;
      ref.current?.style.setProperty("--lvl", smoothed.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levels, status]);

  return (
    <div ref={ref} className="orb" data-state={status} aria-hidden>
      <div className="orb-glow" />
      <div className="orb-rip" />
      <div className="orb-rip" />
      <div className="orb-tilt">
        <div className="orb-gim" />
        <div className="orb-globe">
          {MERIDIANS.map((deg) => (
            <i key={`m${deg}`} style={{ transform: `rotateY(${deg}deg)` }} />
          ))}
          {PARALLELS.map((p) => (
            <i
              key={`p${p}`}
              style={{
                transform: `rotateX(90deg) translateZ(calc(var(--orb) * 0.28 * ${p})) scale(${Math.sqrt(1 - p * p).toFixed(3)})`,
                borderColor: "rgba(var(--c), 0.3)",
              }}
            />
          ))}
        </div>
      </div>
      <div className="orb-core" />
      <div className="orb-bars">
        {BARS.map((b) => (
          <b key={b.angle} style={{ ["--a" as string]: `${b.angle}deg`, ["--h" as string]: `${b.height}px`, ["--k" as string]: b.gain.toFixed(2) }}>
            <i />
          </b>
        ))}
      </div>
    </div>
  );
}
