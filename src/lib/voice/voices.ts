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
  { id: "marin", label: "Marin", detail: "Warm, natural" },
  { id: "cedar", label: "Cedar", detail: "Calm, grounded" },
  { id: "coral", label: "Coral", detail: "Bright and friendly" },
  { id: "sage", label: "Sage", detail: "Clear and even" },
  { id: "shimmer", label: "Shimmer", detail: "Light and upbeat" },
  { id: "verse", label: "Verse", detail: "Expressive" },
  { id: "ballad", label: "Ballad", detail: "Soft, storyteller" },
  { id: "ash", label: "Ash", detail: "Relaxed, low" },
  { id: "echo", label: "Echo", detail: "Steady, neutral" },
  { id: "alloy", label: "Alloy", detail: "Neutral, classic" },
];

export const LIVE_VOICES: VoiceOption[] = [
  { id: "marin", label: "Marin", detail: "Warm, natural" },
  { id: "cedar", label: "Cedar", detail: "Calm, grounded" },
  { id: "gleam", label: "Gleam", detail: "North American · feminine" },
  { id: "meridian", label: "Meridian", detail: "North American · masculine" },
  { id: "vesper", label: "Vesper", detail: "British · masculine" },
  { id: "willow", label: "Willow", detail: "Irish · feminine" },
  { id: "stone", label: "Stone", detail: "Irish · masculine" },
  { id: "quartz", label: "Quartz", detail: "Australian · feminine" },
  { id: "ripple", label: "Ripple", detail: "Australian · masculine" },
  { id: "delta", label: "Delta", detail: "Southern U.S. · feminine" },
  { id: "cinder", label: "Cinder", detail: "Southern U.S. · masculine" },
  { id: "beacon", label: "Beacon", detail: "Filipino · masculine" },
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
