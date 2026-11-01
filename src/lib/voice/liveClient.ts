"use client";

import type { AgentStatus, ToolResponse, VoiceEvent } from "@/types/voice";
import { MicrophoneError } from "./realtimeClient";

/**
 * Browser client for GPT-Live over WebRTC. GPT-Live is full duplex and takes
 * turns by itself, so unlike RealtimeClient there is nothing to schedule:
 * this class just streams the mic, plays the reply track, and turns the
 * Live event stream into our VoiceEvents.
 *
 * Live sends transcripts as timed deltas with no item ids and no "turn
 * finished" events, so utterances are grouped here by pauses. Both sides can
 * talk at once, so a user utterance stays open while the assistant speaks
 * (and vice versa) instead of being chopped into fragments.
 *
 * Board work is handed by GPT-Live to its backend model. The backend's
 * function calls arrive here wrapped in response.event; this client runs
 * them on our server and returns the results so the backend can continue.
 */

export interface LiveClientOptions {
  onEvent: (event: VoiceEvent) => void;
  /** Runs a board tool on the backend. */
  executeTool: (name: string, args: unknown) => Promise<ToolResponse>;
  /** The call ended by itself (the user said goodbye, or the session expired). */
  onEnded?: () => void;
}

/** An utterance with no new words for this long is considered finished. */
export const UTTERANCE_GAP_MS = 1200;
/** How long a goodbye may take before hanging up anyway. */
const GOODBYE_MAX_MS = 6000;
/** How long to wait for a goodbye to start before hanging up anyway. */
const GOODBYE_START_MS = 2500;
/** How long to wait for session.closed after asking to close. */
const CLOSE_TIMEOUT_MS = 3000;

const END_PHRASE =
  /\b(i('| a)?m done|i am done|that'?s all|that is all|close (it|this|the session)|end (it|this|the (session|call))|hang up|good ?bye|bye for now)\b/i;

/** True when a finished user utterance asks to end the call. */
export function isEndRequest(text: string): boolean {
  return END_PHRASE.test(text);
}

/** Guard against a backend stuck calling tools. */
const MAX_TOOL_ROUNDS = 6;
/**
 * The backend finished but the voice model hasn't said anything this long
 * afterwards: nudge it to speak the result. Happens when the user changed
 * their request mid-answer and two hand-offs overlapped.
 */
export const SPEAK_WATCHDOG_MS = 4000;
/** After a nudge, stop showing "Thinking" if it still stays quiet. */
const NUDGE_GIVE_UP_MS = 6000;
/** Commentary is limited to 500 tokens; stay well inside it. */
const MAX_COMMENTARY_CHARS = 1200;
/** Logs the Live event stream (minus audio and transcript deltas) in development. */
const DEBUG_EVENTS = process.env.NODE_ENV === "development";

type ServerEvent = { type: string; [key: string]: unknown };

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

/** Tool calls of one hand-off ("delegation") to the backend model. */
interface Delegation {
  /** Calls in the backend's current response that still need an output. */
  calls: number;
  rounds: number;
  /** Tool runs, chained so board writes happen in order. */
  work: Promise<void>;
  /** What the backend said in its current response: the answer once it stops calling tools. */
  answer: string;
  /** When the backend's current response started (after the previous round's tool results). */
  startedAt: number;
}

interface Item {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface Utterance {
  id: string;
  text: string;
  timer?: ReturnType<typeof setTimeout>;
}

export class LiveClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private levelBuf = new Uint8Array(256);
  private status: AgentStatus = "idle";
  private closedByUser = false;
  private sessionReady: (() => void) | null = null;

  private seq = 0;
  private outputMuted = false;
  /** The current reply was interrupted; unmuted when it ends. */
  private silenced = false;
  /** Makes transcript ids unique across sessions of the same conversation. */
  private readonly sessionTag = Date.now().toString(36);
  private user: Utterance | null = null;
  private assistant: Utterance | null = null;
  /** The user asked to end the call; hang up once the goodbye is over. */
  private ending = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private closing: (() => void) | null = null;
  private delegations = new Map<string, Delegation>();
  /** Every tool run, chained in order. */
  private toolQueue: Promise<void> = Promise.resolve();
  /** When the assistant last said anything. */
  private lastSpokeAt = 0;
  /** A finished backend answer the voice model hasn't spoken yet. */
  private unspoken: { text: string; at: number; timer: ReturnType<typeof setTimeout>; nudged: boolean } | null = null;

  constructor(private readonly opts: LiveClientOptions) {}

  private emit(event: VoiceEvent) {
    if (event.type === "agent_status") {
      if (event.status === this.status) return;
      this.status = event.status;
    }
    this.opts.onEvent(event);
  }

  /** With a conversation id, the session picks up that conversation's earlier turns. */
  async connect(conversationId?: string | null, voice?: string | null) {
    this.closedByUser = false;
    this.emit({ type: "connection", state: "connecting" });
    this.emit({ type: "agent_status", status: "connecting" });
    try {
      this.mic = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
        .catch((err: unknown) => {
          const name = err instanceof DOMException ? err.name : "";
          throw new MicrophoneError(
            name === "NotAllowedError"
              ? "Microphone access was blocked. Allow it in your browser's site settings and try again."
              : "Couldn't start the microphone.",
          );
        });
      this.audioCtx = new AudioContext();
      this.micAnalyser = this.analyse(this.mic);

      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.audioEl = new Audio();
      this.audioEl.autoplay = true;
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (this.audioEl) {
          this.audioEl.srcObject = stream;
          this.audioEl.muted = this.outputMuted;
        }
        this.outAnalyser = this.analyse(stream);
      };
      pc.onconnectionstatechange = () => {
        if (this.closedByUser || this.ending) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.emit({ type: "connection", state: "failed", error: "Connection to GPT-Live was lost." });
          this.emit({ type: "agent_status", status: "error" });
        }
      };
      pc.addTrack(this.mic.getAudioTracks()[0], this.mic);

      // The data channel must exist before the offer is created.
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      const ready = new Promise<void>((resolve) => (this.sessionReady = resolve));
      dc.onmessage = (e) => this.handleServerEvent(JSON.parse(e.data) as ServerEvent);

      await pc.setLocalDescription(await pc.createOffer());
      // Live takes the whole offer in one request, so wait for ICE gathering to finish.
      await this.iceGathered(pc);

      const res = await fetch("/api/voice/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: pc.localDescription?.sdp, conversationId: conversationId ?? null, voice: voice ?? null }),
      });
      const data = (await res.json().catch(() => ({}))) as { sdp?: string; error?: string };
      if (!res.ok || !data.sdp) throw new Error(data.error ?? "Couldn't start a GPT-Live session.");
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });

      await Promise.race([
        ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("GPT-Live didn't start the session.")), 15000)),
      ]);
      this.emit({ type: "connection", state: "connected" });
      this.emit({ type: "agent_status", status: "listening" });
    } catch (err) {
      this.teardown();
      const message = err instanceof Error ? err.message : "Couldn't start the GPT-Live session.";
      this.emit({ type: "connection", state: "failed", error: message });
      this.emit({ type: "agent_status", status: "error" });
      throw err;
    }
  }

  disconnect() {
    this.closedByUser = true;
    this.send({ type: "session.close", event_id: this.nextId("close") });
    this.teardown();
    this.emit({ type: "connection", state: "disconnected" });
    this.emit({ type: "agent_status", status: "idle" });
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: this.nextId("mute") });
  }

  /** Silences the assistant's voice (the mic is separate: setMuted). */
  setOutputMuted(muted: boolean) {
    this.outputMuted = muted;
    this.applyOutputMute();
  }

  /**
   * GPT-Live has no way to cancel a reply, so "stop talking" silences the
   * rest of the current one; the next reply is heard again.
   */
  stopSpeaking() {
    if (!this.assistant) return;
    this.silenced = true;
    this.applyOutputMute();
    this.emit({ type: "assistant_interrupted" });
  }

  /** Typed turns aren't supported by GPT-Live. */
  sendText(_text: string): boolean {
    return false;
  }

  private applyOutputMute() {
    if (this.audioEl) this.audioEl.muted = this.outputMuted || this.silenced;
  }

  /** The assistant opens the call. GPT-Live speaks commentary (thinking stays silent). */
  greet(instruction: string) {
    this.send({ type: "session.commentary.append", event_id: this.nextId("greet"), delegation_id: null, content: instruction });
  }

  /** Tells the assistant quietly about something that happened on screen. */
  sendUiNote(text: string) {
    this.send({ type: "session.thinking.append", event_id: this.nextId("note"), delegation_id: null, content: `[ui] ${text}` });
  }

  levels(): { input: number; output: number } {
    return { input: this.level(this.micAnalyser), output: this.level(this.outAnalyser) };
  }

  // ---------------------------------------------------------------

  private nextId(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private iceGathered(pc: RTCPeerConnection) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        if (pc.iceGatheringState !== "complete") return;
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      };
      pc.addEventListener("icegatheringstatechange", done);
      // Some networks never report "complete"; the candidates gathered so far are enough.
      setTimeout(resolve, 3000);
    });
  }

  private handleServerEvent(ev: ServerEvent) {
    if (DEBUG_EVENTS) logEvent(ev);
    switch (ev.type) {
      case "session.started":
        this.sessionReady?.();
        this.sessionReady = null;
        break;

      case "session.input_transcript.delta":
        this.onUserWords(ev.delta as string);
        break;

      case "session.output_transcript.delta":
        this.onAssistantWords(ev.delta as string);
        break;

      case "response.event":
        this.onBackendEvent(ev.delegation_id as string, ev.event as { type?: string; item?: Item });
        break;

      case "session.closed": {
        this.closing?.();
        if (this.closedByUser || this.ending) break;
        const reason = ev.reason as string | undefined;
        this.teardown();
        this.emit({
          type: "connection",
          state: reason === "close_requested" ? "disconnected" : "failed",
          error: reason === "expired" ? "The GPT-Live session reached its time limit." : undefined,
        });
        this.emit({ type: "agent_status", status: "idle" });
        this.opts.onEnded?.();
        break;
      }

      case "error": {
        const error = ev.error as { message?: string } | undefined;
        this.emit({ type: "error", message: error?.message ?? "GPT-Live reported an error." });
        break;
      }
    }
  }

  private delegation(id: string): Delegation {
    let d = this.delegations.get(id);
    if (!d) {
      d = { calls: 0, rounds: 0, work: Promise.resolve(), answer: "", startedAt: Date.now() };
      this.delegations.set(id, d);
    }
    return d;
  }

  /** Events from the backend model working on something GPT-Live handed off. */
  private onBackendEvent(delegationId: string, event: { type?: string; item?: Item } | undefined) {
    if (!event) return;
    switch (event.type) {
      case "response.created":
        Object.assign(this.delegation(delegationId), { answer: "", startedAt: Date.now() });
        if (this.status !== "speaking") this.emit({ type: "agent_status", status: "processing" });
        break;

      case "response.output_item.done":
        if (event.item?.type === "function_call") this.runTool(delegationId, event.item as unknown as FunctionCallItem);
        else if (event.item?.type === "message") {
          const text = (event.item.content ?? []).map((c) => c.text ?? "").join(" ").trim();
          if (text) this.delegation(delegationId).answer += (this.delegation(delegationId).answer ? " " : "") + text;
        }
        break;

      case "response.completed": {
        const d = this.delegation(delegationId);
        if (d.calls === 0) {
          // The backend's final answer: the voice model should say it now.
          this.delegations.delete(delegationId);
          this.expectSpeech(d.answer, d.startedAt);
          break;
        }
        // Continue once every tool result is in, this hand-off's and any overlapping one's:
        // response.create can't say which hand-off it continues, so leave none half-answered.
        d.calls = 0;
        d.work = this.toolsSettled().then(() => {
          if (++d.rounds > MAX_TOOL_ROUNDS) {
            this.emit({ type: "error", message: "The assistant got stuck calling tools. Please try rephrasing." });
            return;
          }
          this.send({ type: "response.create", event_id: this.nextId("continue") });
        });
        break;
      }
    }
  }

  /** Resolves once no tool is running or queued, including ones queued while waiting. */
  private async toolsSettled() {
    let queue: Promise<void>;
    do {
      queue = this.toolQueue;
      await queue;
    } while (queue !== this.toolQueue);
  }

  private runTool(delegationId: string, call: FunctionCallItem) {
    const d = this.delegation(delegationId);
    d.calls++;
    let args: unknown = {};
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = { __unparseable: call.arguments };
    }
    const run = async () => {
      this.emit({ type: "tool_started", callId: call.call_id, tool: call.name, args });
      let result: ToolResponse;
      try {
        result = await this.opts.executeTool(call.name, args);
      } catch {
        result = {
          output: { ok: false, error: "The board service couldn't be reached." },
          uiEvents: [{ type: "error", message: "The board service couldn't be reached." }],
        };
      }
      result.uiEvents.forEach((e) => this.emit(e));
      this.emit({ type: "tool_finished", callId: call.call_id, tool: call.name, ok: result.output.ok !== false });
      this.send({
        type: "response.item.create",
        event_id: this.nextId("tool_output"),
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result.output) },
      });
    };
    // Run tools one after another across all hand-offs so writes stay in order.
    const job = this.toolQueue.then(run);
    this.toolQueue = job;
    d.work = d.work.then(() => job);
  }

  private onUserWords(delta: string) {
    if (this.ending) return;
    this.user ??= { id: `live-${this.sessionTag}-user-${++this.seq}`, text: "" };
    const u = this.user;
    u.text += delta;
    clearTimeout(u.timer);
    u.timer = setTimeout(() => this.finishUser(), UTTERANCE_GAP_MS);
    this.emit({ type: "user_transcript", id: u.id, text: delta, final: false });
    if (!this.assistant) this.emit({ type: "agent_status", status: "listening" });
  }

  private onAssistantWords(delta: string) {
    this.lastSpokeAt = Date.now();
    if (this.unspoken && this.lastSpokeAt >= this.unspoken.at) this.clearUnspoken();
    this.assistant ??= { id: `live-${this.sessionTag}-assistant-${++this.seq}`, text: "" };
    const a = this.assistant;
    a.text += delta;
    clearTimeout(a.timer);
    a.timer = setTimeout(() => this.finishAssistant(), UTTERANCE_GAP_MS);
    this.emit({ type: "assistant_transcript", id: a.id, text: delta, final: false });
    this.emit({ type: "agent_status", status: "speaking" });
    // The goodbye has started; give it time to finish.
    if (this.ending) this.armEndTimer(GOODBYE_MAX_MS);
  }

  private finishUser() {
    const u = this.user;
    if (!u) return;
    clearTimeout(u.timer);
    this.user = null;
    const text = u.text.trim();
    this.emit({ type: "user_transcript", id: u.id, text, final: true });
    if (!this.ending && isEndRequest(text)) this.endAfterGoodbye();
  }

  private finishAssistant() {
    const a = this.assistant;
    if (!a) return;
    clearTimeout(a.timer);
    this.assistant = null;
    this.emit({ type: "assistant_transcript", id: a.id, text: a.text.trim(), final: true });
    if (this.silenced) {
      this.silenced = false;
      this.applyOutputMute();
    }
    if (this.ending) {
      this.hangUp();
      return;
    }
    this.emit({ type: "agent_status", status: "listening" });
  }

  /**
   * Watch that a finished backend answer actually gets spoken. Speech since
   * the final round started counts: the voice model may begin before the
   * backend reports it's done.
   */
  private expectSpeech(answer: string, since: number) {
    if (this.ending) return;
    this.clearUnspoken();
    if (this.lastSpokeAt >= since) return;
    const at = since;
    this.unspoken = { text: answer, at, nudged: false, timer: setTimeout(() => this.checkSpoken(), SPEAK_WATCHDOG_MS) };
  }

  private checkSpoken() {
    const u = this.unspoken;
    if (!u || this.ending || !this.dc) return this.clearUnspoken();
    if (this.lastSpokeAt >= u.at) return this.clearUnspoken();
    // Don't talk over the user: look again once they pause.
    if (this.user) {
      u.timer = setTimeout(() => this.checkSpoken(), UTTERANCE_GAP_MS);
      return;
    }
    if (!u.nudged) {
      u.nudged = true;
      const result = u.text
        ? `The answer to the user's latest request is ready. Tell them now, briefly: ${u.text}`
        : "The board work for the user's latest request has finished and the results are on their screen. Tell them briefly now.";
      this.send({
        type: "session.commentary.append",
        event_id: this.nextId("unspoken"),
        delegation_id: null,
        content: result.slice(0, MAX_COMMENTARY_CHARS),
      });
      u.timer = setTimeout(() => this.checkSpoken(), NUDGE_GIVE_UP_MS);
      return;
    }
    // Still silent: at least stop showing "Thinking".
    this.clearUnspoken();
    if (this.status === "processing") this.emit({ type: "agent_status", status: "listening" });
  }

  private clearUnspoken() {
    if (this.unspoken) clearTimeout(this.unspoken.timer);
    this.unspoken = null;
  }

  private armEndTimer(ms: number) {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => this.hangUp(), ms);
  }

  /** The user said they're done: let the assistant say goodbye, then hang up. */
  private endAfterGoodbye() {
    this.ending = true;
    this.emit({ type: "session_closing", by: "assistant" });
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = false));
    // finishAssistant() hangs up once the goodbye has been spoken; these are the fallbacks.
    this.armEndTimer(this.assistant ? GOODBYE_MAX_MS : GOODBYE_START_MS);
  }

  private hangUp() {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (!this.dc) return;
    const finish = () => {
      if (!this.dc) return;
      this.closing = null;
      this.teardown();
      this.emit({ type: "connection", state: "disconnected" });
      this.emit({ type: "agent_status", status: "idle" });
      this.opts.onEnded?.();
    };
    this.closing = finish;
    this.send({ type: "session.close", event_id: this.nextId("close") });
    setTimeout(finish, CLOSE_TIMEOUT_MS);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.audioCtx) return null;
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  private level(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  private teardown() {
    for (const u of [this.user, this.assistant]) if (u) clearTimeout(u.timer);
    this.user = this.assistant = null;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    this.closing = null;
    this.sessionReady = null;
    this.delegations.clear();
    this.clearUnspoken();
    this.dc?.close();
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) this.audioEl.srcObject = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.dc = this.pc = this.mic = this.audioEl = this.audioCtx = null;
    this.micAnalyser = this.outAnalyser = null;
  }
}

/** One line per Live event, nested backend events included; skips audio and transcript deltas. */
function logEvent(ev: ServerEvent) {
  if (ev.type.endsWith(".delta")) return;
  if (ev.type === "response.event") {
    const inner = ev.event as { type?: string; item?: { type?: string; name?: string } } | undefined;
    if (!inner?.type || inner.type.endsWith(".delta")) return;
    const what = inner.item ? ` ${inner.item.type}${inner.item.name ? `:${inner.item.name}` : ""}` : "";
    console.debug(`[live] ${String(ev.delegation_id).slice(-6)} ${inner.type}${what}`);
    return;
  }
  const delegation = (ev.delegation as { id?: string } | undefined)?.id;
  console.debug(`[live] ${ev.type}${delegation ? ` ${delegation.slice(-6)}` : ""}${ev.reason ? ` (${String(ev.reason)})` : ""}`);
}
