"use client";

import { useEffect, useState } from "react";
import type { ToolStep } from "@/hooks/voice/workspaceReducer";
import { CheckIcon, CloseIcon } from "./icons";

/** After this long a step counts as slow: say so and offer to stop waiting. */
const SLOW_MS = 8_000;

const secs = (ms: number) => (ms < 1000 ? `${Math.max(0.1, ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);

/**
 * What the assistant is doing on the board right now, with a live timer, and
 * (in the workspace) the last few steps with how long each took. A slow step
 * gets "Taking longer than usual" and a Stop waiting button.
 */
export function ActivityStrip({ steps, variant, onStop }: { steps: ToolStep[]; variant: "stage" | "panel"; onStop?: () => void }) {
  const running = steps.filter((s) => s.endedAt === undefined);
  const done = steps.filter((s) => s.endedAt !== undefined).slice(-3).reverse();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running.length]);

  if (!running.length && (variant === "stage" || !done.length)) return null;
  const current = running[0];
  const elapsed = current ? now - current.startedAt : 0;
  const slow = elapsed >= SLOW_MS;
  // Stopping a confirmed write half-way would leave the user guessing; only reads and previews can be stopped.
  const stoppable = current && current.tool !== "confirm_action" && !!onStop;

  return (
    <div className={`activity ${variant} ${slow ? "slow" : ""}`} role="status" aria-live="polite">
      {current && (
        <div className="act-now">
          <span className="act-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="act-label">{current.label.replace(/…$/, "")}</span>
          <span className="act-time">{secs(elapsed)}</span>
          {running.length > 1 && <span className="act-more">+{running.length - 1} more</span>}
          {slow && <span className="act-slow">Taking longer than usual</span>}
          {slow && stoppable && (
            <button className="act-stop" onClick={onStop}>
              Stop waiting
            </button>
          )}
        </div>
      )}
      {variant === "panel" && done.length > 0 && (
        <ol className="act-done" aria-label="Recent steps">
          {done.map((s) => (
            <li key={s.callId} className={s.ok === false ? "bad" : ""}>
              {s.ok === false ? <CloseIcon size={13} /> : <CheckIcon size={13} />}
              <span className="truncate">{s.label.replace(/…$/, "")}</span>
              <span className="act-time">{secs((s.endedAt ?? now) - s.startedAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
