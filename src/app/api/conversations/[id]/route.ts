import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/conversations/routeHelpers";
import { getConversationStore } from "@/lib/conversations/store";
import type { ConversationChange } from "@/lib/conversations/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const workItem = z.object({ id: z.number(), title: z.string(), type: z.string(), state: z.string() }).passthrough();

const patchSchema = z.object({
  title: z.string().max(120).optional(),
  turns: z
    .array(z.object({ id: z.string().min(1).max(200), role: z.enum(["user", "assistant"]), text: z.string().max(20000), at: z.number() }))
    .max(200)
    .optional(),
  // Board changes are display data the browser already got from our own tools.
  changes: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        kind: z.enum(["created", "updated", "cancelled"]),
        item: workItem,
        before: workItem.optional(),
        at: z.number(),
      }),
    )
    .max(100)
    .optional(),
});

export async function GET(req: Request, { params }: Params) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  const conversation = await getConversationStore().get(user, (await params).id);
  return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}

/** Saves new turns and changes (already-saved ones are ignored), or renames. */
export async function PATCH(req: Request, { params }: Params) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid conversation update." }, { status: 400 });
  const summary = await getConversationStore().append(user, (await params).id, {
    ...body.data,
    changes: body.data.changes as ConversationChange[] | undefined,
  });
  return summary ? NextResponse.json({ conversation: summary }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function DELETE(req: Request, { params }: Params) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  const removed = await getConversationStore().remove(user, (await params).id);
  return removed ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
