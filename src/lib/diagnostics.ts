import { getPrincipal } from "@/lib/auth/principal";
import { getBoardFor } from "@/lib/devops/boardFactory";
import { db, dbConfigured } from "@/lib/db/pool";
import { credentialProblem, fetchWithRetry, resolveProvider } from "@/lib/voice/providers";

/**
 * Server-side checks for /api/health (configuration and database, no user)
 * and /diagnostics (also the voice services and Azure DevOps as the user).
 * Results never include secrets.
 */

export interface Check {
  name: string;
  ok: boolean;
  ms?: number;
  detail: string;
}

async function timed(name: string, fn: () => Promise<string>): Promise<Check> {
  const started = performance.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Math.round(performance.now() - started), detail };
  } catch (err) {
    return { name, ok: false, ms: Math.round(performance.now() - started), detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

export async function databaseCheck(): Promise<Check> {
  if (!dbConfigured()) return { name: "Database", ok: true, detail: "Not configured: using local files." };
  return timed("Database", async () => {
    const pool = await db()!;
    await pool.query("select 1");
    return "Connected and migrated.";
  });
}

export function configChecks(): Check[] {
  return (["realtime", "live"] as const).map((purpose) => {
    const name = purpose === "realtime" ? "Realtime configuration" : "GPT-Live configuration";
    try {
      const p = resolveProvider(process.env, purpose);
      return { name, ok: true, detail: `${p.name === "azure" ? "Azure AI Foundry" : "OpenAI"} · ${p.model} · ${p.auth}` };
    } catch (err) {
      return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Mints a throwaway Realtime key: proves the server can reach and authenticate to the voice service. */
export function realtimeReachability(): Promise<Check> {
  return timed("Realtime service (from the server)", async () => {
    const p = resolveProvider();
    const res = await fetchWithRetry(p.clientSecretUrl, {
      method: "POST",
      headers: { ...(await p.getAuthHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: { type: "realtime", model: p.model } }),
    });
    if (!res.ok) throw new Error(credentialProblem(p, res.status) ?? `The service answered ${res.status}.`);
    return "Reachable and authenticated.";
  });
}

export function boardCheck(headers: Headers): Promise<Check> {
  return timed("Azure DevOps board", async () => {
    const principal = await getPrincipal(headers);
    if (!principal) throw new Error("Not signed in.");
    const { board } = await getBoardFor(headers);
    const ctx = await board.context();
    return `${ctx.project} · team ${ctx.team} · ${ctx.members.length + 1} people · signed in as ${principal.role}`;
  });
}
