import { NextResponse } from "next/server";
import { resumeHistory } from "@/lib/conversations/resume";
import { boardBriefing } from "@/lib/devops/briefing";
import { getPrincipal } from "@/lib/auth/principal";
import { AzureTokenError } from "@/lib/azure/credential";
import { accessNote } from "@/lib/devops/policy";
import { credentialProblem, fetchWithRetry, ProviderConfigError, resolveProvider } from "@/lib/voice/providers";
import { buildSessionConfig, buildSpeakingTurnDetection, buildTurnDetection } from "@/lib/voice/sessionConfig";
import { pickVoice } from "@/lib/voice/voices";

export const dynamic = "force-dynamic";

/** Mints a short-lived client secret so the browser can open a WebRTC call without the real API key. */
export async function POST(req: Request) {
  let provider;
  try {
    provider = resolveProvider();
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      return NextResponse.json({ error: `Voice provider is not configured: ${err.message}` }, { status: 500 });
    }
    throw err;
  }

  // Also warms the board caches while the call connects. Current item titles
  // help the transcriber hear names like "rate limiting" correctly.
  const { conversationId, voice } = (await req.json().catch(() => ({}))) as { conversationId?: unknown; voice?: unknown };
  const [briefing, history, principal] = await Promise.all([boardBriefing(req.headers), resumeHistory(req.headers, conversationId), getPrincipal(req.headers)]);
  const session = buildSessionConfig({
    model: provider.model,
    transcriptionModel: provider.transcriptionModel,
    currentUser: briefing.userName,
    boardSummary: [briefing.summary, accessNote(principal?.role ?? "user")].filter(Boolean).join("\n"),
    keywords: briefing.keywords,
    history,
    voice: pickVoice("realtime", voice, process.env.REALTIME_VOICE),
  });

  let authHeaders: Record<string, string>;
  try {
    authHeaders = await provider.getAuthHeaders();
  } catch (err) {
    if (!(err instanceof AzureTokenError)) throw err;
    console.error("[voice/session]", err.message);
    return NextResponse.json({ error: "The server couldn't authenticate to Azure AI Foundry. Check its managed identity." }, { status: 502 });
  }
  const started = performance.now();
  const res = await fetchWithRetry(provider.clientSecretUrl, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session,
    }),
  }).catch((err: unknown) => {
    console.error(`[voice/session] ${provider.name} unreachable after ${Math.round(performance.now() - started)}ms`, err instanceof Error ? err.name : err);
    return null;
  });

  if (!res) {
    return NextResponse.json(
      { error: `Couldn't reach the ${provider.name === "azure" ? "Azure AI Foundry" : "OpenAI"} Realtime service (timed out). Check the network or proxy.`, stage: "mint" },
      { status: 504 },
    );
  }
  if (!res.ok) {
    const detail = (await res.text()).replace(/sk-[A-Za-z0-9_*-]+/g, "sk-…").slice(0, 500);
    console.error(`[voice/session] ${provider.name} ${res.status}: ${detail}`);
    return NextResponse.json(
      { error: credentialProblem(provider, res.status) ?? `${provider.name} rejected the session request (${res.status}).`, stage: "mint" },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { value?: string; expires_at?: number };
  if (!data.value) {
    return NextResponse.json({ error: "Realtime service returned no client secret." }, { status: 502 });
  }
  return NextResponse.json({
    provider: provider.name,
    clientSecret: data.value,
    webrtcUrl: provider.webrtcUrl,
    // Lets the browser restore hands-free mode after push-to-talk.
    turnDetection: buildTurnDetection(),
    speakingTurnDetection: buildSpeakingTurnDetection(),
    expiresAt: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null,
  });
}
