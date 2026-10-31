import { NextResponse } from "next/server";
import { z } from "zod";
import { runToolFor } from "@/lib/devops/toolRoute";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().min(1).max(64), args: z.unknown() });

export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Expected { name, args }." }, { status: 400 });
  return NextResponse.json(await runToolFor(req.headers, body.data.name, body.data.args));
}
