import { NextResponse } from "next/server";
import { loadSprintBoard } from "@/lib/devops/sprintBoard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const board = await loadSprintBoard(req.headers);
  return NextResponse.json(board, { status: board.ok ? 200 : 503 });
}
