import { NextResponse } from "next/server";
import { requireUser } from "@/lib/conversations/routeHelpers";
import { getConversationStore } from "@/lib/conversations/store";

export const dynamic = "force-dynamic";

/** The user's conversations, most recent first. */
export async function GET(req: Request) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ conversations: await getConversationStore().list(user) });
}

/** Starts an empty conversation. */
export async function POST(req: Request) {
  const user = await requireUser(req.headers);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ conversation: await getConversationStore().create(user) }, { status: 201 });
}
