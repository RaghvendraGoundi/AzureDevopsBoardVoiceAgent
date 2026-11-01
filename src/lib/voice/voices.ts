/**
 * Voices the user can pick in settings. Realtime and GPT-Live each have their
 * own set; a voice is fixed when the session starts, so a change takes effect
 * on the next call. Shared by the settings menu and the session routes, which
 * only accept names from these lists.
 */

export interface VoiceOption {
  id: string;
  label: string;
  detail: string;
}

export type VoiceEngineId = "realtime" | "live";

export const REALTIME_VOICES: VoiceOption[] = [
  { id: "marin", label: "Marin", detail: "Warm and natural. The default" },
  { id: "cedar", label: "Cedar", detail: "Calm, low and grounded" },
  { id: "coral", label: "Coral", detail: "Bright, friendly and upbeat" },
  { id: "sage", label: "Sage", detail: "Clear, even and composed" },
  { id: "shimmer", label: "Shimmer", detail: "Light, airy and cheerful" },
  { id: "verse", label: "Verse", detail: "Expressive and dynamic" },
  { id: "ballad", label: "Ballad", detail: "Soft and gentle, a storyteller" },
  { id: "ash", label: "Ash", detail: "Relaxed and confident" },
  { id: "echo", label: "Echo", detail: "Steady and unhurried" },
  { id: "alloy", label: "Alloy", detail: "Balanced and neutral" },
];

// GPT-Live's own voices, described by accent and presentation as OpenAI lists them.
export const LIVE_VOICES: VoiceOption[] = [
  { id: "marin", label: "Marin", detail: "Warm and natural. The default" },
  { id: "cedar", label: "Cedar", detail: "Calm, low and grounded" },
  { id: "gleam", label: "Gleam", detail: "North American accent · feminine" },
  { id: "meridian", label: "Meridian", detail: "North American accent · masculine" },
  { id: "vesper", label: "Vesper", detail: "British accent · masculine" },
  { id: "willow", label: "Willow", detail: "Irish accent · feminine" },
  { id: "stone", label: "Stone", detail: "Irish accent · masculine" },
  { id: "quartz", label: "Quartz", detail: "Australian accent · feminine" },
  { id: "ripple", label: "Ripple", detail: "Australian accent · masculine" },
  { id: "delta", label: "Delta", detail: "Southern U.S. accent · feminine" },
  { id: "cinder", label: "Cinder", detail: "Southern U.S. accent · masculine" },
  { id: "beacon", label: "Beacon", detail: "Filipino English accent · masculine" },
];

export function voicesFor(engine: VoiceEngineId): VoiceOption[] {
  return engine === "live" ? LIVE_VOICES : REALTIME_VOICES;
}

/** The voice to use: the user's pick if it's a known voice for this engine, else the configured default. */
export function pickVoice(engine: VoiceEngineId, requested: unknown, fallback: string | undefined): string {
  const known = voicesFor(engine);
  if (typeof requested === "string" && known.some((v) => v.id === requested)) return requested;
  return fallback?.trim() || "marin";
}
