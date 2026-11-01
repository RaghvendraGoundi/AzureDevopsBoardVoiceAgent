import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResponse, VoiceEvent } from "@/types/voice";
import { buildLiveSession, LIVE_BACKEND_TOOLS } from "./liveConfig";
import { isEndRequest, LiveClient, SPEAK_WATCHDOG_MS, UTTERANCE_GAP_MS } from "./liveClient";

/** Drives the Live event handling with a fake data channel. */
function setup(
  executeTool: (name: string, args: unknown) => Promise<ToolResponse> = async () => ({ output: { ok: true }, uiEvents: [] }),
) {
  const events: VoiceEvent[] = [];
  const sent: Record<string, unknown>[] = [];
  const onEnded = vi.fn();
  const client = new LiveClient({ onEvent: (e) => events.push(e), executeTool, onEnded });
  const internals = client as unknown as {
    dc: { readyState: string; send: (m: string) => void; close: () => void };
    handleServerEvent: (ev: Record<string, unknown>) => void;
  };
  internals.dc = { readyState: "open", send: (m) => sent.push(JSON.parse(m)), close: () => undefined };
  const server = (ev: Record<string, unknown>) => internals.handleServerEvent(ev);
  const user = (delta: string) => server({ type: "session.input_transcript.delta", delta });
  const assistant = (delta: string) => server({ type: "session.output_transcript.delta", delta });
  const finals = (role: "user_transcript" | "assistant_transcript") =>
    events.filter((e) => e.type === role && e.final).map((e) => (e as { text: string }).text);
  const statuses = () => events.filter((e) => e.type === "agent_status").map((e) => (e as { status: string }).status);
  const backend = (event: Record<string, unknown>, delegation_id = "item_d1") =>
    server({ type: "response.event", delegation_id, event });
  const call = (call_id: string, name: string, args: Record<string, unknown> = {}) =>
    backend({ type: "response.output_item.done", item: { type: "function_call", call_id, name, arguments: JSON.stringify(args) } });
  return { events, sent, onEnded, user, assistant, finals, statuses, backend, call };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("transcript grouping", () => {
  it("joins words into one utterance per speaker, split by pauses", () => {
    const { user, assistant, finals, statuses } = setup();
    user("What's");
    user(" a good name");
    vi.advanceTimersByTime(300);
    user(" for a turtle?");
    assistant(" Maybe Shelby.");
    vi.advanceTimersByTime(UTTERANCE_GAP_MS + 10);
    expect(finals("user_transcript")).toEqual(["What's a good name for a turtle?"]);
    expect(finals("assistant_transcript")).toEqual(["Maybe Shelby."]);
    expect(statuses()).toEqual(["listening", "speaking", "listening"]);
  });

  it("keeps the user's sentence whole when the assistant talks over it", () => {
    const { user, assistant, finals } = setup();
    user(" Thanks. I am");
    assistant(" You're welcome!");
    user(" done. Close it");
    user(" for now.");
    vi.advanceTimersByTime(UTTERANCE_GAP_MS + 10);
    expect(finals("user_transcript")).toEqual(["Thanks. I am done. Close it for now."]);
  });
});

describe("ending the call", () => {
  it("recognises ways of saying you're done, but not work-item 'done'", () => {
    for (const t of ["I am done.", "I'm done, close it for now", "That's all, thanks", "Okay, goodbye!", "End the session"]) {
      expect(isEndRequest(t), t).toBe(true);
    }
    for (const t of ["Mark it done", "What's left to do?", "Close the login bug"]) expect(isEndRequest(t), t).toBe(false);
  });

  it("hangs up after the goodbye has been spoken", async () => {
    const { user, assistant, sent, onEnded, events } = setup();
    user(" I am done, close it for now.");
    assistant(" Sure thing.");
    vi.advanceTimersByTime(UTTERANCE_GAP_MS + 10); // user utterance ends: end requested
    expect(onEnded).not.toHaveBeenCalled();
    assistant(" Take care!");
    vi.advanceTimersByTime(UTTERANCE_GAP_MS + 10); // goodbye ends
    expect(sent.map((e) => e.type)).toContain("session.close");
    await vi.advanceTimersByTimeAsync(3100);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: "connection", state: "disconnected" });
  });

  it("hangs up anyway if no goodbye comes", async () => {
    const { user, onEnded } = setup();
    user(" Goodbye.");
    vi.advanceTimersByTime(UTTERANCE_GAP_MS + 10);
    await vi.advanceTimersByTimeAsync(2600 + 3100);
    expect(onEnded).toHaveBeenCalledOnce();
  });
});

describe("backend tool calls", () => {
  it("runs the backend's tool, returns its output, then lets the backend continue", async () => {
    const executeTool = vi.fn(async () => ({
      output: { ok: true, count: 4 },
      uiEvents: [{ type: "work_items_loaded" as const, title: "Active", items: [] }],
    }));
    const { backend, call, sent, events } = setup(executeTool);
    backend({ type: "response.created" });
    call("c1", "list_work_items", { state: "Active" });
    backend({ type: "response.completed" });
    await vi.runAllTimersAsync();

    expect(executeTool).toHaveBeenCalledWith("list_work_items", { state: "Active" });
    expect(events).toContainEqual({ type: "work_items_loaded", title: "Active", items: [] });
    expect(sent.map((e) => e.type)).toEqual(["response.item.create", "response.create"]);
    expect(sent[0]).toMatchObject({ item: { type: "function_call_output", call_id: "c1", output: JSON.stringify({ ok: true, count: 4 }) } });
  });

  it("doesn't continue a backend response that made no tool calls", async () => {
    const { backend, sent } = setup();
    backend({ type: "response.created" });
    backend({ type: "response.completed" });
    await vi.runAllTimersAsync();
    expect(sent.filter((e) => e.type === "response.create")).toEqual([]);
  });

  it("runs tools one at a time so writes stay in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { call, backend } = setup(async (name) => {
      order.push(`start ${name}`);
      if (name === "propose_update_work_item") await gate;
      order.push(`end ${name}`);
      return { output: { ok: true }, uiEvents: [] };
    });
    call("c1", "propose_update_work_item");
    call("c2", "get_work_item", { id: 1024 });
    backend({ type: "response.completed" });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["start propose_update_work_item"]);
    release();
    await vi.runAllTimersAsync();
    expect(order).toEqual(["start propose_update_work_item", "end propose_update_work_item", "start get_work_item", "end get_work_item"]);
  });

  it("reports a board outage to the backend instead of hanging", async () => {
    const { call, backend, sent } = setup(async () => {
      throw new Error("offline");
    });
    call("c1", "list_work_items");
    backend({ type: "response.completed" });
    await vi.runAllTimersAsync();
    expect(JSON.parse((sent[0] as { item: { output: string } }).item.output)).toMatchObject({ ok: false });
    expect(sent.at(-1)?.type).toBe("response.create");
  });
});

describe("answers that never get spoken", () => {
  const finish = (backend: (e: Record<string, unknown>, d?: string) => void, text: string, d = "item_d2") => {
    backend({ type: "response.created" }, d);
    backend({ type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text }] } }, d);
    backend({ type: "response.completed" }, d);
  };
  const nudges = (sent: Record<string, unknown>[]) => sent.filter((e) => e.type === "session.commentary.append");

  it("nudges the voice model to say a finished answer it stayed silent about", () => {
    const { backend, sent } = setup();
    finish(backend, "You have six open user stories.");
    vi.advanceTimersByTime(SPEAK_WATCHDOG_MS - 100);
    expect(nudges(sent)).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(nudges(sent)).toHaveLength(1);
    expect(nudges(sent)[0]).toMatchObject({ delegation_id: null });
    expect(String(nudges(sent)[0].content)).toMatch(/six open user stories/);
  });

  it("leaves it alone when the answer is spoken, even if speech began before the backend finished", () => {
    const { backend, assistant, sent } = setup();
    backend({ type: "response.created" }, "item_d2");
    assistant(" You have six open user stories.");
    backend({ type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "Six stories." }] } }, "item_d2");
    backend({ type: "response.completed" }, "item_d2");
    vi.advanceTimersByTime(SPEAK_WATCHDOG_MS * 3);
    expect(nudges(sent)).toHaveLength(0);
  });

  it("waits for the user to stop talking before nudging", () => {
    const { backend, user, sent } = setup();
    finish(backend, "Six stories.");
    vi.advanceTimersByTime(SPEAK_WATCHDOG_MS - 500);
    user(" hello?");
    vi.advanceTimersByTime(700);
    expect(nudges(sent)).toHaveLength(0);
    vi.advanceTimersByTime(UTTERANCE_GAP_MS * 2);
    expect(nudges(sent)).toHaveLength(1);
  });

  it("stops showing Thinking if it stays quiet even after the nudge", () => {
    const { backend, statuses } = setup();
    finish(backend, "Six stories.");
    vi.advanceTimersByTime(SPEAK_WATCHDOG_MS + 6100);
    expect(statuses().at(-1)).toBe("listening");
  });

  it("continues overlapping hand-offs only once every tool result is in", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const { backend, call, sent } = setup(async (name) => {
      if (name === "slow") await slow;
      return { output: { ok: true }, uiEvents: [] };
    });
    call("c1", "slow");
    backend({ type: "response.completed" });
    backend({ type: "response.output_item.done", item: { type: "function_call", call_id: "c2", name: "fast", arguments: "{}" } }, "item_d2");
    backend({ type: "response.completed" }, "item_d2");
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.filter((e) => e.type === "response.create")).toHaveLength(0);
    release();
    await vi.advanceTimersByTimeAsync(10);
    const types = sent.map((e) => e.type);
    expect(types.filter((t) => t === "response.item.create").length).toBeGreaterThanOrEqual(2);
    expect(types.lastIndexOf("response.item.create")).toBeLessThan(types.indexOf("response.create"));
  });
});

describe("buildLiveSession", () => {
  it("uses gpt-live-1 with a low-effort backend and the turn-taking rules", () => {
    const s = buildLiveSession("Me", {} as NodeJS.ProcessEnv);
    expect(s.model).toBe("gpt-live-1");
    expect(s.delegation).toMatchObject({ type: "responses", responses: { model: "gpt-6-luna", reasoning: { effort: "low" } } });
    expect(s.audio.output.voice).toBe("marin");
    expect(s.instructions).toMatch(/Let the user finish their sentence/);
  });

  it("gives the backend the board tools and the confirmation rules, but not turn-taking tools", () => {
    const s = buildLiveSession("Me", {} as NodeJS.ProcessEnv);
    const names = s.delegation.responses.tools.map((t) => t.name);
    expect(names).toContain("confirm_action");
    expect(names).not.toContain("wait_for_user");
    expect(names).not.toContain("end_session");
    expect(s.delegation.responses.tools).toBe(LIVE_BACKEND_TOOLS);
    expect(LIVE_BACKEND_TOOLS.every((t) => t.strict === false)).toBe(true);
    expect(s.delegation.responses.instructions).toMatch(/Writes are two-step/);
    expect(s.instructions).toMatch(/Hand off to it for anything involving work items/);
  });

  it("takes model, voice and backend overrides from the environment", () => {
    const s = buildLiveSession("Me", {
      LIVE_VOICE: "juni",
      LIVE_BACKEND_MODEL: "gpt-6-astra",
      LIVE_REASONING_EFFORT: "medium",
    } as unknown as NodeJS.ProcessEnv);
    expect(s.audio.output.voice).toBe("juni");
    expect(s.delegation.responses).toMatchObject({ model: "gpt-6-astra", reasoning: { effort: "medium" } });
  });
});
