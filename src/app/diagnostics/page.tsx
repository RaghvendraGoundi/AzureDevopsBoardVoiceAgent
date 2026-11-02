"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, CloseIcon, LogoMark } from "@/components/voice/icons";
import { RealtimeClient, type ConnectStage } from "@/lib/voice/realtimeClient";
import { fetchSessionCredentials } from "@/lib/voice/toolExecutor";

interface Result {
  name: string;
  ok: boolean | null;
  ms?: number;
  detail: string;
}

const STUN = ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"];

/** Can this network reach the internet over UDP? WebRTC audio needs it (srflx candidates appear when it can). */
async function udpCheck(): Promise<Result> {
  const started = performance.now();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
  pc.createDataChannel("probe");
  const found = new Promise<boolean>((resolve) => {
    pc.onicecandidate = (e) => {
      if (e.candidate?.type === "srflx" || e.candidate?.candidate.includes(" srflx ")) resolve(true);
      if (!e.candidate) resolve(false);
    };
    setTimeout(() => resolve(false), 6000);
  });
  await pc.setLocalDescription(await pc.createOffer());
  const ok = await found;
  pc.close();
  return {
    name: "Network allows WebRTC audio (UDP)",
    ok,
    ms: Math.round(performance.now() - started),
    detail: ok
      ? "Outbound UDP works, so calls can carry audio directly."
      : "No UDP route found. A firewall or VPN may block WebRTC; calls may fail to connect on this network. Ask IT to allow UDP to the voice service, or try another network.",
  };
}

async function micCheck(): Promise<Result> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { name: "Microphone", ok: true, detail: "Allowed and working." };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    return {
      name: "Microphone",
      ok: false,
      detail: name === "NotAllowedError" ? "Blocked. Allow the microphone for this site in the browser's settings." : "No microphone found, or it couldn't start.",
    };
  }
}

/** A real Realtime call, connected and hung up, timing each stage. */
async function callCheck(): Promise<Result> {
  const stages: string[] = [];
  const client = new RealtimeClient({
    onEvent: () => undefined,
    executeTool: async () => ({ output: { ok: false, error: "diagnostics" }, uiEvents: [] }),
    onStage: (stage: ConnectStage, ms) => stages.push(`${stage} ${ms} ms`),
  });
  const started = performance.now();
  try {
    await client.connect(() => fetchSessionCredentials());
    client.disconnect();
    return { name: "Test call (Realtime)", ok: true, ms: Math.round(performance.now() - started), detail: `Connected: ${stages.join(" → ")}` };
  } catch (err) {
    client.disconnect();
    return {
      name: "Test call (Realtime)",
      ok: false,
      ms: Math.round(performance.now() - started),
      detail: `${err instanceof Error ? err.message : String(err)}${stages.length ? ` (reached: ${stages.join(" → ")})` : ""}`,
    };
  }
}

/** Connection check: run it on a new laptop or network to see exactly what's blocked. */
export default function DiagnosticsPage() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResults([]);
    const add = (r: Result) => setResults((all) => [...all, r]);
    try {
      const res = await fetch("/api/diagnostics");
      const body = (await res.json().catch(() => ({}))) as { checks?: Result[]; error?: string };
      if (body.checks) body.checks.forEach(add);
      else add({ name: "Server checks", ok: false, detail: body.error ?? `The server answered ${res.status}.` });
    } catch {
      add({ name: "Server checks", ok: false, detail: "Couldn't reach this app's server." });
    }
    add(await micCheck());
    add(await udpCheck());
    add(await callCheck());
    setRunning(false);
  };

  return (
    <main className="admin">
      <header className="admin-head">
        <Link href="/voice" className="brand" aria-label="Back to DevOps Voice">
          <LogoMark size={36} />
          <span className="word">
            <b>DevOps</b>
            <i>Voice</i>
          </span>
        </Link>
      </header>
      <section className="admin-card panel" aria-labelledby="diag">
        <div className="admin-card-h">
          <h1 id="diag">Connection check</h1>
          <span className="sub2">Checks this browser, this network and the server, then makes a short test call.</span>
        </div>
        <button className="pill pri" onClick={run} disabled={running}>
          {running ? "Checking…" : results.length ? "Run again" : "Run the check"}
        </button>
        {results.length > 0 && (
          <ol className="diag-list">
            {results.map((r) => (
              <li key={r.name} className={r.ok ? "ok" : "bad"}>
                <span className="diag-icon" aria-hidden>
                  {r.ok ? <CheckIcon size={15} /> : <CloseIcon size={15} />}
                </span>
                <div className="min-w-0">
                  <p className="diag-name">
                    {r.name}
                    {r.ms !== undefined && <span className="act-time"> · {r.ms} ms</span>}
                  </p>
                  <p className="sub2">{r.detail}</p>
                </div>
              </li>
            ))}
            {running && <li className="sub2">Running…</li>}
          </ol>
        )}
      </section>
    </main>
  );
}
