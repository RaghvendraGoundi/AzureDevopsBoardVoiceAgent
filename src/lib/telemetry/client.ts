"use client";

/**
 * Browser side of telemetry: events are queued and sent in batches (every few
 * seconds, and when the page is hidden), so recording never delays a call.
 * Each voice call gets a session id, which also tags its tool calls.
 */

type Event = { type: string; at: number; data?: Record<string, unknown> };

let sessionId: string | null = null;
let queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Starts a new telemetry session for a voice call and returns its id. */
export function newTelemetrySession(): string {
  sessionId = crypto.randomUUID();
  return sessionId;
}

export const currentTelemetrySession = () => sessionId;

export function track(type: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  queue.push({ type, at: Date.now(), data });
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(flush, 4000);
}

export function flush(useBeacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ sessionId, events: queue.splice(0, 100) });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/telemetry", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flush(true));
}
