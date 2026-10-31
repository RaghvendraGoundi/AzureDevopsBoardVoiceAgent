#!/usr/bin/env node
/**
 * Turns a voice test scenario into audio clips the browser harness can play
 * into the app as if someone were speaking.
 *
 *   node scripts/voice-test/make-audio.mjs board-tour
 *   node scripts/voice-test/make-audio.mjs --all
 *
 * Scenario files (scripts/voice-test/scenarios/*.txt), one step per line:
 *   # comment
 *   @voice Samantha         macOS voice for the lines below (`say -v '?'` lists them)
 *   What am I working on?   a spoken line
 *   Show me | the bugs      "|" = a 1.3 s pause inside the same utterance
 *   !Stop, only bugs.       "!" = say it while the assistant is still talking (barge-in)
 *   [cough]                 a generated cough-like burst
 *   [silence 2000]          silence, in ms
 *
 * Output: public/__voice_test/<scenario>/NN.wav (24 kHz mono PCM, what the
 * Realtime API expects) plus manifest.json, and a copy of harness.js so the
 * page can import it. public/__voice_test is git-ignored.
 *
 * Needs macOS (`say` and `afconvert`).
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 24_000;
const INNER_PAUSE_MS = 1300;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scenariosDir = path.join(here, "scenarios");
const outRoot = path.join(root, "public", "__voice_test");

if (process.platform !== "darwin") {
  console.error("make-audio needs macOS for the `say` and `afconvert` commands.");
  process.exit(1);
}

/** Parses a scenario file into steps. */
export function parseScenario(text) {
  let voice = "Samantha";
  const steps = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const setting = line.match(/^@voice\s+(.+)$/);
    if (setting) {
      voice = setting[1].trim();
      continue;
    }
    const interrupt = line.startsWith("!");
    const said = interrupt ? line.slice(1).trim() : line;
    steps.push({ said, interrupt, voice, segments: said.split("|").map((s) => s.trim()).filter(Boolean) });
  }
  return steps;
}

/** 16-bit PCM samples for one spoken phrase, via macOS text-to-speech. */
function speak(text, voice, work) {
  const aiff = path.join(work, "t.aiff");
  const wav = path.join(work, "t.wav");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", aiff, wav]);
  return pcmFromWav(readFileSync(wav));
}

/** The PCM data chunk of a WAV file (afconvert may add other chunks first). */
function pcmFromWav(buf) {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + offset + 8, buf.byteOffset + offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error("No data chunk in WAV");
}

const silence = (ms) => new Int16Array(Math.round((RATE * ms) / 1000));

/**
 * Three short bursts of filtered noise with a sharp attack, like a cough.
 * Note: OpenAI's voice detector usually ignores these (real coughs are
 * harsher), so this tests that noise never produces a reply, not that a
 * detected cough is filtered.
 */
function cough() {
  const parts = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const dur of [0.28, 0.32, 0.25]) {
    const n = Math.round(RATE * dur);
    const out = new Int16Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.07);
      lp = lp * 0.55 + rnd() * 0.45;
      const voiced = 0.4 * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.05);
      out[i] = Math.max(-32767, Math.min(32767, Math.round(0.85 * env * (lp + voiced) * 32767)));
    }
    parts.push(out, silence(150));
  }
  return concat(parts);
}

function concat(parts) {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function wavFile(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function build(name) {
  const file = path.join(scenariosDir, `${name}.txt`);
  if (!existsSync(file)) throw new Error(`No scenario ${file}`);
  const steps = parseScenario(readFileSync(file, "utf8"));
  const outDir = path.join(outRoot, name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "voice-test-"));
  try {
    const manifest = { name, steps: [] };
    steps.forEach((step, i) => {
      const parts = [];
      step.segments.forEach((seg, j) => {
        if (j > 0) parts.push(silence(INNER_PAUSE_MS));
        const quiet = seg.match(/^\[silence\s+(\d+)\]$/i);
        if (/^\[cough\]$/i.test(seg)) parts.push(cough());
        else if (quiet) parts.push(silence(Number(quiet[1])));
        else parts.push(speak(seg, step.voice, work));
      });
      const audio = `${String(i + 1).padStart(2, "0")}.wav`;
      writeFileSync(path.join(outDir, audio), wavFile(concat(parts)));
      manifest.steps.push({ said: step.said.replace(/\s*\|\s*/g, " … "), audio, interrupt: step.interrupt });
    });
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`${name}: ${steps.length} clips → public/__voice_test/${name}/`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const names = args.includes("--all")
  ? readdirSync(scenariosDir).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""))
  : args;
if (names.length === 0) {
  console.error("Usage: node scripts/voice-test/make-audio.mjs <scenario> [...] | --all");
  process.exit(1);
}
mkdirSync(outRoot, { recursive: true });
copyFileSync(path.join(here, "harness.js"), path.join(outRoot, "harness.js"));
for (const name of names) build(name);
console.log("\nIn the browser on /voice, open DevTools and run:");
console.log(`  const { run } = await import("/__voice_test/harness.js"); await run("${names[0]}")`);
