import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/conversations/routeHelpers";
import { getTelemetry } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().max(64).nullable().optional(),
  events: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        at: z.number().int().positive().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(100),
});

/** Batched events from the browser: connection stages, errors, latencies. */
export async function POST(req: Request) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Expected { sessionId, events[] }." }, { status: 400 });
  getTelemetry().clientEvents(user, body.data.sessionId ?? null, body.data.events);
  return new NextResponse(null, { status: 204 });
}
