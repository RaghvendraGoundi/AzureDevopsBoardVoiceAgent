"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/types/voice";

/** What the orb is showing: each sets its spin, breathing, waves, swirl and tint. */
export type OrbState = "idle" | "listening" | "confirm" | "speaking" | "thinking";

export function orbStateFor(status: AgentStatus | "connecting", awaitingYes: boolean): OrbState {
  if (status === "speaking") return "speaking";
  if (awaitingYes && (status === "listening" || status === "idle")) return "confirm";
  if (status === "processing" || status === "connecting") return "thinking";
  if (status === "listening") return "listening";
  return "idle";
}

type RGB = [number, number, number];
const STEEL: RGB = [120, 150, 190];
const LIME: RGB = [185, 254, 111];
const SIGNAL: RGB = [255, 86, 0];

interface Params {
  /** Turns per second around the vertical axis, in radians. */
  spin: number;
  /** How much the sphere breathes on its own. */
  breathe: number;
  /** Ripples running over the surface, scaled by the audio level. */
  wave: number;
  /** Bands turning at different speeds (thinking). */
  swirl: number;
  /** Share of particles in the accent colour. */
  tintAmt: number;
  tint: RGB;
  /** Orbit ring speed. */
  ring: number;
}

const PARAMS: Record<OrbState, Params> = {
  idle: { spin: 0.12, breathe: 0.018, wave: 0, swirl: 0, tintAmt: 0, tint: STEEL, ring: 0.08 },
  listening: { spin: 0.24, breathe: 0.03, wave: 0.35, swirl: 0, tintAmt: 0.14, tint: LIME, ring: 0.22 },
  confirm: { spin: 0.2, breathe: 0.035, wave: 0, swirl: 0, tintAmt: 0.2, tint: SIGNAL, ring: 0.2 },
  speaking: { spin: 0.32, breathe: 0.02, wave: 1, swirl: 0, tintAmt: 0.24, tint: LIME, ring: 0.4 },
  thinking: { spin: 1.2, breathe: 0.012, wave: 0, swirl: 1, tintAmt: 0.06, tint: STEEL, ring: 1.1 },
};

const SPHERE = 1500;
const RING = 340;
const DUST = 160;
const TILT = -0.35; // the design's -20° tilt

interface Particle {
  /** Unit position on its shape. */
  x: number;
  y: number;
  z: number;
  kind: 0 | 1 | 2; // sphere, ring, dust
  size: number;
  phase: number;
  /** A stable random number deciding whether it takes the accent tint. */
  hash: number;
  /** Displacement from the cursor, in CSS px, and its velocity. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

function makeParticles(): Particle[] {
  const ps: Particle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SPHERE; i++) {
    const y = 1 - (i / (SPHERE - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    ps.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, kind: 0, size: 0.8 + Math.random() * 1.1, phase: Math.random() * 6.28, hash: Math.random(), ox: 0, oy: 0, vx: 0, vy: 0 });
  }
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    const rr = 1.32 + (Math.random() - 0.5) * 0.08;
    ps.push({ x: Math.cos(a) * rr, y: (Math.random() - 0.5) * 0.03, z: Math.sin(a) * rr, kind: 1, size: 0.7 + Math.random() * 0.9, phase: Math.random() * 6.28, hash: Math.random(), ox: 0, oy: 0, vx: 0, vy: 0 });
  }
  for (let i = 0; i < DUST; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const rr = 1.08 + Math.random() * 0.5;
    const s = Math.sqrt(1 - u * u);
    ps.push({ x: Math.cos(a) * s * rr, y: u * rr, z: Math.sin(a) * s * rr, kind: 2, size: 0.6 + Math.random() * 1.2, phase: Math.random() * 6.28, hash: Math.random(), ox: 0, oy: 0, vx: 0, vy: 0 });
  }
  return ps;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Props {
  state: OrbState;
  /** Live audio levels (0..1): your voice while listening, the assistant's while speaking. */
  levels: () => { input: number; output: number };
}

/**
 * The assistant's orb: a sphere of glowing particles with an orbit ring and
 * drifting dust. Particles move aside from the cursor and spring back; the
 * state sets how it turns, breathes, ripples and swirls.
 */
export function VoiceOrb({ state, levels }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particles = makeParticles();
    let w = 0;
    let dpr = 1;
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(w * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    // Pointer in CSS px relative to the box; null when it's away.
    let pointer: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => (pointer = null);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onMove);
    el.addEventListener("pointerleave", onLeave);

    // Smoothly blended parameters.
    const cur: Params = { ...PARAMS[stateRef.current], tint: [...PARAMS[stateRef.current].tint] as RGB };
    let yaw = 0;
    let ringYaw = 0;
    let level = 0;
    let last = performance.now();
    let t = 0;
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const target = PARAMS[stateRef.current];
      const k = 1 - Math.pow(0.04, dt); // ~1s blend
      cur.spin += (target.spin - cur.spin) * k;
      cur.breathe += (target.breathe - cur.breathe) * k;
      cur.wave += (target.wave - cur.wave) * k;
      cur.swirl += (target.swirl - cur.swirl) * k;
      cur.tintAmt += (target.tintAmt - cur.tintAmt) * k;
      cur.ring += (target.ring - cur.ring) * k;
      cur.tint = mix(cur.tint, target.tint, k);

      const { input, output } = levels();
      const s = stateRef.current;
      const want = s === "speaking" ? output : s === "listening" || s === "confirm" ? input : s === "thinking" ? 0.15 : 0;
      level += (Math.min(1, want * 1.6) - level) * (1 - Math.pow(0.001, dt));

      const motion = reduced ? 0.25 : 1;
      yaw += cur.spin * motion * dt * (1 + level * 0.6);
      ringYaw += cur.ring * motion * dt;

      const W = w * dpr;
      const c = W / 2;
      const R = W * 0.29;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, W);

      // Core glow.
      ctx.globalCompositeOperation = "source-over";
      const glow = ctx.createRadialGradient(c, c, 0, c, c, R * (1.05 + level * 0.25));
      glow.addColorStop(0, `rgba(235,245,255,${0.55 + level * 0.3})`);
      glow.addColorStop(0.18, `rgba(${STEEL.join(",")},${0.32 + level * 0.25})`);
      glow.addColorStop(0.6, `rgba(${STEEL.join(",")},0.08)`);
      glow.addColorStop(1, "rgba(120,150,190,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, W);

      // Outer tick ring.
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-yaw * 0.25);
      ctx.strokeStyle = `rgba(${STEEL.join(",")},0.28)`;
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([1.2 * dpr, 7 * dpr]);
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.globalCompositeOperation = "lighter";
      if (pointer && !reduced) {
        const px = pointer.x * dpr, py = pointer.y * dpr;
        const halo = ctx.createRadialGradient(px, py, 0, px, py, R * 0.8);
        halo.addColorStop(0, `rgba(${LIME.join(",")},0.10)`);
        halo.addColorStop(1, `rgba(${LIME.join(",")},0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(px - R, py - R, R * 2, R * 2);
      }
      const cy = Math.cos(TILT);
      const sy = Math.sin(TILT);
      const hoverR = R * 0.8;
      const breath = 1 + cur.breathe * Math.sin(t * 1.7);

      for (const p of particles) {
        let x: number, y: number, z: number;
        if (p.kind === 1) {
          // Ring: spin in its own plane, tilted well over towards the viewer.
          const ca = Math.cos(ringYaw), sa = Math.sin(ringYaw);
          const rx = p.x * ca - p.z * sa;
          const rz = p.x * sa + p.z * ca;
          const tilt = 1.22;
          x = rx;
          y = p.y * Math.cos(tilt) - rz * Math.sin(tilt);
          z = p.y * Math.sin(tilt) + rz * Math.cos(tilt);
          const zr = 0.2;
          const x2 = x * Math.cos(zr) - y * Math.sin(zr);
          y = x * Math.sin(zr) + y * Math.cos(zr);
          x = x2;
        } else {
          // Sphere and dust: turn around the vertical axis; thinking turns bands at different speeds.
          const a = yaw * (p.kind === 2 ? 0.5 : 1) + cur.swirl * Math.sin(p.y * 3 + t * 1.3) * 0.9;
          const ca = Math.cos(a), sa = Math.sin(a);
          let rad = breath;
          if (p.kind === 0) {
            rad += level * 0.1 + cur.wave * level * 0.16 * Math.sin(p.y * 7 - t * 7 + p.phase * 0.2);
            rad += 0.006 * Math.sin(t * 2 + p.phase);
          } else {
            rad += 0.05 * Math.sin(t * 0.6 + p.phase);
          }
          const rx = (p.x * ca - p.z * sa) * rad;
          const rz = (p.x * sa + p.z * ca) * rad;
          const ry = p.y * rad;
          x = rx;
          y = ry * cy - rz * sy;
          z = ry * sy + rz * cy;
        }

        const persp = 3.2 / (3.2 - z);
        let sx = c + x * R * persp;
        let sy2 = c + y * R * persp;

        // Cursor: push nearby particles away; they spring back on their own.
        // Measured from where the particle is now, so pushed particles part around the cursor
        // and swirl a little, like dust stirred by a hand.
        if (pointer && !reduced) {
          const dx = sx + p.ox - pointer.x * dpr;
          const dy = sy2 + p.oy - pointer.y * dpr;
          const d = Math.hypot(dx, dy);
          if (d < hoverR && d > 0.01) {
            const fall = 1 - d / hoverR;
            const f = fall * fall * 5 * dpr * (z > -0.3 ? 1 : 0.5);
            const swirl = fall * 1.6 * dpr * (p.hash < 0.5 ? 1 : -1);
            p.vx += (dx / d) * f - (dy / d) * swirl;
            p.vy += (dy / d) * f + (dx / d) * swirl;
          }
        }
        p.vx += -p.ox * 0.035;
        p.vy += -p.oy * 0.035;
        p.vx *= 0.88;
        p.vy *= 0.88;
        p.ox += p.vx;
        p.oy += p.vy;
        sx += p.ox;
        sy2 += p.oy;

        const depth = (z + 1.4) / 2.8; // 0 back .. 1 front
        const alpha = (p.kind === 2 ? 0.35 : 0.18) + depth * (p.kind === 2 ? 0.35 : 0.82);
        const disp = Math.min(1, Math.hypot(p.ox, p.oy) / (24 * dpr));
        // Stirred particles flare up: bigger and lime, fading back as they settle.
        const size = p.size * (0.55 + depth * 0.9) * (1 + disp * 0.7) * dpr;
        const tinted = p.hash < cur.tintAmt;
        const base = tinted ? cur.tint : mix(STEEL, [235, 245, 255], depth * 0.75);
        const col = disp > 0.05 ? mix(base, LIME, disp * 0.85) : base;
        ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${Math.min(1, alpha + disp * 0.3).toFixed(3)})`;
        ctx.fillRect(sx - size / 2, sy2 - size / 2, size, size);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [levels]);

  return (
    <div ref={box} className="relative aspect-square w-full" aria-hidden>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
