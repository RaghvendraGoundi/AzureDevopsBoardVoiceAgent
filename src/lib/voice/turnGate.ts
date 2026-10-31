/**
 * Decides whether a detected "turn" is real speech worth answering, so a
 * cough, a chair scrape or a stray "hmm" doesn't make the assistant react.
 */

/**
 * Utterances at least this long get a reply started right away, before their
 * transcript arrives; the reply is cancelled if the transcript shows noise.
 * Shorter ones wait for the transcript first.
 */
export const LONG_SPEECH_MS = 600;
/** How long to wait for a transcript before deciding without it. */
export const SHORT_TURN_TRANSCRIPT_WAIT_MS = 2000;
/** Average per-token probability below which a transcript is treated as a guess at noise. */
export const MIN_TRANSCRIPT_CONFIDENCE = 0.45;
/** Transcripts with more words than this are trusted regardless of confidence. */
const CONFIDENCE_CHECK_MAX_WORDS = 5;

const FILLERS = new Set([
  "uh", "um", "umm", "hmm", "hm", "mm", "mmm", "mhm", "ah", "oh", "eh", "er", "huh", "ha", "ahem", "cough", "coughs", "coughing",
  "sneeze", "sneezes", "laughs", "laughter", "noise", "background noise", "inaudible", "silence", "music", "applause", "breathing",
]);

/**
 * True when a transcript contains something a person actually said, as
 * opposed to an empty result, a sound tag like "[cough]", or filler.
 */
export function isMeaningfulTranscript(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = text
    .replace(/[[(<*].*?[\])>*]/g, " ") // [cough], (laughs), <noise>, *sneezes*
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return false;
  const words = cleaned.split(" ").filter((w) => !FILLERS.has(w));
  if (words.length === 0 || FILLERS.has(cleaned)) return false;
  // A single 1-letter "word" is almost always noise.
  return words.length > 1 || words[0].length > 1 || /\d/.test(words[0]);
}

/** Mean token probability (0..1) from transcription logprobs, or null if none were sent. */
export function transcriptConfidence(logprobs: Array<{ logprob: number }> | null | undefined): number | null {
  if (!logprobs?.length) return null;
  return Math.exp(logprobs.reduce((sum, p) => sum + p.logprob, 0) / logprobs.length);
}

/**
 * True when a turn should be answered. A cough can come back from the
 * transcriber as a confident-sounding "Yes." or "I'm done.", but with low
 * token probabilities, so short low-confidence transcripts are rejected too.
 */
export function isRealSpeech(transcript: string | null | undefined, confidence: number | null): boolean {
  if (!isMeaningfulTranscript(transcript)) return false;
  if (confidence === null) return true;
  const words = transcript!.trim().split(/\s+/).length;
  return words > CONFIDENCE_CHECK_MAX_WORDS || confidence >= MIN_TRANSCRIPT_CONFIDENCE;
}

export type TurnDecision = "respond" | "await_transcript";

/** Long speech is answered right away; short bursts wait for their transcript. */
export function decideTurn(durationMs: number | null): TurnDecision {
  if (durationMs === null) return "respond";
  return durationMs >= LONG_SPEECH_MS ? "respond" : "await_transcript";
}
