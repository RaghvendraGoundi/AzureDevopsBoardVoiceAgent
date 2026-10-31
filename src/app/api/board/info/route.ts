import { NextResponse } from "next/server";
import { boardBriefing } from "@/lib/devops/briefing";

export const dynamic = "force-dynamic";

/** Project and sprint for the workspace header. Calling it on page load also warms the board caches. */
export async function GET(req: Request) {
  const { info } = await boardBriefing(req.headers, 4000);
  return NextResponse.json({ info });
}
