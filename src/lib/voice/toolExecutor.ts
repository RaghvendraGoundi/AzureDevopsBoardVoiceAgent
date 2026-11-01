import type { ToolResponse } from "@/types/voice";
import type { SessionCredentials } from "./realtimeClient";

async function postJson(url: string, body: unknown): Promise<ToolResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as ToolResponse;
}

/** Forwards a model function call to the backend, which validates and executes it. */
export function executeToolRemote(name: string, args: unknown) {
  return postJson("/api/voice/tools", { name, args });
}

/** On-screen Confirm / Cancel. */
export function resolveActionRemote(actionId: string, decision: "confirm" | "cancel") {
  return postJson("/api/voice/actions", { actionId, decision });
}

/** Mints a session key; with a conversation id the session picks up that conversation's earlier turns. */
export async function fetchSessionCredentials(conversationId?: string | null, voice?: string | null): Promise<SessionCredentials> {
  const res = await fetch("/api/voice/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: conversationId ?? null, voice: voice ?? null }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    clientSecret?: string;
    webrtcUrl?: string;
    turnDetection?: Record<string, unknown>;
    speakingTurnDetection?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok || !data.clientSecret || !data.webrtcUrl) {
    throw new Error(data.error ?? "Couldn't start a voice session.");
  }
  return {
    clientSecret: data.clientSecret,
    webrtcUrl: data.webrtcUrl,
    turnDetection: data.turnDetection ?? null,
    speakingTurnDetection: data.speakingTurnDetection ?? null,
  };
}
