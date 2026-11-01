// Records a short greeting in every voice the app offers, for the voice
// picker's previews: public/voices/{realtime,live}/<voice>.m4a
//
//   node scripts/make-voice-samples.mjs            # only missing samples
//   node scripts/make-voice-samples.mjs --force    # redo all
//   node scripts/make-voice-samples.mjs willow     # just these voices
//
// Realtime voices come from the speech API (gpt-4o-mini-tts). GPT-Live voices
// aren't available there, so each is recorded from a short GPT-Live session
// over WebSocket that's asked to say the line. Needs OPENAI_API_KEY (read from
// .env.local) and macOS afconvert for the m4a encoding.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const line of readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.OPENAI_API_KEY?.trim();
if (!KEY) throw new Error("OPENAI_API_KEY is not set.");

// Keep in step with src/lib/voice/voices.ts.
const voicesTs = readFileSync(path.join(root, "src/lib/voice/voices.ts"), "utf8");
const listOf = (name) => [...voicesTs.split(`export const ${name}`)[1].split("];")[0].matchAll(/id: "([a-z]+)", label: "([A-Za-z]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
const VOICES = { realtime: listOf("REALTIME_VOICES"), live: listOf("LIVE_VOICES") };

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((a) => !a.startsWith("--")));

const line = (label) => `Hi, I'm ${label}! I can check your sprint, create stories and move work along. Just ask.`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toM4a(input, out) {
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", input, out]);
}

function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Cuts the silence before and after the speech in 16-bit PCM, keeping a little padding. Null if all silent. */
function trimSilence(pcm, rate = 24000) {
  const n = pcm.length / 2;
  const win = rate / 50; // 20 ms windows
  const loud = (i) => {
    let peak = 0;
    for (let j = i; j < Math.min(n, i + win); j++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(j * 2)));
    return peak > 900;
  };
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i += win) if (loud(i)) { if (first < 0) first = i; last = i + win; }
  if (first < 0) return null;
  const pad = rate * 0.15;
  return pcm.subarray(Math.max(0, first - pad) * 2, Math.min(n, last + pad) * 2);
}

async function realtimeSample(v, tmp) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: v.id,
      input: line(v.label),
      instructions: "Warm, friendly and upbeat, like a helpful teammate saying hello.",
      response_format: "wav",
    }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}: ${await res.text()}`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
}

/** Opens a GPT-Live session in this voice, asks it to say the line, and records the reply. */
async function liveSample(v, tmp) {
  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${KEY}` } });
  const chunks = [];
  let said = "";
  let lastWords = 0;
  let started = false;
  let error = null;
  ws.onmessage = (e) => {
    const ev = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString());
    if (ev.type === "session.started") started = true;
    else if (ev.type === "session.output_audio.delta") {
      chunks.push(Buffer.from(ev.delta ?? ev.audio ?? "", "base64"));
    } else if (ev.type === "session.output_transcript.delta") {
      said += ev.delta;
      lastWords = Date.now();
    }
    else if (ev.type === "error") error = ev.error?.message ?? JSON.stringify(ev);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WebSocket failed to open"));
  });
  const send = (o) => ws.send(JSON.stringify(o));
  send({
    type: "session.start",
    event_id: "start",
    session: {
      model: process.env.OPENAI_LIVE_MODEL?.trim() || "gpt-live-1",
      instructions: "You are recording a short voice sample. Say exactly the line you are given, warmly and cheerfully, then stop. Say nothing else.",
      audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: v.id } },
    },
  });
  for (let i = 0; i < 100 && !started && !error; i++) await sleep(100);
  if (!started) throw new Error(error ?? "session didn't start");

  // Keep silence flowing in, as the guide recommends, while it speaks.
  const silence = Buffer.alloc(4800).toString("base64"); // 100 ms
  const feed = setInterval(() => send({ type: "session.input_audio.append", audio: silence }), 100);
  send({ type: "session.instructions.append", event_id: "say", delegation_id: null, content: `Immediately say the following exactly and in full: "${line(v.label)}"` });

  // Live streams audio (silence included) the whole time, so stop on the transcript instead.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !error) {
    await sleep(200);
    if (lastWords && Date.now() - lastWords > 2000) break;
  }
  clearInterval(feed);
  ws.close();
  if (error) throw new Error(error);
  const speech = trimSilence(Buffer.concat(chunks));
  if (!speech) throw new Error("it didn't say anything");
  writeFileSync(tmp, wav(speech));
  return said.trim();
}

for (const engine of ["realtime", "live"]) {
  const dir = path.join(root, "public/voices", engine);
  mkdirSync(dir, { recursive: true });
  for (const v of VOICES[engine]) {
    if (only.size && !only.has(v.id)) continue;
    const out = path.join(dir, `${v.id}.m4a`);
    if (existsSync(out) && !force) continue;
    const tmp = path.join(dir, `${v.id}.tmp.wav`);
    try {
      // GPT-Live sometimes stays silent when asked to speak; try again a couple of times.
      let said = "";
      for (let attempt = 1; ; attempt++) {
        try {
          said = engine === "live" ? await liveSample(v, tmp) : await realtimeSample(v, tmp);
          break;
        } catch (err) {
          if (engine !== "live" || attempt >= 3) throw err;
        }
      }
      toM4a(tmp, out);
      console.log(`${engine}/${v.id}  ok${said ? `  "${said}"` : ""}`);
    } catch (err) {
      console.error(`${engine}/${v.id}  FAILED: ${err.message}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
}
