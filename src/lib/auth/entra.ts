/**
 * Microsoft Entra ID settings and token refresh for signing in to Azure
 * DevOps as the user. Kept free of Next.js imports so the sign-in config,
 * the middleware and the board's credential hook can all share it, and so
 * it can be unit tested.
 */

/** Azure DevOps' application id; its user_impersonation scope acts as the signed-in user. */
export const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6abc798";
export const AZURE_DEVOPS_SCOPE = `${AZURE_DEVOPS_RESOURCE}/user_impersonation`;

/** Asked for at sign-in: who the user is, a refresh token, and Azure DevOps access. */
export const SIGN_IN_SCOPES = `openid profile email offline_access ${AZURE_DEVOPS_SCOPE}`;

/** Refresh this long before the access token expires, so a request never races the expiry. */
export const REFRESH_MARGIN_MS = 2 * 60_000;

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** The app registration from the environment, or null when Entra sign-in isn't configured. */
export function entraConfig(env: NodeJS.ProcessEnv = process.env): EntraConfig | null {
  const tenantId = env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID?.trim();
  const clientId = env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim();
  const clientSecret = env.AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim();
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

export const issuerFor = (cfg: EntraConfig) => `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`;
const tokenUrlFor = (cfg: EntraConfig) => `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;

/** The Azure DevOps tokens kept (encrypted) in the session. */
export interface AdoTokens {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch. */
  expiresAt: number;
}

export const needsRefresh = (t: AdoTokens, now = Date.now()) => now >= t.expiresAt - REFRESH_MARGIN_MS;

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    /** Entra's error code, e.g. invalid_grant when the user must sign in again. */
    readonly code: string,
  ) {
    super(message);
  }
}

/** Swaps a refresh token for a new Azure DevOps access token. */
export async function refreshAdoTokens(
  cfg: EntraConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<AdoTokens> {
  const res = await fetchImpl(tokenUrlFor(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      scope: `${AZURE_DEVOPS_SCOPE} offline_access`,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    // Never include the tokens in the message; Entra's description is safe to log.
    throw new TokenRefreshError(body.error_description?.split("\n")[0] ?? `Token refresh failed (${res.status}).`, body.error ?? "unknown");
  }
  return {
    accessToken: body.access_token,
    // Entra may not return a new refresh token; the old one stays valid then.
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  };
}

/** Scopes caches, conversations and confirmations to one Entra user in one tenant. */
export const userKeyFor = (tenantId: string, objectId: string) => `entra:${tenantId}:${objectId}`;

/**
 * What the middleware does with a request when sign-in is required:
 * let it through, send the browser to the sign-in page, or answer 401.
 */
export function gate(pathname: string, signedIn: boolean): "pass" | "signin" | "unauthorized" {
  if (signedIn || pathname.startsWith("/api/auth") || pathname === "/signin") return "pass";
  return pathname.startsWith("/api/") ? "unauthorized" : "signin";
}
