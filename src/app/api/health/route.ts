import { NextResponse } from "next/server";
import { configChecks, databaseCheck } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

/** Liveness and readiness for the host (no sign-in needed, no secrets in the answer). */
export async function GET() {
  const checks = [...configChecks(), await databaseCheck()];
  const ok = checks.every((c) => c.ok || c.name === "GPT-Live configuration");
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
