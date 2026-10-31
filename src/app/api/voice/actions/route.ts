import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolFor } from "@/lib/devops/toolRoute";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  actionId: z.string().min(1).max(64),
  decision: z.enum(["confirm", "cancel"]),
});

/** On-screen Confirm / Cancel buttons. Goes through the same validated tool path as voice. */
export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Expected { actionId, decision }." }, { status: 400 });
  const result = await runToolFor(
    req.headers,
    body.data.decision === "confirm" ? "confirm_action" : "cancel_action",
    { action_id: body.data.actionId },
  );
  return NextResponse.json(result);
}
