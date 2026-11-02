import { NextResponse } from "next/server";
import { requireUser } from "@/lib/conversations/routeHelpers";
import { boardCheck, configChecks, databaseCheck, realtimeReachability } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

/** The server's side of the connection check: configuration, voice service, board and database. */
export async function GET(req: Request) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  const [voice, board, database] = await Promise.all([realtimeReachability(), boardCheck(req.headers), databaseCheck()]);
  return NextResponse.json({ checks: [...configChecks(), voice, board, database] });
}
