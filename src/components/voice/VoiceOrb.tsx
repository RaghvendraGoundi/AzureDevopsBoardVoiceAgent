"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/types/voice";

const COLORS: Record<AgentStatus, string> = {
  idle: "#3b4256",
  connecting: "#64748b",
  listening: "var(--color-listen)",
  processing: "var(--color-think)",
  speaking: "var(--color-speak)",
  error: "var(--color-danger)",
};

interface Props {
  status: AgentStatus;
  /** Live audio levels (0..1); polled every frame. */
  levels: () => { input: number; output: number };
}

export function VoiceOrb({ status, levels }: Props) {
  const coreRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);

  // Drive scale from audio level without re-rendering React every frame.
  useEffect(() => {
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      const { input, output } = levels();
      const target = status === "speaking" ? output : status === "listening" ? input : 0;
      smoothed += (target - smoothed) * 0.25;
      if (coreRef.current) coreRef.current.style.transform = `scale(${1 + smoothed * 0.18})`;
      if (haloRef.current) {
        haloRef.current.style.transform = `scale(${1.05 + smoothed * 0.45})`;
        haloRef.current.style.opacity = String(0.25 + smoothed * 0.6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levels, status]);

  const color = COLORS[status];
  const active = status !== "idle";

  return (
    <div className="relative grid size-48 place-items-center sm:size-56" role="img" aria-label={`Assistant is ${status}`}>
      <div
        ref={haloRef}
        className="absolute inset-0 rounded-full blur-2xl transition-colors duration-500"
        style={{ background: color, opacity: active ? 0.3 : 0.12 }}
      />
      {status === "processing" || status === "connecting" ? (
        <div
          className="absolute inset-2 rounded-full border-2 border-transparent"
          style={{ borderTopColor: color, borderRightColor: color, animation: "orb-spin 1.1s linear infinite" }}
        />
      ) : null}
      <div
        ref={coreRef}
        className="relative size-32 rounded-full transition-[background] duration-500 sm:size-40"
        style={{
          background: `radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.55), transparent 45%), radial-gradient(circle at 50% 60%, ${color}, #0b0d12 85%)`,
          boxShadow: `0 0 60px -10px ${color}, inset 0 0 30px rgb(0 0 0 / 0.5)`,
          animation: status === "idle" || status === "error" ? "orb-breathe 4s ease-in-out infinite" : undefined,
        }}
      />
    </div>
  );
}
