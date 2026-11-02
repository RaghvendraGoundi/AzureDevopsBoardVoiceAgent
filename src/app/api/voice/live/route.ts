import { NextResponse } from "next/server";
import { resumeHistory } from "@/lib/conversations/resume";
import { boardBriefing } from "@/lib/devops/briefing";
import { getPrincipal } from "@/lib/auth/principal";
import { AzureTokenError } from "@/lib/azure/credential";
import { accessNote } from "@/lib/devops/policy";
import { buildLiveSession } from "@/lib/voice/liveConfig";
import { credentialProblem, fetchWithRetry, ProviderConfigError, resolveProvider } from "@/lib/voice/providers";
import { pickVoice } from "@/lib/voice/voices";

export const dynamic = "force-dynamic";

/**
 * Starts a GPT-Live call on OpenAI or Azure AI Foundry (LIVE_PROVIDER).
 * Unlike Realtime there is no ephemeral key: the browser sends its SDP offer
 * here, and the server starts the session with its own credential (API key
 * or managed identity) and returns the SDP answer.
 */
export async function POST(req: Request) {
  let provider;
  try {
    provider = resolveProvider(process.env, "live");
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      return NextResponse.json({ error: `GPT-Live is not configured: ${err.message}` }, { status: 500 });
    }
    throw err;
  }

  const { sdp, conversationId, voice } = (await req.json().catch(() => ({}))) as { sdp?: unknown; conversationId?: unknown; voice?: unknown };
  if (typeof sdp !== "string" || !sdp.startsWith("v=")) {
    return NextResponse.json({ error: "Missing SDP offer." }, { status: 400 });
  }

  let authHeaders: Record<string, string>;
  try {
    authHeaders = await provider.getAuthHeaders();
  } catch (err) {
    if (!(err instanceof AzureTokenError)) throw err;
    console.error("[voice/live]", err.message);
    return NextResponse.json({ error: "The server couldn't authenticate to Azure AI Foundry. Check its managed identity." }, { status: 502 });
  }

  const [briefing, history, principal] = await Promise.all([boardBriefing(req.headers), resumeHistory(req.headers, conversationId), getPrincipal(req.headers)]);
  const summary = [briefing.summary, accessNote(principal?.role ?? "user")].filter(Boolean).join("\n");
  const session = buildLiveSession(briefing.userName, process.env, summary, history, pickVoice("live", voice, process.env.LIVE_VOICE), provider.model);
  const started = performance.now();
  const res = await fetchWithRetry(provider.liveSessionsUrl, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ session, transport: { type: "webrtc", sdp } }),
  }, 15_000).catch((err: unknown) => {
    console.error(`[voice/live] unreachable after ${Math.round(performance.now() - started)}ms`, err instanceof Error ? err.name : err);
    return null;
  });

  if (!res) return NextResponse.json({ error: "Couldn't reach the GPT-Live service (timed out). Check the network or proxy.", stage: "mint" }, { status: 504 });
  if (!res.ok) {
    console.error(`[voice/live] ${res.status}: ${(await res.text()).replace(/sk-[A-Za-z0-9_*-]+/g, "sk-…").slice(0, 500)}`);
    return NextResponse.json({ error: credentialProblem(provider, res.status) ?? `GPT-Live rejected the session request (${res.status}).` }, { status: 502 });
  }

  const data = (await res.json()) as { session?: { id?: string }; transport?: { sdp?: string } };
  if (!data.transport?.sdp) return NextResponse.json({ error: "GPT-Live returned no SDP answer." }, { status: 502 });
  return NextResponse.json({ sessionId: data.session?.id ?? null, sdp: data.transport.sdp });
}
