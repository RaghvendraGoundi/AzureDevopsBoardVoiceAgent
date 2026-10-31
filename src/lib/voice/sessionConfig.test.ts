import { afterEach, describe, expect, it, vi } from "vitest";
import { toolDefinitions } from "@/lib/devops/tools";
import { resolveProvider } from "./providers";
import { buildInstructions, buildSessionConfig, buildSpeakingTurnDetection, buildTurnDetection } from "./sessionConfig";

afterEach(() => vi.unstubAllEnvs());

describe("resolveProvider", () => {
  it("defaults OpenAI to gpt-realtime-2.1 and gpt-transcribe", () => {
    const p = resolveProvider({ OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv);
    expect(p).toMatchObject({ name: "openai", model: "gpt-realtime-2.1", transcriptionModel: "gpt-transcribe" });
    expect(p.webrtcUrl).toBe("https://api.openai.com/v1/realtime/calls");
  });

  it("builds Azure URLs from the endpoint and uses the deployment as model", () => {
    const p = resolveProvider({
      VOICE_PROVIDER: "azure",
      AZURE_OPENAI_ENDPOINT: "https://res.openai.azure.com/",
      AZURE_OPENAI_API_KEY: "k",
      AZURE_OPENAI_REALTIME_DEPLOYMENT: "my-rt",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.clientSecretUrl).toBe("https://res.openai.azure.com/openai/v1/realtime/client_secrets");
    expect(p.authHeaders).toEqual({ "api-key": "k" });
    expect(p.model).toBe("my-rt");
  });
});

describe("buildSessionConfig", () => {
  it("uses low reasoning effort, semantic turn detection, far-field noise reduction and English by default", () => {
    const s = buildSessionConfig({ model: "gpt-realtime-2.1", transcriptionModel: "gpt-transcribe", currentUser: "Me" });
    expect(s.reasoning).toEqual({ effort: "low" });
    // The browser decides when to answer or interrupt, so noise can't trigger either.
    expect(s.audio.input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "low",
      create_response: false,
      interrupt_response: false,
    });
    expect(s.audio.input.noise_reduction).toEqual({ type: "far_field" });
    expect(s.audio.input.transcription.language).toBe("en");
    expect(s.include).toEqual(["item.input_audio_transcription.logprobs"]);
    expect(s.tools).toBe(toolDefinitions);
  });

  it("uses a strict server VAD while the assistant is talking", () => {
    expect(buildSpeakingTurnDetection()).toMatchObject({ type: "server_vad", threshold: 0.9, interrupt_response: false });
  });

  it("covers the turn-taking rules in the instructions", () => {
    const text = buildInstructions("Me");
    for (const heading of ["# Role and Objective", "# Turn-taking", "# Unclear Audio", "# Preambles", "# Verbosity", "# Tools"]) {
      expect(text).toContain(heading);
    }
    expect(text).toMatch(/coughing, sneezing, breathing/);
    expect(text).toMatch(/A short pause is not the end/);
  });

  it("honours a valid reasoning effort override and ignores junk", () => {
    vi.stubEnv("REALTIME_REASONING_EFFORT", "medium");
    expect(buildSessionConfig({ model: "m", transcriptionModel: "t", currentUser: "Me" }).reasoning.effort).toBe("medium");
    vi.stubEnv("REALTIME_REASONING_EFFORT", "turbo");
    expect(buildSessionConfig({ model: "m", transcriptionModel: "t", currentUser: "Me" }).reasoning.effort).toBe("low");
  });

  it("falls back to silence-based server VAD when asked, clamping its tuning", () => {
    vi.stubEnv("TURN_DETECTION", "server");
    vi.stubEnv("VAD_THRESHOLD", "0.85");
    vi.stubEnv("VAD_SILENCE_MS", "50");
    expect(buildTurnDetection()).toMatchObject({ type: "server_vad", threshold: 0.85, silence_duration_ms: 800 });
  });

  it("accepts a valid eagerness and ignores junk", () => {
    vi.stubEnv("VAD_EAGERNESS", "high");
    expect(buildTurnDetection()).toMatchObject({ eagerness: "high" });
    vi.stubEnv("VAD_EAGERNESS", "0.6");
    expect(buildTurnDetection()).toMatchObject({ eagerness: "low" });
  });

  it("sends keyword hints only to transcribers that support them", () => {
    const hinted = buildSessionConfig({ model: "m", transcriptionModel: "gpt-transcribe", currentUser: "Me", keywords: ["Add rate limiting"] });
    expect(hinted.audio.input.transcription).toHaveProperty("keywords");
    expect((hinted.audio.input.transcription as { keywords: string[] }).keywords).toContain("Add rate limiting");

    const plain = buildSessionConfig({ model: "m", transcriptionModel: "gpt-4o-mini-transcribe", currentUser: "Me", keywords: ["x"] });
    expect(plain.audio.input.transcription).not.toHaveProperty("keywords");
  });

  it("primes the transcriber with the short replies users actually say", () => {
    const s = buildSessionConfig({ model: "m", transcriptionModel: "gpt-transcribe", currentUser: "Me", keywords: ["Add rate limiting"] });
    const t = s.audio.input.transcription as { prompt?: string; keywords: string[] };
    expect(t.prompt).toMatch(/I am done/);
    expect(t.keywords.slice(0, 2)).toEqual(["I am done", "I'm done"]);

    const whisper = buildSessionConfig({ model: "m", transcriptionModel: "gpt-realtime-whisper", currentUser: "Me" });
    expect(whisper.audio.input.transcription).not.toHaveProperty("prompt");
  });
});
