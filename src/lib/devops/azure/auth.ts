import { createHash } from "node:crypto";

/**
 * The one place the board gets its Azure DevOps credential from.
 *
 * Plug your Entra ID sign-in in here: return the signed-in user's delegated
 * access token for the Azure DevOps resource
 * (scope "499b84ac-1321-427f-aa17-267ca6abc798/.default") and a stable id
 * for the user from your verified session (for example their Entra object
 * id). The user key scopes caches and pending confirmations, so one user can
 * never see or confirm another's.
 *
 * Until then it falls back to (1) a bearer token sent with the request, then
 * (2) AZURE_DEVOPS_PAT for local testing.
 */

export type AdoCredential =
  | { kind: "bearer"; token: string; userKey: string }
  | { kind: "pat"; pat: string; userKey: string };

export async function getAzureDevOpsCredential(headers: Headers): Promise<AdoCredential | null> {
  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return { kind: "bearer", token: bearer, userKey: keyFor(bearer) };

  const pat = process.env.AZURE_DEVOPS_PAT?.trim();
  if (pat) return { kind: "pat", pat, userKey: keyFor(pat) };

  return null;
}

/**
 * A key derived from the secret itself. An unverified claim like the token's
 * "oid" can't be used: a forged token could then read another user's cached
 * board. Your Entra integration should return the id from its verified
 * session instead.
 */
function keyFor(secret: string) {
  return `k_${createHash("sha256").update(secret).digest("hex").slice(0, 24)}`;
}
