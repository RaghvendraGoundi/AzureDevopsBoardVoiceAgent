#!/usr/bin/env node
/**
 * Full-resolution screenshots of the app's main screens and states, for
 * design reviews. Drives headless Chrome (a throwaway profile, never yours)
 * through the voice "design-tour" scenario with the harness paused at each
 * step, then the board page and the phone layout.
 *
 *   npm run dev                                   # app running on :3000
 *   node scripts/voice-test/make-audio.mjs design-tour
 *   node scripts/voice-test/capture.mjs [outDir]  # default .data/screenshots
 *
 * The voice steps use the real voice service and board (the tour proposes a
 * change and then cancels it, so nothing is written), and the call is saved
 * as a conversation like any other. Needs Google Chrome in /Applications.
 */

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);
const outDir = path.resolve(process.argv[2] ?? ".data/screenshots");
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const profile = mkdtempSync(path.join(tmpdir(), "voice-capture-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = pages.find((p) => p.type === "page");
      if (page) return { chrome, profile, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  chrome.kill();
  throw new Error("Chrome didn't start");
}

/** A minimal Chrome DevTools Protocol client. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const w of [...waiters]) if (w.method === msg.method) w.resolve(msg.params), waiters.splice(waiters.indexOf(w), 1);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  return new Promise((resolve) => (ws.onopen = () => resolve({ send, once, close: () => ws.close() })));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  // The page imports the harness from public/; make sure it's the current one.
  copyFileSync(path.join(import.meta.dirname, "harness.js"), path.resolve("public/__voice_test/harness.js"));
  const { chrome, profile, wsUrl } = await launch();
  const cdp = await connect(wsUrl);
  const shots = [];
  try {
    await cdp.send("Page.enable");
    async function evaluate(expression) {
      return (await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
    }
    const waitFor = async (expression, timeoutMs = 60000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (await evaluate(expression)) return true;
        await sleep(250);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    };
    const goto = async (url, settleMs = 1500) => {
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url });
      await loaded;
      await sleep(settleMs);
      // Hide Next.js's development badge; it isn't part of the design.
      await evaluate(`(() => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.append(s); })()`);
    };
    const shot = async (name, note) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(outDir, `${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      shots.push({ name, note });
      console.log(`  ${name}.png  ${note}`);
    };
    const viewport = (v) => cdp.send("Emulation.setDeviceMetricsOverride", v);
    const status = `document.querySelector('p[aria-live="polite"]')?.textContent`;

    console.log(`Capturing ${APP} → ${outDir}`);
    await viewport(DESKTOP);
    await goto(`${APP}/voice`);
    await shot("01-voice-idle", "Arrive: only the orb");

    // The voice tour, paused after each step.
    await evaluate(`import("/__voice_test/harness.js").then(m => { window.__tour = m.run("design-tour", { engine: "realtime", pause: true }); })`);
    await waitFor(`${status} === "Speaking…"`);
    await sleep(1200);
    await shot("02-voice-speaking", "Answering “What am I working on this sprint?”");
    await waitFor(`window.__voiceTestPaused?.step === 1`);
    await sleep(600);
    await shot("03-voice-results", "My sprint work listed in the workspace");
    await evaluate(`window.__voiceTestResume()`);
    await waitFor(`window.__voiceTestPaused?.step === 2`);
    await sleep(600);
    await shot("04-voice-confirmation", "A change waiting for a yes");
    await evaluate(`window.__voiceTestResume()`);
    await waitFor(`window.__voiceTestPaused?.step === 3`);
    await sleep(600);
    await shot("05-voice-cancelled", "After “No, cancel that”");
    await evaluate(`window.__voiceTestResume()`);
    await waitFor(`!!document.querySelector('[role="alertdialog"]')`);
    await shot("06-closing", "“Closing session…” while the assistant says goodbye");
    await waitFor(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`);
    await sleep(500);
    await shot("07-session-ended", "Summary when the call ends");
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await sleep(500);
    await evaluate(`document.querySelector('[aria-label="Open chat"]')?.click()`);
    await sleep(900);
    await shot("08-conversation-saved", "Look back: chat and workspace open");

    await goto(`${APP}/board`, 2500);
    await shot("09-board", "Sprint board");

    await viewport(PHONE);
    await goto(`${APP}/voice`);
    await shot("10-phone-voice", "Voice page on a phone");
    await evaluate(`document.querySelector('[aria-label="Open chat"]').click()`);
    await sleep(600);
    await evaluate(`document.querySelector('[role="dialog"] [aria-label="Show conversations"]')?.click()`);
    await sleep(400);
    await shot("11-phone-conversations", "Conversations in the chat sheet on a phone");
    await goto(`${APP}/board`, 2500);
    await shot("12-phone-board", "Sprint board on a phone");

    writeFileSync(path.join(outDir, "shots.json"), JSON.stringify(shots, null, 2));
    console.log(`\n${shots.length} screenshots in ${outDir}`);
  } finally {
    cdp.close();
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
