import { NextResponse, type NextFetchEvent, type NextMiddleware, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { entraConfig, gate } from "@/lib/auth/entra";

/**
 * With Entra ID configured, the app needs a signed-in user: pages send the
 * browser to /signin, API routes answer 401. This also guards the voice
 * session routes, so nobody can start (and bill) a call without signing in.
 * Without Entra settings it lets everything through, as before.
 */
const gated = auth((req) => {
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
}) as unknown as NextMiddleware;

// Without Entra settings there's no sign-in, so Auth.js isn't involved at all.
export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  return entraConfig() ? gated(req, ev) : NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/", "/voice/:path*", "/board/:path*", "/admin/:path*", "/diagnostics/:path*", "/api/((?!auth/|health).*)"],
};
