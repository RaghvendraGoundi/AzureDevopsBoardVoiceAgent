import { NextResponse } from "next/server";
import { resumeHistory } from "@/lib/conversations/resume";
import { boardBriefing } from "@/lib/devops/briefing";
import { buildLiveSession, LIVE_SESSIONS_URL } from "@/lib/voice/liveConfig";
import { pickVoice } from "@/lib/voice/voices";

export const dynamic = "force-dynamic";

/**
 * Starts a GPT-Live call. Unlike Realtime there is no ephemeral key: the
 * browser sends its SDP offer here, and the server starts the session with
 * the real API key and returns the SDP answer.
 */
export async function POST(req: Request) {
  if ((process.env.VOICE_PROVIDER?.trim().toLowerCase() || "openai") !== "openai") {
    return NextResponse.json({ error: "GPT-Live is only available with the OpenAI provider." }, { status: 400 });
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "Missing environment variable OPENAI_API_KEY." }, { status: 500 });

  const { sdp, conversationId, voice } = (await req.json().catch(() => ({}))) as { sdp?: unknown; conversationId?: unknown; voice?: unknown };
  if (typeof sdp !== "string" || !sdp.startsWith("v=")) {
    return NextResponse.json({ error: "Missing SDP offer." }, { status: 400 });
  }

  const [briefing, history] = await Promise.all([boardBriefing(req.headers), resumeHistory(req.headers, conversationId)]);
  const res = await fetch(LIVE_SESSIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: buildLiveSession(briefing.userName, process.env, briefing.summary, history, pickVoice("live", voice, process.env.LIVE_VOICE)),
      transport: { type: "webrtc", sdp },
    }),
    cache: "no-store",
  }).catch((err: unknown) => {
    console.error("[voice/live] network error", err);
    return null;
  });

  if (!res) return NextResponse.json({ error: "Could not reach the GPT-Live service." }, { status: 502 });
  if (!res.ok) {
    console.error(`[voice/live] ${res.status}: ${await res.text()}`);
    return NextResponse.json({ error: `GPT-Live rejected the session request (${res.status}).` }, { status: 502 });
  }

  const data = (await res.json()) as { session?: { id?: string }; transport?: { sdp?: string } };
  if (!data.transport?.sdp) return NextResponse.json({ error: "GPT-Live returned no SDP answer." }, { status: 502 });
  return NextResponse.json({ sessionId: data.session?.id ?? null, sdp: data.transport.sdp });
}
