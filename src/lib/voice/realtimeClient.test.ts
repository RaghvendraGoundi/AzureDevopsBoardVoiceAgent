import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResponse, VoiceEvent } from "@/types/voice";
import { RealtimeClient } from "./realtimeClient";

/**
 * Drives the client's server-event handling with a fake data channel, so the
 * turn-taking and reply-scheduling rules can be tested without WebRTC.
 */
function setup(executeTool: (name: string, args: unknown) => Promise<ToolResponse> = async () => ({ output: { ok: true }, uiEvents: [] })) {
  const events: VoiceEvent[] = [];
  const sent: Record<string, unknown>[] = [];
  const onEnded = vi.fn();
  const client = new RealtimeClient({ onEvent: (e) => events.push(e), executeTool, onEnded });
  const internals = client as unknown as {
    dc: { readyState: string; send: (m: string) => void; close: () => void };
    handleServerEvent: (ev: Record<string, unknown>) => void;
  };
  internals.dc = { readyState: "open", send: (m) => sent.push(JSON.parse(m)), close: () => undefined };
  const server = (ev: Record<string, unknown>) => internals.handleServerEvent(ev);
  const sentTypes = () => sent.map((e) => e.type);
  const statuses = () => events.filter((e) => e.type === "agent_status").map((e) => (e as { status: string }).status);
  return { client, events, sent, server, sentTypes, statuses, onEnded };
}

type Server = (ev: Record<string, unknown>) => void;

/** A long user turn: speech, stop, commit. */
function longTurn(server: Server, id: string) {
  server({ type: "input_audio_buffer.speech_started", item_id: id, audio_start_ms: 0 });
  server({ type: "input_audio_buffer.speech_stopped", item_id: id, audio_end_ms: 2000 });
  server({ type: "input_audio_buffer.committed", item_id: id });
}

/** The transcriber's result for a turn, confident by default. */
function transcript(server: Server, id: string, text: string, logprob = 0) {
  server({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: id,
    transcript: text,
    logprobs: text.split(" ").map((token) => ({ token, logprob })),
  });
}

/** A long, real user turn including its transcript. */
function spoken(server: Server, id: string, text = "Show me my active tasks please") {
  longTurn(server, id);
  transcript(server, id, text);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.useRealTimers());

describe("reply scheduling", () => {
  it("answers a real user turn", () => {
    const { server, sentTypes } = setup();
    longTurn(server, "u1");
    expect(sentTypes()).toEqual(["response.create"]);
  });

  it("cancels an active reply and waits for it to end before answering the new turn", () => {
    const { server, sentTypes } = setup();
    longTurn(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });

    spoken(server, "u2");
    // Cancel now, but no second response.create while r1 is still active.
    expect(sentTypes()).toEqual(["response.create", "response.cancel", "output_audio_buffer.clear"]);

    server({ type: "response.done", response: { id: "r1", status: "cancelled", output: [] } });
    expect(sentTypes().at(-1)).toBe("response.create");
  });

  it("retries a reply the server rejected because another was active", () => {
    const { server, sentTypes } = setup();
    longTurn(server, "u1");
    server({ type: "error", error: { code: "conversation_already_has_active_response", message: "busy" } });
    server({ type: "response.done", response: { id: "r0", status: "completed", output: [] } });
    expect(sentTypes().filter((t) => t === "response.create")).toHaveLength(2);
  });

  it("sends one reply after tools finish, covering a turn spoken during the tool run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { server, sentTypes } = setup(async () => {
      await gate;
      return { output: { ok: true }, uiEvents: [] };
    });
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "list_work_items", arguments: "{}" }] },
    });
    await flush();

    spoken(server, "u2"); // user speaks while the tool runs
    expect(sentTypes().filter((t) => t === "response.create")).toHaveLength(1);

    release();
    await flush();
    await flush();
    const types = sentTypes();
    expect(types.filter((t) => t === "response.create")).toHaveLength(2);
    expect(types.indexOf("conversation.item.create")).toBeLessThan(types.lastIndexOf("response.create"));
  });
});

describe("status after interruption", () => {
  it("gives a spoken status update when the user talks while a tool has been running a while", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const { server, sent, sentTypes } = setup(() => new Promise<ToolResponse>(() => undefined));
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "list_work_items", arguments: "{}" }] },
    });
    await vi.advanceTimersByTimeAsync(3000);
    spoken(server, "u2");
    await vi.advanceTimersByTimeAsync(0);
    const note = sent.find((e) => e.type === "conversation.item.create" && JSON.stringify(e).includes("[status]"));
    expect(JSON.stringify(note)).toMatch(/still running/);
    expect(sentTypes().filter((t) => t === "response.create")).toHaveLength(2);
  });

  it("says it's still working by itself when a tool runs long", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const { server, sent } = setup(() => new Promise<ToolResponse>(() => undefined));
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "list_work_items", arguments: "{}" }] },
    });
    await vi.advanceTimersByTimeAsync(7500);
    expect(sent.some((e) => JSON.stringify(e).includes("still working on it"))).toBe(true);
  });

  it("ignores late transcript from a cancelled reply instead of flipping back to speaking", () => {
    const { server, statuses, events } = setup();
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: "You have " });

    spoken(server, "u2"); // barge-in cancels r1
    server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: "five items" });

    expect(statuses().at(-1)).toBe("listening");
    const texts = events.filter((e) => e.type === "assistant_transcript").map((e) => (e as { text: string }).text);
    expect(texts).toEqual(["You have "]);
  });
});

describe("noise", () => {
  it("drops a short non-speech turn and resumes a reply the noise cut off", () => {
    const { server, sent, sentTypes } = setup();
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({ type: "output_audio_buffer.started", response_id: "r1" });
    server({ type: "response.done", response: { id: "r1", status: "completed", output: [] } });

    // A cough: the server clears the playing audio by itself and commits a short turn.
    server({ type: "input_audio_buffer.speech_started", item_id: "n1", audio_start_ms: 5000 });
    server({ type: "output_audio_buffer.cleared", response_id: "r1" });
    server({ type: "input_audio_buffer.speech_stopped", item_id: "n1", audio_end_ms: 5200 });
    server({ type: "input_audio_buffer.committed", item_id: "n1" });
    server({ type: "conversation.item.input_audio_transcription.completed", item_id: "n1", transcript: "[cough]" });

    expect(sent).toContainEqual({ type: "conversation.item.delete", item_id: "n1" });
    const resume = sent.find((e) => e.type === "conversation.item.create") as { item: { role: string } };
    expect(resume.item.role).toBe("system");
    expect(sentTypes().at(-1)).toBe("response.create");
  });

  it("drops a cough while idle without replying", () => {
    const { server, sentTypes } = setup();
    server({ type: "input_audio_buffer.speech_started", item_id: "n1", audio_start_ms: 0 });
    server({ type: "input_audio_buffer.speech_stopped", item_id: "n1", audio_end_ms: 200 });
    server({ type: "input_audio_buffer.committed", item_id: "n1" });
    server({ type: "conversation.item.input_audio_transcription.completed", item_id: "n1", transcript: "Hmm." });
    expect(sentTypes()).toEqual(["conversation.item.delete"]);
  });

  it("answers a short real word like 'yes' once its transcript arrives", () => {
    const { server, sentTypes } = setup();
    server({ type: "input_audio_buffer.speech_started", item_id: "y1", audio_start_ms: 0 });
    server({ type: "input_audio_buffer.speech_stopped", item_id: "y1", audio_end_ms: 300 });
    server({ type: "input_audio_buffer.committed", item_id: "y1" });
    expect(sentTypes()).toEqual([]);
    server({ type: "conversation.item.input_audio_transcription.completed", item_id: "y1", transcript: "Yes." });
    expect(sentTypes()).toEqual(["response.create"]);
  });
});

describe("transcript verification", () => {
  it("cancels a reply started for a long burst once the transcript shows it was a cough", () => {
    const { server, sent, sentTypes, statuses } = setup();
    longTurn(server, "n1");
    expect(sentTypes()).toEqual(["response.create"]); // started early to save time
    server({ type: "response.created", response: { id: "r1" } });
    transcript(server, "n1", "[coughing]");
    expect(sentTypes()).toContain("response.cancel");
    expect(sent).toContainEqual({ type: "conversation.item.delete", item_id: "n1" });

    server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: "Sorry?" });
    server({ type: "response.done", response: { id: "r1", status: "cancelled", output: [] } });
    expect(statuses()).not.toContain("speaking");
    expect(statuses().at(-1)).toBe("listening");
  });

  it("cancels the early reply as soon as it is created when the cough was rejected first", () => {
    const { server, sentTypes } = setup();
    longTurn(server, "n1");
    transcript(server, "n1", "");
    expect(sentTypes()).not.toContain("response.cancel");
    server({ type: "response.created", response: { id: "r1" } });
    expect(sentTypes().at(-1)).toBe("response.cancel");
  });

  it("rejects a short low-confidence guess like 'Yes.' from noise", () => {
    const { server, sentTypes } = setup();
    server({ type: "input_audio_buffer.speech_started", item_id: "n1", audio_start_ms: 0 });
    server({ type: "input_audio_buffer.speech_stopped", item_id: "n1", audio_end_ms: 300 });
    server({ type: "input_audio_buffer.committed", item_id: "n1" });
    transcript(server, "n1", "Yes.", -2);
    expect(sentTypes()).toEqual(["conversation.item.delete"]);
  });

  it("holds tool calls from an early reply until the turn is verified, and skips them for noise", async () => {
    const executeTool = vi.fn(async () => ({ output: { ok: true }, uiEvents: [] }));
    const { server } = setup(executeTool);
    longTurn(server, "n1");
    server({ type: "response.created", response: { id: "r1" } });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "list_work_items", arguments: "{}" }] },
    });
    await flush();
    expect(executeTool).not.toHaveBeenCalled();
    transcript(server, "n1", "Hmm.");
    await flush();
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("runs the early reply's tools once the transcript confirms speech", async () => {
    const executeTool = vi.fn(async () => ({ output: { ok: true }, uiEvents: [] }));
    const { server } = setup(executeTool);
    longTurn(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "list_work_items", arguments: "{}" }] },
    });
    transcript(server, "u1", "What do I have that's active?");
    await flush();
    expect(executeTool).toHaveBeenCalledOnce();
  });
});

describe("talking over the assistant", () => {
  it("uses a stricter voice detector only while the assistant is talking", () => {
    const { client, server, sent } = setup();
    const internals = client as unknown as Record<string, unknown>;
    internals.handsFreeTurnDetection = { type: "server_vad", threshold: 0.7 };
    internals.speakingTurnDetection = { type: "server_vad", threshold: 0.9 };
    const thresholds = () =>
      sent
        .filter((e) => e.type === "session.update")
        .map((e) => (e as { session: { audio: { input: { turn_detection: { threshold: number } } } } }).session.audio.input.turn_detection.threshold);

    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({ type: "output_audio_buffer.started", response_id: "r1" });
    expect(thresholds()).toEqual([0.9]);
    server({ type: "response.done", response: { id: "r1", status: "completed", output: [] } });
    server({ type: "output_audio_buffer.stopped", response_id: "r1" });
    expect(thresholds()).toEqual([0.9, 0.7]);

    // A sentence started over the assistant keeps the strict detector until it is committed.
    server({ type: "response.created", response: { id: "r2" } });
    server({ type: "output_audio_buffer.started", response_id: "r2" });
    server({ type: "input_audio_buffer.speech_started", item_id: "u2", audio_start_ms: 9000 });
    server({ type: "output_audio_buffer.cleared", response_id: "r2" });
    expect(thresholds()).toEqual([0.9, 0.7, 0.9]);
    server({ type: "input_audio_buffer.speech_stopped", item_id: "u2", audio_end_ms: 11000 });
    server({ type: "input_audio_buffer.committed", item_id: "u2" });
    expect(thresholds()).toEqual([0.9, 0.7, 0.9, 0.7]);
  });

  it("stops the rest of a reply the server silenced, and resumes it if the sound was a cough", () => {
    const { server, sent, sentTypes, statuses } = setup();
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    server({ type: "output_audio_buffer.started", response_id: "r1" });

    server({ type: "input_audio_buffer.speech_started", item_id: "n1", audio_start_ms: 5000 });
    server({ type: "output_audio_buffer.cleared", response_id: "r1" });
    expect(sentTypes()).toContain("response.cancel");
    expect(statuses().at(-1)).toBe("listening");

    server({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: "more" });
    expect(statuses().at(-1)).toBe("listening");

    server({ type: "input_audio_buffer.speech_stopped", item_id: "n1", audio_end_ms: 5900 });
    server({ type: "input_audio_buffer.committed", item_id: "n1" });
    transcript(server, "n1", "[cough]");
    server({ type: "response.done", response: { id: "r1", status: "cancelled", output: [] } });
    const resume = sent.find((e) => e.type === "conversation.item.create") as { item: { role: string } };
    expect(resume.item.role).toBe("system");
    expect(sentTypes().at(-1)).toBe("response.create");
  });

  it("stops the assistant once the transcript confirms the user spoke", () => {
    const { server, sentTypes } = setup();
    spoken(server, "u1");
    server({ type: "response.created", response: { id: "r1" } });
    spoken(server, "u2", "Wait, only the bugs");
    expect(sentTypes()).toContain("response.cancel");
  });
});

describe("ending the session", () => {
  it("hangs up after the goodbye finishes playing and doesn't ask for another reply", async () => {
    vi.useFakeTimers();
    const { server, sentTypes, onEnded, events } = setup();
    spoken(server, "u1", "I am done, close it for now");
    server({ type: "response.created", response: { id: "r1" } });
    server({ type: "output_audio_buffer.started", response_id: "r1" });
    server({
      type: "response.done",
      response: { id: "r1", status: "completed", output: [{ type: "function_call", call_id: "c1", name: "end_session", arguments: "{}" }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTypes().filter((t) => t === "response.create")).toHaveLength(1);
    expect(onEnded).not.toHaveBeenCalled(); // still saying goodbye

    server({ type: "output_audio_buffer.stopped", response_id: "r1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: "connection", state: "disconnected" });
  });
});
