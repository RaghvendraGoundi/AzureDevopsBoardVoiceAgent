/**
 * Voice test harness: plays a scenario's clips into the app's microphone and
 * records what happened. Runs inside the browser on /voice, against the real
 * voice service and whichever board the app is pointed at.
 *
 *   const { run } = await import("/__voice_test/harness.js");
 *   const report = await run("board-tour");                  // engine selected on screen
 *   const report = await run("board-tour", { engine: "live" });
 *   run("design-tour", { pause: true });  // stops after each step; call window.__voiceTestResume() to go on
 *
 * How it works:
 * - The microphone is replaced: getUserMedia returns a Web Audio stream the
 *   harness plays clips into. A faint noise floor keeps WebRTC sending
 *   packets between clips; without it the stream goes quiet and the server
 *   never sees the end of an utterance.
 * - fetch and the WebRTC data channel are wrapped (not changed) to log tool
 *   calls with their latency and the voice service's events.
 * - After each clip it waits until the assistant is back to "Listening…" for
 *   a while, or, for a "!" step, until it is speaking, then talks over it.
 * - Everything is restored afterwards.
 */

const STATUS = () => document.querySelector('p[aria-live="polite"]')?.textContent?.trim() ?? "";
const LISTENING = "Listening…";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A visible button by its accessible label or text. */
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (b) => !b.closest("[inert]") && (b.getAttribute("aria-label") === text || b.textContent.trim() === text || b.textContent.includes(text)),
  );

async function until(check, timeoutMs, everyMs = 200) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (check()) return true;
    await sleep(everyMs);
  }
  return false;
}

export async function run(name, opts = {}) {
  const idleMs = opts.idleMs ?? 2500;
  if (!location.pathname.startsWith("/voice")) throw new Error("Open /voice first.");
  if (button("End session")) throw new Error("End the current voice session first.");

  const manifest = await (await fetch(`/__voice_test/${name}/manifest.json`)).json();
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const events = []; // [ms, kind, detail]
  const note = (kind, detail = "") => {
    events.push([now(), kind, detail]);
    if (opts.verbose) console.log(`${now()}ms ${kind} ${detail}`);
  };

  // --- fake microphone ---------------------------------------------------
  const ctx = new AudioContext();
  await ctx.resume();
  const mic = ctx.createMediaStreamDestination();
  const floor = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = floor.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.003;
  const floorSrc = ctx.createBufferSource();
  floorSrc.buffer = floor;
  floorSrc.loop = true;
  floorSrc.connect(mic);
  floorSrc.start();
  const clips = await Promise.all(
    manifest.steps.map(async (s) => ctx.decodeAudioData(await (await fetch(`/__voice_test/${name}/${s.audio}`)).arrayBuffer())),
  );
  const play = (buffer) =>
    new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(mic);
      src.onended = resolve;
      src.start();
    });

  // --- observers -----------------------------------------------------------
  const original = {
    getUserMedia: navigator.mediaDevices.getUserMedia,
    fetch: window.fetch,
    createDataChannel: RTCPeerConnection.prototype.createDataChannel,
  };
  navigator.mediaDevices.getUserMedia = async () => mic.stream;
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const started = now();
    const res = await original.fetch.call(window, input, init);
    if (url.includes("/api/voice/tools")) {
      const { name: tool, args } = JSON.parse(init?.body ?? "{}");
      const out = (await res.clone().json().catch(() => ({}))).output ?? {};
      note("tool", `${tool} ${JSON.stringify(args)} → ${out.ok === false ? `error: ${out.error}` : "ok"} (${now() - started}ms)`);
    }
    return res;
  };
  let liveOut = "";
  let liveIn = "";
  RTCPeerConnection.prototype.createDataChannel = function (...a) {
    const dc = original.createDataChannel.apply(this, a);
    dc.addEventListener("message", (m) => {
      const e = JSON.parse(m.data);
      switch (e.type) {
        // Realtime
        case "input_audio_buffer.speech_started":
          return note("speech_started");
        case "input_audio_buffer.committed":
          return note("turn_committed");
        case "conversation.item.input_audio_transcription.completed":
          return note("heard", e.transcript);
        case "output_audio_buffer.started":
          return note("reply_audio");
        case "output_audio_buffer.cleared":
          return note("reply_cut");
        case "response.output_audio_transcript.done":
          return note("said", e.transcript);
        // GPT-Live
        case "session.input_transcript.delta":
          liveIn += e.delta;
          return;
        case "session.output_transcript.delta":
          if (!liveOut) note("reply_audio");
          liveOut += e.delta;
          return;
        case "error":
          return note("error", e.error?.message);
      }
    });
    return dc;
  };
  const flushLive = () => {
    if (liveIn.trim()) note("heard", liveIn.trim());
    if (liveOut.trim()) note("said", liveOut.trim());
    liveIn = liveOut = "";
  };

  const report = { scenario: name, engine: null, steps: [], events };
  try {
    // --- start ---------------------------------------------------------------
    if (opts.engine) {
      // The model is picked in the Settings menu.
      button("Settings")?.click();
      await sleep(200);
      [...document.querySelectorAll('[aria-label="Voice model"] [role="radio"]')]
        .find((r) => r.textContent.includes(opts.engine === "live" ? "GPT-Live" : "Realtime"))
        ?.click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    }
    await sleep(300);
    report.engine = localStorage.getItem("voice-engine") === "live" ? "GPT-Live" : "Realtime";
    button("Start voice session").click();
    const started = performance.now();
    if (!(await until(() => STATUS() === LISTENING, 20000))) throw new Error(`Never got to Listening (status: ${STATUS()})`);
    note("ready", `${Math.round(performance.now() - started)}ms to connect`);
    await sleep(500);

    // --- steps ---------------------------------------------------------------
    for (let i = 0; i < manifest.steps.length; i++) {
      const step = manifest.steps[i];
      const from = events.length;
      note("you", step.said);
      await play(clips[i]);
      const spokeAt = now();

      const next = manifest.steps[i + 1];
      if (next?.interrupt) {
        // Let the assistant start answering, then talk over it.
        await until(() => STATUS() === "Speaking…", 20000);
        await sleep(800);
      } else {
        // Done when it has been listening for idleMs, or nothing happened for 8 s (noise), or the call ended.
        let quietSince = null;
        await until(() => {
          if (button("Start voice session")) return true;
          const busy = STATUS() !== LISTENING;
          const replied = events.slice(from).some(([, k]) => k === "reply_audio" || k === "tool");
          quietSince = busy ? null : (quietSince ?? performance.now());
          const quietFor = quietSince ? performance.now() - quietSince : 0;
          return quietFor >= idleMs && (replied || now() - spokeAt > 8000);
        }, 60000, 250);
      }
      flushLive();

      if (opts.pause && i < manifest.steps.length - 1) {
        // Hold here (e.g. for a screenshot) until window.__voiceTestResume() is called.
        window.__voiceTestPaused = { step: i + 1, said: step.said };
        await new Promise((resume) => (window.__voiceTestResume = resume));
        window.__voiceTestPaused = null;
      }

      const mine = events.slice(from);
      const firstReply = mine.find(([t, k]) => k === "reply_audio" && t >= spokeAt);
      report.steps.push({
        you: step.said,
        heard: mine.filter(([, k]) => k === "heard").map(([, , d]) => d).join(" / ") || "—",
        tools: mine.filter(([, k]) => k === "tool").map(([, , d]) => d),
        assistant: mine.filter(([, k]) => k === "said").map(([, , d]) => d).join(" ") || "(silent)",
        reply_ms: firstReply ? firstReply[0] - spokeAt : null,
      });
      if (button("Start voice session")) break; // the assistant hung up
    }
  } finally {
    button("End session")?.click();
    navigator.mediaDevices.getUserMedia = original.getUserMedia;
    window.fetch = original.fetch;
    RTCPeerConnection.prototype.createDataChannel = original.createDataChannel;
    floorSrc.stop();
    await ctx.close().catch(() => {});
  }

  console.table(
    report.steps.map((s) => ({
      you: s.you,
      heard: s.heard,
      tools: s.tools.map((t) => t.split(" ")[0]).join(", ") || "—",
      reply_ms: s.reply_ms ?? "—",
      assistant: s.assistant.slice(0, 120),
    })),
  );
  window.__voiceTestReport = report;
  return report;
}
