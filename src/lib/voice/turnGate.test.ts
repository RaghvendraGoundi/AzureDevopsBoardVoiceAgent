import { describe, expect, it } from "vitest";
import { decideTurn, isMeaningfulTranscript, isRealSpeech, LONG_SPEECH_MS, transcriptConfidence } from "./turnGate";

describe("isMeaningfulTranscript", () => {
  it.each(["", "  ", "[cough]", "(coughs)", "*sneezes*", "Hmm.", "uh, um", "<noise>", "...", "a", "Mm-hmm"])(
    "treats %j as noise",
    (text) => expect(isMeaningfulTranscript(text)).toBe(false),
  );

  it.each(["Yes.", "no", "Do it", "Stop", "OK", "the second one", "1024", "Yes, do it. [cough]"])(
    "treats %j as speech",
    (text) => expect(isMeaningfulTranscript(text)).toBe(true),
  );
});

describe("decideTurn", () => {
  it("answers long speech at once and checks short bursts first", () => {
    expect(decideTurn(LONG_SPEECH_MS + 100)).toBe("respond");
    expect(decideTurn(250)).toBe("await_transcript");
    expect(decideTurn(null)).toBe("respond");
  });
});

describe("isRealSpeech", () => {
  const lp = (n: number, logprob: number) => Array.from({ length: n }, () => ({ logprob }));

  it("averages token probabilities", () => {
    expect(transcriptConfidence(lp(3, 0))).toBe(1);
    expect(transcriptConfidence(lp(2, Math.log(0.5)))).toBeCloseTo(0.5);
    expect(transcriptConfidence(undefined)).toBeNull();
  });

  it("rejects short guesses the transcriber wasn't sure of", () => {
    expect(isRealSpeech("Yes.", transcriptConfidence(lp(2, -2)))).toBe(false);
    expect(isRealSpeech("I'm done.", 0.2)).toBe(false);
  });

  it("accepts confident short replies and long transcripts", () => {
    expect(isRealSpeech("Yes.", 0.95)).toBe(true);
    expect(isRealSpeech("I am done.", null)).toBe(true);
    expect(isRealSpeech("Move the login bug to active and assign it to me", 0.3)).toBe(true);
  });

  it("still rejects sound tags regardless of confidence", () => {
    expect(isRealSpeech("[cough]", 1)).toBe(false);
  });
});
