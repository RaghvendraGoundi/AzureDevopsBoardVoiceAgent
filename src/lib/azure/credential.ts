import type { TokenCredential } from "@azure/identity";

/**
 * Entra ID tokens for Azure services, from the app's own identity: the
 * managed identity when running in Azure (set AZURE_CLIENT_ID for a
 * user-assigned one), or `az login` / environment credentials locally.
 * Used for Azure AI Foundry (models) and Azure Database for PostgreSQL.
 *
 * Tokens are cached until five minutes before they expire, so a busy route
 * doesn't ask Entra for a new one on every request.
 */

export const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
export const POSTGRES_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

const EARLY_MS = 5 * 60_000;

type Cached = { token: string; expiresAt: number };

const globalForAzure = globalThis as unknown as {
  __azureCredential?: Promise<TokenCredential>;
  __azureTokens?: Map<string, Cached>;
};

/** Swapped out in tests. */
let credentialFactory: () => Promise<TokenCredential> = async () => {
  const { DefaultAzureCredential } = await import("@azure/identity");
  return new DefaultAzureCredential(process.env.AZURE_CLIENT_ID ? { managedIdentityClientId: process.env.AZURE_CLIENT_ID } : undefined);
};

export function setCredentialFactoryForTests(factory: (() => Promise<TokenCredential>) | null) {
  credentialFactory = factory ?? credentialFactory;
  globalForAzure.__azureCredential = undefined;
  globalForAzure.__azureTokens?.clear();
}

export class AzureTokenError extends Error {}

/** An access token for `scope`, from the app's managed identity. */
export async function getAzureToken(scope: string, now = Date.now()): Promise<string> {
  const cache = (globalForAzure.__azureTokens ??= new Map());
  const hit = cache.get(scope);
  if (hit && hit.expiresAt - EARLY_MS > now) return hit.token;

  globalForAzure.__azureCredential ??= credentialFactory();
  try {
    const token = await (await globalForAzure.__azureCredential).getToken(scope);
    if (!token) throw new Error("no token returned");
    cache.set(scope, { token: token.token, expiresAt: token.expiresOnTimestamp });
    return token.token;
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new AzureTokenError(
      `Couldn't get a managed-identity token for ${scope.replace("/.default", "")}: ${detail}. ` +
        "In Azure, check the app's managed identity and its role assignment; locally, run `az login`.",
    );
  }
}
