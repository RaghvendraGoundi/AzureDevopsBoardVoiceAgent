import { COGNITIVE_SERVICES_SCOPE, getAzureToken } from "@/lib/azure/credential";

/**
 * Voice model providers. OpenAI and Azure AI Foundry (Azure OpenAI) speak the
 * same Realtime and GPT-Live protocols; they differ in hosts, model naming
 * and how the server authenticates:
 *
 * - openai: an OpenAI API key.
 * - azure + api-key: a Foundry resource key.
 * - azure + managed-identity: an Entra token from the app's managed identity
 *   (role "Cognitive Services OpenAI User" on the Foundry resource).
 *
 * Server-only. The browser never gets these credentials: it receives a
 * short-lived Realtime client secret, or talks to GPT-Live through the server.
 */

export type VoiceProviderName = "openai" | "azure";
export type ProviderAuth = "api-key" | "managed-identity";

export interface ProviderConfig {
  name: VoiceProviderName;
  auth: ProviderAuth;
  /** Where the server mints an ephemeral Realtime client secret. */
  clientSecretUrl: string;
  /** Where the browser POSTs its SDP offer using the ephemeral secret. */
  webrtcUrl: string;
  /** Where the server starts a GPT-Live session. */
  liveSessionsUrl: string;
  /** The model (OpenAI) or deployment name (Azure) for this purpose: Realtime, or GPT-Live. */
  model: string;
  /** Model used to transcribe the user's speech for the on-screen transcript. */
  transcriptionModel: string;
  /** Headers carrying the server's credential; resolved per request so tokens stay fresh. */
  getAuthHeaders(): Promise<Record<string, string>>;
}

export class ProviderConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ProviderConfigError(`Missing environment variable ${name}.`);
  return value;
}

/**
 * The provider for Realtime calls (VOICE_PROVIDER), or for GPT-Live calls
 * (LIVE_PROVIDER, defaulting to the same), so the two can be hosted apart.
 */
export function resolveProvider(env = process.env, purpose: "realtime" | "live" = "realtime"): ProviderConfig {
  const picked = purpose === "live" ? env.LIVE_PROVIDER?.trim() || env.VOICE_PROVIDER : env.VOICE_PROVIDER;
  const name = (picked?.trim().toLowerCase() || "openai") as VoiceProviderName;

  if (name === "openai") {
    const key = required(env, "OPENAI_API_KEY");
    return {
      name,
      auth: "api-key",
      clientSecretUrl: "https://api.openai.com/v1/realtime/client_secrets",
      webrtcUrl: "https://api.openai.com/v1/realtime/calls",
      liveSessionsUrl: "https://api.openai.com/v1/live/sessions",
      model: purpose === "live" ? env.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1" : env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
      transcriptionModel: env.REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-transcribe",
      getAuthHeaders: async () => ({ Authorization: `Bearer ${key}` }),
    };
  }

  if (name === "azure") {
    const endpoint = required(env, "AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
    const key = env.AZURE_OPENAI_API_KEY?.trim();
    const requested = env.AZURE_AUTH?.trim().toLowerCase();
    if (requested && requested !== "api-key" && requested !== "managed-identity") {
      throw new ProviderConfigError(`Unknown AZURE_AUTH "${requested}". Use "managed-identity" or "api-key".`);
    }
    const auth: ProviderAuth = (requested as ProviderAuth | undefined) ?? (key ? "api-key" : "managed-identity");
    if (auth === "api-key" && !key) throw new ProviderConfigError("AZURE_AUTH=api-key needs AZURE_OPENAI_API_KEY.");
    return {
      name,
      auth,
      clientSecretUrl: `${endpoint}/openai/v1/realtime/client_secrets`,
      webrtcUrl: `${endpoint}/openai/v1/realtime/calls?webrtcfilter=on`,
      // Foundry's GPT-Live path follows the v1 API layout; override it if your resource differs.
      liveSessionsUrl: env.AZURE_LIVE_SESSIONS_URL?.trim() || `${endpoint}/openai/v1/live/sessions`,
      model: purpose === "live" ? env.AZURE_OPENAI_LIVE_DEPLOYMENT?.trim() || "gpt-live-1" : required(env, "AZURE_OPENAI_REALTIME_DEPLOYMENT"),
      // Newer transcribe models may not be deployed in every Azure region yet.
      transcriptionModel: env.REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe",
      getAuthHeaders:
        auth === "api-key"
          ? async () => ({ "api-key": key! })
          : async () => ({ Authorization: `Bearer ${await getAzureToken(COGNITIVE_SERVICES_SCOPE)}` }),
    };
  }

  throw new ProviderConfigError(`Unknown ${purpose === "live" ? "LIVE_PROVIDER" : "VOICE_PROVIDER"} "${name}". Use "openai" or "azure".`);
}

/** A clear message for a refused credential, naming the setting to check. */
export function credentialProblem(p: ProviderConfig, status: number): string | null {
  if (status !== 401 && status !== 403) return null;
  if (p.name === "openai") return "OpenAI refused the API key. Check OPENAI_API_KEY (it may have been revoked).";
  return p.auth === "managed-identity"
    ? "Azure AI Foundry refused the app's managed identity. Check its \"Cognitive Services OpenAI User\" role on the resource."
    : "Azure AI Foundry refused the API key. Check AZURE_OPENAI_API_KEY.";
}

/** fetch with a deadline and one retry on rate limits, server errors and network failures. */
export async function fetchWithRetry(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
        const wait = Math.min(2000, (Number(res.headers.get("retry-after")) || 0.5) * 1000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt > 0) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
