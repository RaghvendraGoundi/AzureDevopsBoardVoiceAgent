"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "@/hooks/voice/workspaceReducer";
import { TypeIcon } from "./icons";
import { StateBadge } from "./WorkItemCard";

const SHOW_MS = 4500;
const OUT_MS = 350;
const BURST = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  const r = 26 + (i % 3) * 8;
  return { dx: `${Math.cos(a) * r}px`, dy: `${Math.sin(a) * r}px` };
});

/**
 * A short celebration when the board changes: a check that draws itself
 * with a burst of particles for a new item, or the old state giving way to
 * the new one for a move. Shows for a few seconds after each confirmed change.
 */
export function ChangeToast({ activity }: { activity: ActivityEntry[] }) {
  const [shown, setShown] = useState<ActivityEntry | null>(null);
  const [leaving, setLeaving] = useState(false);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const latest = activity[0];
    if (!latest || latest.id === seen.current) return;
    seen.current = latest.id;
    // Only fresh changes, not ones loaded with a saved conversation.
    if (latest.kind === "cancelled" || Date.now() - latest.at > 5000) return;
    setShown(latest);
    setLeaving(false);
  }, [activity]);

  // Each toast hides itself; a newer change restarts the clock.
  useEffect(() => {
    if (!shown) return;
    const out = setTimeout(() => setLeaving(true), SHOW_MS);
    const gone = setTimeout(() => setShown(null), SHOW_MS + OUT_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [shown]);

  if (!shown) return null;
  const { item, before } = shown;
  const created = shown.kind === "created";
  const moved = !created && before && before.state !== item.state;
  const sprintMoved = !created && before && before.sprintName !== item.sprintName;
  const heading = created
    ? `${item.type} created`
    : moved
      ? `Moved to ${item.state}`
      : sprintMoved
        ? `Moved to ${item.sprintName ?? "the backlog"}`
        : `${item.type} updated`;

  return (
    <div
      key={shown.id}
      role="status"
      aria-live="polite"
      className={`toast panel hud ${leaving ? "out" : ""}`}
      style={{ ["--dur" as string]: `${SHOW_MS}ms` }}
    >
      <div className="flex items-start gap-4">
        <div className="burst relative grid size-12 shrink-0 place-items-center">
          <svg className="check-ring" width="48" height="48" viewBox="0 0 28 28" fill="none" aria-hidden>
            <circle cx="14" cy="14" r="12" stroke="#b9fe6f" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8.5 14.5l3.6 3.4 7.4-8" stroke="#b9fe6f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {BURST.map((b, i) => (
            <i key={i} style={{ ["--dx" as string]: b.dx, ["--dy" as string]: b.dy }} />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="disp text-[15px] font-semibold text-white">{heading}</p>
          <p className="meta mt-1">
            <span className="tg">
              <TypeIcon type={item.type} />
              {item.type}
            </span>
            {item.id ? <span>#{item.id}</span> : null}
          </p>
          <p className="ttl mt-1! mb-0! truncate text-[15px]!">{item.title}</p>
          {created && (
            <p className="sub2 mt-1 truncate">
              {item.sprintName ?? "Backlog"}
              {item.parentId ? ` · under #${item.parentId} ${item.parentTitle ?? ""}` : ""}
            </p>
          )}
          {moved && before && (
            <p className="mt-2.5 flex items-center gap-2.5">
              <span className="pill-old">
                <StateBadge state={before.state} category={before.stateCategory} />
              </span>
              <span className="flowline sm" aria-label="to" />
              <span className="pill-in [animation-delay:0.55s]">
                <StateBadge state={item.state} category={item.stateCategory} />
              </span>
            </p>
          )}
          {sprintMoved && before && !moved && (
            <p className="sub2 mt-1.5">
              {before.sprintName ?? "Backlog"} → <span className="text-white">{item.sprintName ?? "Backlog"}</span>
            </p>
          )}
        </div>
      </div>
      <div className="toast-progress" />
    </div>
  );
}
