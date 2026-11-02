import { NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";

export const dynamic = "force-dynamic";

/** Who the browser is signed in as, and their role (for the account menu). */
export async function GET(req: Request) {
  const p = await getPrincipal(req.headers);
  if (!p) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ name: p.name, email: p.email, role: p.role, signedIn: p.signedIn });
}
