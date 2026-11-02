import { createHash } from "node:crypto";
import { getToken, type JWT } from "next-auth/jwt";
import { entraConfig, needsRefresh, refreshAdoTokens, userKeyFor, type AdoTokens, type EntraConfig } from "@/lib/auth/entra";

/**
 * The one place the board gets its Azure DevOps credential from.
 *
 * With Microsoft Entra ID sign-in configured (see src/auth.ts), it's the
 * signed-in user's delegated Azure DevOps token, read on the server from the
 * encrypted session cookie and refreshed when it's about to expire. The user
 * key comes from the verified session (Entra tenant and object id), so caches
 * and pending confirmations are per user and can't be shared or forged.
 *
 * Without Entra settings, for local testing, it falls back to (1) a bearer
 * token sent with the request, then (2) AZURE_DEVOPS_PAT.
 */

export type AdoCredential =
  | { kind: "bearer"; token: string; userKey: string }
  | { kind: "pat"; pat: string; userKey: string };

/** Reads the session's token; swapped out in tests. */
export type SessionReader = (headers: Headers) => Promise<JWT | null>;

// The cookie is "__Secure-…" when served over HTTPS and plain on http://localhost.
export const readSession: SessionReader = async (headers) =>
  (await getToken({ req: { headers }, secret: process.env.AUTH_SECRET, secureCookie: false })) ??
  (await getToken({ req: { headers }, secret: process.env.AUTH_SECRET, secureCookie: true }));

/**
 * Tokens refreshed on the server since the cookie was written. A route can't
 * rewrite the session cookie, so later requests reuse the refreshed token from
 * here instead of refreshing again.
 */
const globalForTokens = globalThis as unknown as { __adoTokens?: Map<string, AdoTokens> };
const refreshed = (globalForTokens.__adoTokens ??= new Map());

export async function getAzureDevOpsCredential(
  headers: Headers,
  deps: { cfg?: EntraConfig | null; session?: SessionReader; fetchImpl?: typeof fetch } = {},
): Promise<AdoCredential | null> {
  const cfg = deps.cfg === undefined ? entraConfig() : deps.cfg;
  if (cfg) return entraCredential(headers, cfg, deps.session ?? readSession, deps.fetchImpl);

  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return { kind: "bearer", token: bearer, userKey: keyFor(bearer) };

  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (pat) return { kind: "pat", pat, userKey: keyFor(pat) };

  return null;
}

async function entraCredential(
  headers: Headers,
  cfg: EntraConfig,
  session: SessionReader,
  fetchImpl?: typeof fetch,
): Promise<AdoCredential | null> {
  const token = await session(headers);
  if (!token?.ado || token.error || !token.oid) return null;
  const userKey = userKeyFor(token.tid ?? cfg.tenantId, token.oid);

  // The newest of the cookie's token and one refreshed here earlier.
  let ado = token.ado;
  const cached = refreshed.get(userKey);
  if (cached && cached.expiresAt > ado.expiresAt) ado = cached;

  if (needsRefresh(ado)) {
    try {
      ado = await refreshAdoTokens(cfg, ado.refreshToken, fetchImpl);
      refreshed.set(userKey, ado);
    } catch (err) {
      console.warn("[auth] Azure DevOps token refresh failed:", err instanceof Error ? err.message : err);
      refreshed.delete(userKey);
      return null;
    }
  }
  return { kind: "bearer", token: ado.accessToken, userKey };
}

/** For tests: forget tokens refreshed on the server. */
export function clearRefreshedTokens() {
  refreshed.clear();
}

/**
 * A key derived from the secret itself (local testing only). An unverified
 * claim like a bare token's "oid" can't be used: a forged token could then
 * read another user's cached board.
 */
function keyFor(secret: string) {
  return `k_${createHash("sha256").update(secret).digest("hex").slice(0, 24)}`;
}
