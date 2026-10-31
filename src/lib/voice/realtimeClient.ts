"use client";

import type { AgentStatus, ToolResponse, VoiceEvent } from "@/types/voice";
import {
  decideTurn,
  isRealSpeech,
  SHORT_TURN_TRANSCRIPT_WAIT_MS,
  transcriptConfidence,
} from "./turnGate";

/** Tools after which the model should stay silent instead of being prompted to reply. */
const SILENT_TOOLS = new Set(["wait_for_user"]);

/** Ends the call once the assistant has finished saying goodbye. */
const END_TOOL = "end_session";

/** Upper bound on waiting for the goodbye to finish playing before hanging up. */
const GOODBYE_MAX_MS = 8000;

/** Presses shorter than this are treated as accidental. */
const MIN_PTT_MS = 250;

/** How long to wait for the server to confirm the session before listening anyway. */
const SESSION_READY_TIMEOUT_MS = 3000;

/**
 * Browser-side Realtime client over raw WebRTC. Works for both OpenAI and
 * Azure because both implement the GA Realtime event protocol. It translates
 * provider events into our provider-agnostic VoiceEvent stream, so nothing
 * in the UI knows which provider is in use.
 *
 * Turn-taking: the server only detects and commits speech. Every turn is
 * checked against its transcript (see turnGate.ts) before it counts. Long
 * turns get a reply started right away to save time, and that reply is
 * cancelled before anything runs if the transcript turns out to be noise.
 * While the assistant talks, the server's voice detector is made stricter,
 * because the server silences the assistant the moment it fires. If what it
 * heard turns out to be noise, the assistant picks up where it left off.
 *
 * Replies: the server allows one active response at a time and rejects
 * response.create otherwise. Every reply request goes through
 * requestResponse(), which defers it until the current response (or tool
 * run) finishes, so a user turn is never silently dropped.
 */

export type InputMode = "handsfree" | "ptt";

export interface RealtimeClientOptions {
  onEvent: (event: VoiceEvent) => void;
  /** Runs a tool call on the backend. */
  executeTool: (name: string, args: unknown) => Promise<ToolResponse>;
  /** The assistant ended the call itself (the user said they were done). */
  onEnded?: () => void;
}

export interface SessionCredentials {
  clientSecret: string;
  webrtcUrl: string;
  /** The hands-free turn detection config, restored when leaving push-to-talk. */
  turnDetection: Record<string, unknown> | null;
  /** The stricter version used while the assistant is talking. */
  speakingTurnDetection: Record<string, unknown> | null;
}

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

type ServerEvent = { type: string; [key: string]: unknown };

interface ResponseDone {
  id?: string;
  /** "completed" | "cancelled" | "failed" | "incomplete" */
  status?: string;
  output?: Array<{ type: string }>;
}

/** Errors that are expected side effects of cancelling or gating and safe to hide. */
const BENIGN_ERRORS = new Set([
  "response_cancel_not_active",
  "conversation_already_has_active_response",
  "input_audio_buffer_commit_empty",
]);

const RESUME_NOTE =
  "Background noise cut off your last reply. Carry on from where you stopped in one short sentence, " +
  "including any step you were about to take. Don't start over or apologise.";

export class MicrophoneError extends Error {}

export class RealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private levelBuf = new Uint8Array(256);
  private closedByUser = false;
  private toolRounds = 0;
  private status: AgentStatus = "idle";
  private quietTimer: ReturnType<typeof setInterval> | null = null;

  private handsFreeTurnDetection: Record<string, unknown> | null = null;
  private speakingTurnDetection: Record<string, unknown> | null = null;
  /** The stricter detector is active on the server. */
  private strictVad = false;
  /**
   * The user started talking over the assistant. Keep the strict detector
   * until their turn ends: switching to semantic VAD mid-sentence sometimes
   * took ~6s to notice they had finished.
   */
  private bargeIn = false;
  private mode: InputMode = "handsfree";
  private muted = false;
  private pttStartedAt: number | null = null;
  /** Server-reported speech timing per input item, used to judge short bursts. */
  private speech = new Map<string, { start?: number; end?: number }>();
  /** Turns waiting for their transcript before we decide whether they count. */
  private pendingTurns = new Map<string, ReturnType<typeof setTimeout>>();
  /** A reply started before its turn's transcript arrived; cancelled if the turn was noise. */
  private speculative: {
    itemId: string;
    responseId: string | null;
    verdict: Promise<boolean>;
    settle: (ok: boolean) => void;
  } | null = null;
  /** Cancel the next response as soon as the server creates it. */
  private cancelOnCreate = false;
  private ending = false;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  /** Hangs up now; set while the goodbye is playing. */
  private finishEnding: (() => void) | null = null;

  // Response scheduling
  private responseRequested = false;
  private responseActive = false;
  private currentResponseId: string | null = null;
  private toolsInFlight = false;
  private wantResponse = false;
  /** Responses we cancelled; their late transcript/audio events are ignored. */
  private cancelledResponses = new Set<string>();
  /** We sent output_audio_buffer.clear ourselves (vs. the server clearing on detected sound). */
  private clearedByUs = false;
  /** The server cut the assistant's audio because it heard something; resume if it was only noise. */
  private clippedByNoise = false;

  private sessionReady: (() => void) | null = null;

  constructor(private readonly opts: RealtimeClientOptions) {}

  private emit(event: VoiceEvent) {
    if (event.type === "agent_status") {
      this.status = event.status;
      this.setStrictVad(event.status === "speaking" || this.bargeIn);
    }
    this.opts.onEvent(event);
  }

  async connect(fetchCredentials: () => Promise<SessionCredentials>, mode: InputMode = "handsfree") {
    this.closedByUser = false;
    this.mode = mode;
    this.emit({ type: "connection", state: "connecting" });
    this.emit({ type: "agent_status", status: "connecting" });

    // Mint the session key while the mic permission prompt is up, not after.
    const credsPromise = fetchCredentials();
    credsPromise.catch(() => undefined); // handled when awaited below

    try {
      // Auto gain is off: it boosts the noise floor whenever you're quiet.
      this.mic = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
        .catch((err: unknown) => {
          const name = err instanceof DOMException ? err.name : "";
          throw new MicrophoneError(
            name === "NotAllowedError"
              ? "Microphone access was blocked. Allow it in your browser's site settings and try again."
              : name === "NotFoundError"
                ? "No microphone was found."
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
        if (this.audioEl) this.audioEl.srcObject = stream;
        this.outAnalyser = this.analyse(stream);
      };
      pc.onconnectionstatechange = () => {
        if (this.closedByUser) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.emit({ type: "connection", state: "failed", error: "Connection to the voice service was lost." });
          this.emit({ type: "agent_status", status: "error" });
        }
      };
      pc.addTrack(this.mic.getAudioTracks()[0], this.mic);

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      const ready = new Promise<void>((resolve) => (this.sessionReady = resolve));
      dc.onmessage = (e) => this.handleServerEvent(JSON.parse(e.data) as ServerEvent);
      const opened = new Promise<void>((resolve, reject) => {
        dc.onopen = () => resolve();
        setTimeout(() => reject(new Error("Timed out opening the voice channel.")), 15000);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const creds = await credsPromise;
      this.handsFreeTurnDetection = creds.turnDetection;
      this.speakingTurnDetection = creds.speakingTurnDetection;
      const res = await fetch(creds.webrtcUrl, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${creds.clientSecret}`, "Content-Type": "application/sdp" },
      });
      if (!res.ok) throw new Error(`Voice service refused the call (${res.status}).`);
      await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      await opened;

      // Only say "Listening" once the server has actually set up the session,
      // so the first words aren't spoken into a call that isn't ready yet.
      await Promise.race([ready, new Promise((r) => setTimeout(r, SESSION_READY_TIMEOUT_MS))]);

      if (this.mode === "ptt") this.applyMode();
      this.emit({ type: "connection", state: "connected" });
      this.emit({ type: "agent_status", status: "listening" });
      this.chime();
    } catch (err) {
      this.teardown();
      const message = err instanceof Error ? err.message : "Couldn't start the voice session.";
      this.emit({ type: "connection", state: "failed", error: message });
      this.emit({ type: "agent_status", status: "error" });
      throw err;
    }
  }

  disconnect() {
    this.closedByUser = true;
    this.teardown();
    this.emit({ type: "connection", state: "disconnected" });
    this.emit({ type: "agent_status", status: "idle" });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.syncMicTrack();
  }

  /** Switch between hands-free (voice detection) and push-to-talk. */
  setMode(mode: InputMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.pttStartedAt = null;
    this.applyMode();
  }

  /** Push-to-talk pressed: stop the assistant and start a fresh turn. */
  pttStart() {
    if (this.mode !== "ptt" || this.pttStartedAt !== null) return;
    if (this.assistantBusy()) this.interrupt();
    this.send({ type: "input_audio_buffer.clear" });
    this.pttStartedAt = performance.now();
    this.syncMicTrack();
    this.emit({ type: "agent_status", status: "listening" });
  }

  /** Push-to-talk released: commit what was said and ask for a reply. */
  pttEnd() {
    if (this.mode !== "ptt" || this.pttStartedAt === null) return;
    const heldMs = performance.now() - this.pttStartedAt;
    this.pttStartedAt = null;
    // Keep the mic open briefly so the last syllable reaches the server.
    setTimeout(() => {
      this.syncMicTrack();
      if (heldMs < MIN_PTT_MS) {
        this.send({ type: "input_audio_buffer.clear" });
        return;
      }
      this.send({ type: "input_audio_buffer.commit" });
      this.requestResponse();
    }, 200);
  }

  /** Tells the model about something the user did on screen (e.g. pressed Confirm). */
  sendUiNote(text: string) {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: `[ui] ${text}` }] },
    });
    this.requestResponse();
  }

  /** 0..1 RMS-ish levels for the orb animation. */
  levels(): { input: number; output: number } {
    return { input: this.level(this.micAnalyser), output: this.level(this.outAnalyser) };
  }

  // ---------------------------------------------------------------

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  /** Ask for a reply now, or as soon as the current response / tool run finishes. */
  private requestResponse() {
    if (this.responseActive || this.responseRequested || this.toolsInFlight) {
      this.wantResponse = true;
      return;
    }
    this.wantResponse = false;
    this.responseRequested = true;
    this.send({ type: "response.create" });
  }

  /** Called whenever the server becomes free: send a reply request that was waiting. */
  private flushDeferredResponse() {
    if (this.wantResponse) this.requestResponse();
  }

  /** The mic is live when not muted and, in push-to-talk, only while held. */
  private syncMicTrack() {
    const live = !this.muted && (this.mode === "handsfree" || this.pttStartedAt !== null);
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = live));
  }

  /** Switch the server between the normal and the stricter (assistant talking) voice detector. */
  private setStrictVad(strict: boolean) {
    if (this.mode !== "handsfree" || !this.speakingTurnDetection || strict === this.strictVad) return;
    this.strictVad = strict;
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: { input: { turn_detection: strict ? this.speakingTurnDetection : this.handsFreeTurnDetection } },
      },
    });
  }

  private applyMode() {
    this.strictVad = false;
    this.syncMicTrack();
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: { input: { turn_detection: this.mode === "ptt" ? null : this.handsFreeTurnDetection } },
      },
    });
  }

  private assistantBusy() {
    return this.responseActive || this.responseRequested || this.status === "speaking";
  }

  /** Stop the assistant mid-reply. */
  private interrupt() {
    this.clippedByNoise = false;
    if (this.responseActive) {
      this.send({ type: "response.cancel" });
      if (this.currentResponseId) this.cancelledResponses.add(this.currentResponseId);
    }
    this.clearedByUs = true;
    this.send({ type: "output_audio_buffer.clear" });
    this.stopQuietWatch();
    this.emit({ type: "assistant_interrupted" });
    this.emit({ type: "agent_status", status: "listening" });
  }

  /** Answer a long turn immediately; its transcript decides later whether the reply stands. */
  private startSpeculative(itemId: string) {
    let settle!: (ok: boolean) => void;
    const verdict = new Promise<boolean>((r) => (settle = r));
    this.speculative = { itemId, responseId: null, verdict, settle };
    this.requestResponse();
  }

  /** The transcript (or its timeout) has decided whether a turn was real speech. */
  private settleTurn(itemId: string, ok: boolean) {
    const timer = this.pendingTurns.get(itemId);
    if (timer) clearTimeout(timer);
    this.pendingTurns.delete(itemId);

    const spec = this.speculative?.itemId === itemId ? this.speculative : null;
    if (spec) {
      this.speculative = null;
      spec.settle(ok);
      if (ok) return; // the reply already under way stands
      this.cancelSpeculativeReply(spec.responseId);
      this.dropTurn(itemId);
      return;
    }
    if (ok) this.acceptTurn();
    else this.dropTurn(itemId);
  }

  /** Withdraw a reply that was started for what turned out to be noise. */
  private cancelSpeculativeReply(responseId: string | null) {
    if (!responseId) {
      if (this.responseRequested) this.cancelOnCreate = true;
      return;
    }
    this.cancelledResponses.add(responseId);
    if (this.responseActive && this.currentResponseId === responseId) this.send({ type: "response.cancel" });
    if (this.status === "speaking") {
      this.clearedByUs = true;
      this.send({ type: "output_audio_buffer.clear" });
      this.emit({ type: "assistant_interrupted" });
    }
  }

  /** A committed user turn that counts as real speech: answer it. */
  private acceptTurn() {
    this.clippedByNoise = false;
    if (this.assistantBusy()) this.interrupt();
    this.requestResponse();
  }

  /** A committed user turn that was just noise: remove it so the model never sees it. */
  private dropTurn(itemId: string) {
    this.send({ type: "conversation.item.delete", item_id: itemId });
    this.emit({ type: "user_transcript", id: itemId, text: "", final: true });

    // The noise also cut the assistant off mid-sentence; let it finish instead of going silent.
    if (this.clippedByNoise) {
      this.clippedByNoise = false;
      this.send({
        type: "conversation.item.create",
        item: { type: "message", role: "system", content: [{ type: "input_text", text: RESUME_NOTE }] },
      });
      this.requestResponse();
    } else if (!this.assistantBusy() && !this.toolsInFlight) {
      this.emit({ type: "agent_status", status: "listening" });
    }
  }

  /** The assistant said goodbye: hang up once it has finished speaking. */
  private endAfterGoodbye() {
    if (this.ending) return;
    this.ending = true;
    // Nothing the user says from here on should start a new turn.
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = false));
    const hangUp = () => {
      if (this.endTimer) clearTimeout(this.endTimer);
      this.endTimer = null;
      this.chime([880, 660]);
      setTimeout(() => {
        if (this.closedByUser) return;
        this.disconnect();
        this.opts.onEnded?.();
      }, 400);
    };
    this.finishEnding = hangUp;
    // output_audio_buffer.stopped calls finishEnding when the goodbye ends; this is the fallback.
    this.endTimer = setTimeout(hangUp, this.status === "speaking" ? GOODBYE_MAX_MS : 300);
  }

  /** Short two-note cue: rising when the assistant is ready to listen, falling when it hangs up. */
  private chime(notes: [number, number] = [660, 880]) {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const t = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.06, t + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.2);
    });
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
    this.stopQuietWatch();
    this.pendingTurns.forEach((t) => clearTimeout(t));
    this.pendingTurns.clear();
    this.speculative?.settle(false);
    this.speculative = null;
    this.cancelOnCreate = this.strictVad = this.bargeIn = false;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    this.finishEnding = null;
    this.speech.clear();
    this.cancelledResponses.clear();
    this.responseActive = this.responseRequested = this.toolsInFlight = this.wantResponse = false;
    this.clippedByNoise = this.clearedByUs = false;
    this.currentResponseId = null;
    this.pttStartedAt = null;
    this.sessionReady = null;
    this.dc?.close();
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) this.audioEl.srcObject = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.dc = this.pc = this.mic = this.audioEl = this.audioCtx = null;
    this.micAnalyser = this.outAnalyser = null;
  }

  private isStale(ev: ServerEvent) {
    const id = ev.response_id as string | undefined;
    return id !== undefined && this.cancelledResponses.has(id);
  }

  private handleServerEvent(ev: ServerEvent) {
    switch (ev.type) {
      case "session.created":
        this.sessionReady?.();
        this.sessionReady = null;
        break;

      case "input_audio_buffer.speech_started":
        this.speech.set(ev.item_id as string, { start: ev.audio_start_ms as number });
        if (this.strictVad) this.bargeIn = true;
        break;

      case "input_audio_buffer.speech_stopped": {
        const timing = this.speech.get(ev.item_id as string) ?? {};
        this.speech.set(ev.item_id as string, { ...timing, end: ev.audio_end_ms as number });
        break;
      }

      case "input_audio_buffer.committed": {
        const itemId = ev.item_id as string;
        if (this.bargeIn) {
          this.bargeIn = false;
          this.setStrictVad(this.status === "speaking");
        }
        // Placeholder at commit time keeps user turns ordered before the reply.
        this.emit({ type: "user_transcript", id: itemId, text: "", final: false });
        // Push-to-talk turns were deliberate; pttEnd() already asked for a reply.
        if (this.mode === "ptt") break;

        if (this.ending) break;
        const timing = this.speech.get(itemId);
        this.speech.delete(itemId);
        const duration =
          timing?.start !== undefined && timing.end !== undefined ? timing.end - timing.start : null;
        const long = decideTurn(duration) === "respond";
        // Without a transcript in time, a long turn is assumed to be speech and a short one noise.
        this.pendingTurns.set(itemId, setTimeout(() => this.settleTurn(itemId, long), SHORT_TURN_TRANSCRIPT_WAIT_MS));
        // Speculate only when idle; over a reply, wait for the transcript before cutting it off.
        if (long && !this.assistantBusy() && !this.toolsInFlight && !this.speculative) this.startSpeculative(itemId);
        break;
      }

      case "conversation.item.input_audio_transcription.delta":
        this.emit({ type: "user_transcript", id: ev.item_id as string, text: ev.delta as string, final: false });
        break;

      case "conversation.item.input_audio_transcription.completed": {
        const itemId = ev.item_id as string;
        const transcript = (ev.transcript as string).trim();
        const real = isRealSpeech(transcript, transcriptConfidence(ev.logprobs as Array<{ logprob: number }> | undefined));
        if (this.pendingTurns.has(itemId)) this.settleTurn(itemId, real);
        this.emit({ type: "user_transcript", id: itemId, text: real ? transcript : "", final: true });
        break;
      }

      case "response.created": {
        const response = ev.response as { id?: string } | undefined;
        this.responseRequested = false;
        this.responseActive = true;
        this.currentResponseId = response?.id ?? null;
        if (this.cancelOnCreate) {
          // Requested for a turn that has since been found to be noise.
          this.cancelOnCreate = false;
          if (response?.id) this.cancelledResponses.add(response.id);
          this.send({ type: "response.cancel" });
          break;
        }
        if (this.speculative && !this.speculative.responseId) this.speculative.responseId = response?.id ?? null;
        this.emit({ type: "agent_status", status: "processing" });
        break;
      }

      case "response.output_audio_transcript.delta":
        if (this.isStale(ev)) break;
        if (this.status !== "speaking") this.emit({ type: "agent_status", status: "speaking" });
        this.emit({ type: "assistant_transcript", id: ev.item_id as string, text: ev.delta as string, final: false });
        break;
      case "response.output_audio_transcript.done":
        if (this.isStale(ev)) break;
        this.emit({ type: "assistant_transcript", id: ev.item_id as string, text: ev.transcript as string, final: true });
        break;

      case "output_audio_buffer.started":
        if (this.isStale(ev)) break;
        this.emit({ type: "agent_status", status: "speaking" });
        break;

      case "output_audio_buffer.cleared":
        this.stopQuietWatch();
        // If we didn't ask for this, the server cut the assistant off because it
        // heard something. The rest of the reply would be inaudible, so stop it;
        // if the sound was only noise, dropTurn() has the assistant carry on.
        if (!this.clearedByUs && this.status === "speaking") {
          this.clippedByNoise = true;
          if (this.responseActive && this.currentResponseId) {
            this.cancelledResponses.add(this.currentResponseId);
            this.send({ type: "response.cancel" });
          }
          this.emit({ type: "assistant_interrupted" });
          this.emit({ type: "agent_status", status: "listening" });
        } else if (!this.responseActive || this.isStale(ev)) {
          this.emit({ type: "agent_status", status: "listening" });
        }
        this.clearedByUs = false;
        break;

      case "output_audio_buffer.stopped":
        this.stopQuietWatch();
        if (this.ending) {
          this.finishEnding?.();
          break;
        }
        if (!this.responseActive && !this.toolsInFlight) this.emit({ type: "agent_status", status: "listening" });
        break;

      case "response.done":
        this.responseActive = false;
        this.responseRequested = false;
        void this.handleResponseDone(ev.response as ResponseDone);
        break;

      case "error": {
        const error = ev.error as { message?: string; code?: string } | undefined;
        if (error?.code === "conversation_already_has_active_response") {
          // Our request lost a race with a response the server already started; retry when it ends.
          this.responseRequested = false;
          this.wantResponse = true;
        }
        if (error?.code && BENIGN_ERRORS.has(error.code)) break;
        this.emit({ type: "error", message: error?.message ?? "The voice service reported an error." });
        break;
      }
    }
  }

  /**
   * Fallback for returning to "listening" when audio playback ends, in case
   * the provider doesn't send output_audio_buffer.stopped: wait until the
   * speaker has been quiet for ~800ms.
   */
  private startQuietWatch() {
    this.stopQuietWatch();
    let quietTicks = 0;
    this.quietTimer = setInterval(() => {
      quietTicks = this.level(this.outAnalyser) < 0.02 ? quietTicks + 1 : 0;
      if (quietTicks >= 4) {
        this.stopQuietWatch();
        if ((this.status === "speaking" || this.status === "processing") && !this.assistantBusy()) {
          this.emit({ type: "agent_status", status: "listening" });
        }
      }
    }, 200);
  }

  private stopQuietWatch() {
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.quietTimer = null;
  }

  /** Runs every function call in a finished response, returns outputs, then asks for a follow-up reply. */
  private async handleResponseDone(response: ResponseDone) {
    if (response.id && this.cancelledResponses.has(response.id)) response = { ...response, status: "cancelled" };
    // A reply started before its turn was verified: hold its tool calls until we know it wasn't noise.
    const spec = this.speculative;
    if (response.status !== "cancelled" && spec && response.id && spec.responseId === response.id && !(await spec.verdict)) {
      response = { ...response, status: "cancelled" };
    }

    const calls = (response.output ?? []).filter((o): o is FunctionCallItem => o.type === "function_call");

    // The user talked over this response. Don't act on half-heard intent: tell
    // the model the calls didn't run and let the new user turn drive the next reply.
    if (response.status === "cancelled") {
      for (const call of calls) {
        this.sendToolOutput(call.call_id, { ok: false, error: "Not run: the user interrupted before it started." });
      }
      if (this.status !== "speaking") this.emit({ type: "agent_status", status: "listening" });
      this.flushDeferredResponse();
      return;
    }

    if (calls.length === 0) {
      this.toolRounds = 0;
      this.startQuietWatch();
      this.flushDeferredResponse();
      return;
    }
    // Guard against a model stuck in a tool loop.
    if (++this.toolRounds > 6) {
      this.toolRounds = 0;
      this.emit({ type: "error", message: "The assistant got stuck calling tools. Please try rephrasing." });
      this.flushDeferredResponse();
      return;
    }

    let needsReply = false;
    this.toolsInFlight = true;
    try {
      for (const call of calls) {
        if (call.name === END_TOOL) {
          this.sendToolOutput(call.call_id, { ok: true });
          this.endAfterGoodbye();
          continue;
        }
        if (SILENT_TOOLS.has(call.name)) {
          this.sendToolOutput(call.call_id, { ok: true });
          continue;
        }
        needsReply = true;

        let args: unknown = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = { __unparseable: call.arguments };
        }
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
        this.sendToolOutput(call.call_id, result.output);
      }
    } finally {
      this.toolsInFlight = false;
    }

    if (this.ending) return;
    // One reply covers both the tool results and anything the user said meanwhile.
    if (needsReply || this.wantResponse) {
      this.requestResponse();
    } else {
      this.toolRounds = 0;
      if (!this.assistantBusy()) this.emit({ type: "agent_status", status: "listening" });
    }
  }

  private sendToolOutput(callId: string, output: Record<string, unknown>) {
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    });
  }
}
