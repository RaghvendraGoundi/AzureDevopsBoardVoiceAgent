/**
 * Realtime voice providers. OpenAI and Azure OpenAI speak the same GA
 * Realtime protocol; they differ only in hosts, auth headers and model naming.
 * Server-only: this reads permanent API keys from the environment.
 */

export type VoiceProviderName = "openai" | "azure";

export interface ProviderConfig {
  name: VoiceProviderName;
  /** Where the server mints an ephemeral client secret. */
  clientSecretUrl: string;
  /** Headers carrying the permanent credential (server-side only). */
  authHeaders: Record<string, string>;
  /** Where the browser POSTs its SDP offer using the ephemeral secret. */
  webrtcUrl: string;
  /** Model (OpenAI) or deployment name (Azure). */
  model: string;
  /** Model used to transcribe the user's speech for the on-screen transcript. */
  transcriptionModel: string;
}

export class ProviderConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ProviderConfigError(`Missing environment variable ${name}.`);
  return value;
}

export function resolveProvider(env = process.env): ProviderConfig {
  const name = (env.VOICE_PROVIDER?.trim().toLowerCase() || "openai") as VoiceProviderName;

  if (name === "openai") {
    return {
      name,
      clientSecretUrl: "https://api.openai.com/v1/realtime/client_secrets",
      authHeaders: { Authorization: `Bearer ${required(env, "OPENAI_API_KEY")}` },
      webrtcUrl: "https://api.openai.com/v1/realtime/calls",
      model: env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
      transcriptionModel: env.REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-transcribe",
    };
  }

  if (name === "azure") {
    const endpoint = required(env, "AZURE_OPENAI_ENDPOINT").replace(/\/+$/, "");
    return {
      name,
      clientSecretUrl: `${endpoint}/openai/v1/realtime/client_secrets`,
      authHeaders: { "api-key": required(env, "AZURE_OPENAI_API_KEY") },
      webrtcUrl: `${endpoint}/openai/v1/realtime/calls?webrtcfilter=on`,
      model: required(env, "AZURE_OPENAI_REALTIME_DEPLOYMENT"),
      // Newer transcribe models may not be deployed in every Azure region yet.
      transcriptionModel: env.REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe",
    };
  }

  throw new ProviderConfigError(`Unknown VOICE_PROVIDER "${name}". Use "openai" or "azure".`);
}
