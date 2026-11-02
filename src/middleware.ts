import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { entraConfig, gate } from "@/lib/auth/entra";

/**
 * With Entra ID configured, the app needs a signed-in user: pages send the
 * browser to /signin, API routes answer 401. This also guards the voice
 * session routes, so nobody can start (and bill) a call without signing in.
 * Without Entra settings it lets everything through, as before.
 */
export default auth((req) => {
  if (!entraConfig()) return NextResponse.next();
  const signedIn = !!req.auth && !req.auth.error;
  const verdict = gate(req.nextUrl.pathname, signedIn);
  if (verdict === "pass") return NextResponse.next();
  if (verdict === "unauthorized") {
    return NextResponse.json({ error: "Sign in with Microsoft to continue." }, { status: 401 });
  }
  const url = new URL("/signin", req.nextUrl.origin);
  url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  if (req.auth?.error) url.searchParams.set("error", "SessionExpired");
  return NextResponse.redirect(url);
});

export const config = {
  runtime: "nodejs",
  matcher: ["/", "/voice/:path*", "/board/:path*", "/api/((?!auth/).*)"],
};
