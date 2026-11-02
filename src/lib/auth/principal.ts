import { entraConfig, userKeyFor } from "@/lib/auth/entra";
import { readSession } from "@/lib/devops/azure/auth";
import { getUserRepo, roleFor, type Role } from "@/lib/users/store";

/**
 * Who is making a request, and their role. With Entra ID sign-in it's the
 * signed-in user from the encrypted session (never anything the browser
 * claims). Without sign-in (local runs) it's the single local user, who is
 * an admin unless LOCAL_ROLE=user (handy for trying the user experience).
 */

export interface Principal {
  /** Scopes caches, conversations, confirmations and telemetry. */
  userKey: string;
  name: string | null;
  email: string | null;
  role: Role;
  /** Signed in with Entra ID (false for a local run). */
  signedIn: boolean;
}

const SEEN_EVERY_MS = 5 * 60_000;
const globalForSeen = globalThis as unknown as { __lastSeen?: Map<string, number> };

/** Null when Entra sign-in is on and nobody (valid) is signed in. */
export async function getPrincipal(headers: Headers, deps: { session?: typeof readSession } = {}): Promise<Principal | null> {
  const cfg = entraConfig();
  if (!cfg) {
    return { userKey: "local", name: null, email: null, role: process.env.LOCAL_ROLE?.trim() === "user" ? "user" : "admin", signedIn: false };
  }
  const token = await (deps.session ?? readSession)(headers);
  if (!token?.oid || token.error) return null;
  const userKey = userKeyFor(token.tid ?? cfg.tenantId, token.oid);
  const email = (token.email as string | undefined) ?? null;
  const name = (token.name as string | undefined) ?? null;
  noteSeen(userKey, name, email, token.tid ?? cfg.tenantId, token.oid);
  return { userKey, name, email, role: await roleFor(userKey, email), signedIn: true };
}

/** Keeps "last seen" current for the admin page, at most every few minutes per user. */
function noteSeen(userKey: string, name: string | null, email: string | null, tenantId: string, objectId: string) {
  const seen = (globalForSeen.__lastSeen ??= new Map());
  const last = seen.get(userKey) ?? 0;
  if (Date.now() - last < SEEN_EVERY_MS) return;
  seen.set(userKey, Date.now());
  void getUserRepo()
    .seen({ userKey, name: name ?? email ?? "Unknown", email, tenantId, objectId })
    .catch((err: unknown) => console.warn("[users] couldn't record visit:", err instanceof Error ? err.message : err));
}
